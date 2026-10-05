import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
// Run the real route with isolated auth/storage boundaries, without credentials
// or network access. TypeScript removes types; application logic stays intact.
function load(relative, dependencies = {}, env = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const module = { exports: {} };
  const resolve = name => name in dependencies ? dependencies[name] : require(name);
  new Function('require', 'module', 'exports', 'process', outputText)(resolve, module, module.exports, { env });
  return module.exports;
}
const schedule = load('../lib/schedule.ts');
const phone = load('../lib/phone.ts');
const admin = { userId: 'admin-id', displayName: 'Admin', email: 'admin@example.test', emailVerified: true, authType: 'email' };
const employee = { userId: 'employee:employee-id', employeeId: 'employee-id', phoneVersion: 'phone-version', displayName: 'Employee', email: '', emailVerified: false, authType: 'phone' };
const seed = { employees: [{ id: 'employee-id', name: 'Employee', hireDate: '', priority: 1, active: true, userId: 'old-chatgpt-user', codeHash: 'old-code', codeExpires: 999 }], shifts: [], notes: [] };
const initial = () => ({ ownerId: admin.userId, ownerName: admin.displayName, employees: [{ ...seed.employees[0], phone: '+16045550123', phoneVersion: employee.phoneVersion }], shifts: [], requests: [], weeks: {}, imported: true, priorityConfirmed: false, notes: [] });

function harness({ user = admin, saved = null, env = { ADMIN_EMAIL: admin.email }, imported = seed, conflict = false, authError = null } = {}) {
  let snapshot = structuredClone(saved);
  let writes = 0;
  const origin = load('../app/auth/origin.ts', { 'server-only': {}, 'next/headers': {} }, env);
  const route = load('../app/api/workspace/route.ts', {
    '@/lib/auth': { getCurrentUser: async () => { if(authError)throw authError; return user; } },
    '@/app/auth/origin': origin,
    '@/lib/schedule': schedule,
    '@/lib/phone': phone,
    '@/lib/imported.json': imported,
    '@/lib/storage': {
      readState: async () => structuredClone(snapshot),
      createState: async state => { writes++; if (conflict || snapshot) return { meta: { changes: 0 } }; snapshot = { state: structuredClone(state), version: 0 }; return { meta: { changes: 1 } }; },
      commitState: async (state, version) => { writes++; if (conflict || snapshot.version !== version) return { meta: { changes: 0 } }; snapshot = { state: structuredClone(state), version: version + 1 }; return { meta: { changes: 1 } }; },
    },
  }, env);
  return { ...route, snapshot: () => snapshot, writes: () => writes };
}
const request = (body, origin = 'https://schedule.example.test', extra = {}) => new Request('https://schedule.example.test/api/workspace', { method: 'POST', headers: { 'content-type': 'application/json', ...(origin === undefined ? {} : { origin }), ...extra }, body: JSON.stringify(body) });

test('forged legacy identity headers cannot authenticate a workspace request', async () => {
  const app = harness({ user: null });
  assert.equal((await (await app.GET()).json()).role, 'public');
  assert.equal((await app.POST(request({ action: 'setup' }, 'https://schedule.example.test', { 'oai-authenticated-user-id': admin.userId, 'oai-authenticated-user-email': admin.email }))).status, 401);
  assert.equal(app.writes(), 0);
});

test('unverified users receive only the public calendar and cannot mutate the workspace', async () => {
  const app = harness({ user: { ...admin, emailVerified: false } });
  assert.equal((await (await app.GET()).json()).role, 'public');
  assert.equal((await app.POST(request({ action: 'setup' }))).status, 403);
  assert.equal(app.writes(), 0);
});

test('only the configured admin receives setup and can initialize storage', async () => {
  for (const options of [{ user: employee }, { env: {} }, { env: { ADMIN_EMAIL: '   ' } }]) {
    const app = harness(options);
    assert.equal((await (await app.GET()).json()).role, 'public');
    assert.equal((await app.POST(request({ action: 'setup' }))).status, 403);
    assert.equal(app.writes(), 0);
  }
  const app = harness({ env: { ADMIN_EMAIL: ' ADMIN@EXAMPLE.TEST ' } });
  assert.equal((await (await app.GET()).json()).role, 'setup');
  assert.equal((await app.POST(request({ action: 'setup' }))).status, 200);
  assert.equal((await app.POST(request({ action: 'setup' }))).status, 409);
});

test('setup preserves optional migrated schedule fields and drops old identity credentials', async () => {
  const imported = { ...seed, requests: [{ id: 'request-id', shiftId: 'shift-id', employeeId: 'employee-id', createdAt: '2026-10-01', note: 'Keep' }], weeks: { '2026-10-11': 'published' }, priorityConfirmed: true, settings: { dailyMaxHours: 6, weeklyMaxHours: 30 } };
  const app = harness({ imported });
  assert.equal((await app.POST(request({ action: 'setup' }))).status, 200);
  const state = app.snapshot().state;
  for (const key of ['requests', 'weeks', 'settings', 'priorityConfirmed']) assert.deepEqual(state[key], imported[key]);
  assert.equal(state.ownerId, admin.userId);
  for (const key of ['userId', 'codeHash', 'codeExpires']) assert.equal(state.employees[0][key], undefined);
  assert.equal(seed.employees[0].userId, 'old-chatgpt-user');
});

test('write requests reject missing, malformed, and cross-origin submissions', async () => {
  const app = harness();
  for (const origin of ['null', '', 'not a URL', 'https://evil.example.test', 'http://schedule.example.test', 'https://schedule.example.test:444', 'https://schedule.example.test/path', 'https://name@schedule.example.test']) {
    assert.equal((await app.POST(request({ action: 'setup' }, origin))).status, 403, origin);
  }
  const missing = request({ action: 'setup' });
  missing.headers.delete('origin');
  assert.equal((await app.POST(missing)).status, 403);
  assert.equal(app.writes(), 0);
});

test('configured public origin works with an internal Vercel URL but forged forwarded hosts do not', async () => {
  const app = harness({ env: { ADMIN_EMAIL: admin.email, NEXT_PUBLIC_SITE_URL: 'https://schedule.example.test' } });
  const internal = new Request('http://127.0.0.1:3000/api/workspace', { method: 'POST', headers: { origin: 'https://schedule.example.test', host: 'schedule.example.test' }, body: JSON.stringify({ action: 'setup' }) });
  assert.equal((await app.POST(internal)).status, 200);
  assert.equal((await app.POST(request({ action: 'setup' }, 'https://evil.example.test', { 'x-forwarded-host': 'evil.example.test' }))).status, 403);
});

test('employee cannot change administrator settings, and stale/concurrent writes fail', async () => {
  const saved = { state: initial(), version: 4 };
  const action = { action: 'settings', dailyMaxHours: 6, weeklyMaxHours: 30, version: 4 };
  const member = harness({ user: employee, saved });
  assert.equal((await member.POST(request(action))).status, 403);
  assert.equal(member.writes(), 0);
  const stale = harness({ saved });
  assert.equal((await stale.POST(request({ ...action, version: 3 }))).status, 409);
  assert.equal(stale.writes(), 0);
  const raced = harness({ saved, conflict: true });
  assert.equal((await raced.POST(request(action))).status, 409);
  assert.equal(raced.snapshot().version, 4);
  const success = harness({ saved });
  assert.equal((await success.POST(request(action))).status, 200);
  assert.equal(success.snapshot().version, 5);
});

test('malformed JSON and non-object inputs receive a validation error', async () => {
  const app = harness();
  const invalid = request({});
  assert.equal((await app.POST(new Request(invalid, { body: '{' }))).status, 400);
  assert.equal((await app.POST(request(null))).status, 400);
  assert.equal(app.writes(), 0);
});

test('phone employees can read without email verification but cannot see phone numbers', async () => {
  const app = harness({ user: employee, saved: { state: initial(), version: 0 } });
  const response = await app.GET();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.role, 'employee');
  assert.equal(data.employeeId, employee.employeeId);
  assert.equal(data.employees[0].phone, undefined);
  assert.equal(data.employees[0].phoneVersion, undefined);
  assert.equal(data.employees[0].userId, undefined);
});

test('phone session cannot become admin even if its userId matches owner', async () => {
  const app = harness({ user: { ...employee, userId: admin.userId }, saved: { state: initial(), version: 0 } });
  assert.equal((await (await app.GET()).json()).role, 'employee');
  assert.equal((await app.POST(request({ action: 'priority', ids: ['employee-id'], version: 0 }))).status, 403);
});

test('old employee email bindings and obsolete invite actions no longer grant access', async () => {
  const state = initial();
  state.employees[0].userId = 'legacy-user';
  const app = harness({ user: { ...admin, userId: 'legacy-user', email: 'employee@example.test' }, saved: { state, version: 0 } });
  assert.equal((await (await app.GET()).json()).role, 'public');
  for (const action of [{ action: 'join', code: 'old-code' }, { action: 'code', employeeId: 'employee-id' }]) {
    assert.equal((await app.POST(request({ ...action, version: 0 }))).status, 400);
  }
  assert.equal(app.writes(), 0);
});

test('admin normalizes unique phone numbers and revokes sessions after changing or clearing them', async () => {
  const state = initial();
  state.employees.push({ id: 'second', name: 'Second', active: true, hireDate: '', priority: 2, phone: '+16045550999', phoneVersion: 'another-version' });
  const app = harness({ saved: { state, version: 0 } });
  const action = { action: 'employee', id: 'employee-id', name: 'Employee', hireDate: '' };
  assert.equal((await app.POST(request({ ...action, phone: '(604) 555-0999', version: 0 }))).status, 409);
  assert.equal((await app.POST(request({ ...action, phone: 'not a phone', version: 0 }))).status, 400);
  assert.equal(app.writes(), 0);
  const changed = await app.POST(request({ ...action, phone: '(604) 555-0124', version: 0 }));
  assert.equal(changed.status, 200);
  const saved = app.snapshot();
  assert.equal(saved.state.employees[0].phone, '+16045550124');
  assert.notEqual(saved.state.employees[0].phoneVersion, employee.phoneVersion);
  assert.equal((await changed.json()).employees[0].phone, '+16045550124');
  const revoked = harness({ user: employee, saved });
  assert.equal((await (await revoked.GET()).json()).role, 'public');
  assert.equal((await revoked.POST(request({ action: 'request', shiftId: 'any', note: '', version: 1 }))).status, 403);
  const version = saved.state.employees[0].phoneVersion;
  assert.equal((await app.POST(request({ ...action, phone: '', version: 1 }))).status, 200);
  assert.equal(app.snapshot().state.employees[0].phone, '');
  assert.notEqual(app.snapshot().state.employees[0].phoneVersion, version);
});

test('editing non-phone details preserves a valid session and omitting phone preserves the existing number', async () => {
  const app = harness({ saved: { state: initial(), version: 0 } });
  const action = { action: 'employee', id: 'employee-id', name: 'Updated name', hireDate: '' };
  assert.equal((await app.POST(request({ ...action, version: 0 }))).status, 200);
  assert.equal(app.snapshot().state.employees[0].phone, '+16045550123');
  assert.equal(app.snapshot().state.employees[0].phoneVersion, employee.phoneVersion);
  assert.equal((await app.POST(request({ ...action, phone: '604-555-0123', version: 1 }))).status, 200);
  assert.equal(app.snapshot().state.employees[0].phoneVersion, employee.phoneVersion);
});

test('employees see ranked requesters but only their own notes and can only change their own requests', async () => {
  const state = initial();
  state.priorityConfirmed = true;
  state.employees.push({ id: 'other-employee', name: 'Other employee', active: true, hireDate: '2020-01-01', priority: 2, phone: '+16045550999', phoneVersion: 'private-version' });
  state.shifts = [{ id: 'shift', date: '2026-10-11', start: '08:00', end: '16:00', label: 'Desk', employeeId: null, source: 'manual' }];
  state.weeks = { '2026-10-11': 'draft' };
  state.requests = [{ id: 'someone-else', shiftId: 'shift', employeeId: 'other-employee', note: 'Private', createdAt: '2026-10-01' }];
  const app = harness({ user: employee, saved: { state, version: 0 } });
  assert.equal((await app.POST(request({ action: 'withdraw', requestId: 'someone-else', version: 0 }))).status, 403);
  const response = await app.POST(request({ action: 'request', shiftId: 'shift', employeeId: 'other-employee', note: 'My preference', version: 0 }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.requests.length, 2);
  assert.equal(data.requests[0].employeeId, employee.employeeId);
  assert.equal(data.requests[0].note, 'My preference');
  assert.equal(data.requests[1].note, '');
  assert.deepEqual(data.employees.map(e => e.priority), [1, 2]);
  assert.ok(data.employees.every(e => !e.phone && !e.phoneVersion && !e.hireDate));
  assert.equal(data.shifts[0].employeeId, employee.employeeId);
  assert.equal(data.shifts[0].source, 'request-priority');
  assert.equal(app.snapshot().state.requests.length, 2);
  assert.equal((await app.POST(request({ action: 'withdraw', requestId: data.requests[0].id, version: 1 }))).status, 200);
  assert.equal(app.snapshot().state.shifts[0].employeeId, 'other-employee');
});

function competingState() {
  const state = initial();
  state.priorityConfirmed = true;
  state.employees.push({ id: 'junior', name: 'Junior', active: true, hireDate: '', priority: 2 });
  state.shifts = [{ id: 'shift', date: '2026-10-11', start: '08:00', end: '12:00', label: 'Desk', employeeId: 'junior', source: 'request-priority' }];
  state.weeks = { '2026-10-11': 'draft' };
  state.requests = [{ id: 'junior-request', shiftId: 'shift', employeeId: 'junior', createdAt: '2026-10-01', note: 'Private junior note' }];
  return state;
}

test('a later senior request replaces a provisional winner in the same version-checked write', async () => {
  const state = competingState();
  const action = { action: 'request', shiftId: 'shift', note: '', version: 5 };
  const raced = harness({ user: employee, saved: { state, version: 5 }, conflict: true });
  assert.equal((await raced.POST(request(action))).status, 409);
  assert.equal(raced.snapshot().state.shifts[0].employeeId, 'junior');
  assert.equal(raced.snapshot().state.requests.length, 1);
  const app = harness({ user: employee, saved: { state, version: 5 } });
  const response = await app.POST(request(action));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.shifts[0].employeeId, employee.employeeId);
  assert.deepEqual(data.requests.map(r => r.employeeId), [employee.employeeId, 'junior']);
  assert.equal(app.snapshot().version, 6);
  assert.equal(app.writes(), 1);
});

test('unsaved priority collects requests and saving priority allocates them immediately', async () => {
  const state = competingState();
  state.priorityConfirmed = false;
  state.employees.forEach(e => e.priority = 0);
  state.shifts[0].employeeId = null;
  state.shifts[0].source = 'manual';
  const app = harness({ saved: { state, version: 0 } });
  let response = await app.POST(request({ action: 'request', employeeId: employee.employeeId, shiftId: 'shift', note: '', version: 0 }));
  assert.equal(response.status, 200);
  assert.equal(app.snapshot().state.shifts[0].employeeId, null);
  response = await app.POST(request({ action: 'priority', ids: [employee.employeeId, 'junior'], version: 1 }));
  assert.equal(response.status, 200);
  assert.equal(app.snapshot().state.shifts[0].employeeId, employee.employeeId);
  response = await app.POST(request({ action: 'priority', ids: ['junior', employee.employeeId], version: 2 }));
  assert.equal(response.status, 200);
  assert.equal(app.snapshot().state.shifts[0].employeeId, 'junior');
});

test('manual assignment and an explicitly held open shift are preserved until admin resumes automatic filling', async () => {
  const state = competingState();
  const app = harness({ saved: { state, version: 0 } });
  assert.equal((await app.POST(request({ action: 'assign', shiftId: 'shift', employeeId: 'junior', version: 0 }))).status, 200);
  assert.equal((await app.POST(request({ action: 'request', shiftId: 'shift', employeeId: employee.employeeId, note: '', version: 1 }))).status, 200);
  assert.equal(app.snapshot().state.shifts[0].employeeId, 'junior');
  assert.equal(app.snapshot().state.shifts[0].source, 'manual');
  assert.equal((await app.POST(request({ action: 'assign', shiftId: 'shift', employeeId: null, version: 2 }))).status, 200);
  assert.equal(app.snapshot().state.shifts[0].employeeId, null);
  assert.equal(app.snapshot().state.shifts[0].requestAssignmentLocked, true);
  assert.equal((await app.POST(request({ action: 'request', shiftId: 'shift', employeeId: employee.employeeId, note: 'Updated note', version: 3 }))).status, 200);
  assert.equal(app.snapshot().state.shifts[0].employeeId, null);
  assert.equal((await app.POST(request({ action: 'auto', week: '2026-10-11', version: 4 }))).status, 200);
  assert.equal(app.snapshot().state.shifts[0].employeeId, employee.employeeId);
  assert.equal(app.snapshot().state.shifts[0].requestAssignmentLocked, false);
});

test('hour-limit changes re-evaluate automatic requests without changing fixed assignments', async () => {
  const state = competingState();
  state.shifts[0].start = '12:00'; state.shifts[0].end = '16:00';
  state.shifts[0].employeeId = employee.employeeId;
  state.shifts.push({ id: 'fixed', date: '2026-10-11', start: '08:00', end: '12:00', label: 'Fixed duty', employeeId: employee.employeeId, source: 'manual', note: 'Admin-only note' });
  state.requests.push({ id: 'senior-request', shiftId: 'shift', employeeId: employee.employeeId, createdAt: '2026-10-02', note: '' });
  const app = harness({ saved: { state, version: 0 } });
  assert.equal((await app.POST(request({ action: 'settings', dailyMaxHours: 6, weeklyMaxHours: 40, version: 0 }))).status, 200);
  assert.equal(app.snapshot().state.shifts[0].employeeId, 'junior');
  assert.equal(app.snapshot().state.shifts[1].employeeId, employee.employeeId);
  const member = harness({ user: employee, saved: app.snapshot() });
  const data = await (await member.GET()).json();
  assert.equal(data.shifts[0].employeeId, 'junior');
  assert.equal(data.shifts[1].employeeId, employee.employeeId);
  assert.equal(data.shifts[1].note, undefined);
});

test('publishing freezes provisional winners and blocks new requests, withdrawal, and automatic refill', async () => {
  const state = competingState();
  const app = harness({ saved: { state, version: 0 } });
  assert.equal((await app.POST(request({ action: 'publish', week: '2026-10-11', published: true, version: 0 }))).status, 200);
  assert.equal((await app.POST(request({ action: 'request', shiftId: 'shift', employeeId: employee.employeeId, note: '', version: 1 }))).status, 400);
  assert.equal((await app.POST(request({ action: 'withdraw', requestId: 'junior-request', version: 1 }))).status, 400);
  assert.equal((await app.POST(request({ action: 'auto', week: '2026-10-11', version: 1 }))).status, 400);
  assert.equal((await app.POST(request({ action: 'priority', ids: ['junior', employee.employeeId], version: 1 }))).status, 200);
  assert.equal(app.snapshot().state.shifts[0].employeeId, 'junior');
  assert.equal(app.snapshot().state.weeks['2026-10-11'], 'published');
});

function copyState() {
  const state=initial();
  state.priorityConfirmed=true;
  state.employees.push({id:'inactive',name:'Inactive',hireDate:'',priority:2,active:false});
  state.shifts=[
    {id:'morning',date:'2026-10-11',start:'08:00',end:'12:00',label:'Front desk',employeeId:employee.employeeId,source:'imported',note:'Private source note',hourLimitOverride:true,requestAssignmentLocked:true},
    {id:'custom',date:'2026-10-13',start:'18:15',end:'20:45',label:'Custom duty',employeeId:'inactive',source:'manual'},
    {id:'night',date:'2026-10-17',start:'22:00',end:'06:00',label:'Overnight',employeeId:'deleted',source:'priority'},
    {id:'pending',date:'2026-10-18',start:'08:00',end:'12:00',label:'Existing pending',employeeId:null,source:'manual'},
  ];
  state.weeks={'2026-10-11':'published','2026-10-18':'draft'};
  state.requests=[{id:'private-request',shiftId:'morning',employeeId:employee.employeeId,createdAt:'2026-10-01',note:'Private request note'},{id:'pending-request',shiftId:'pending',employeeId:employee.employeeId,createdAt:'2026-10-01',note:'Still pending'}];
  return state;
}

test('copy week defaults to unassigned fresh shifts and preserves source data, requests, and other drafts',async()=>{
  const state=copyState(),saved={state,version:9},app=harness({saved});
  const response=await app.POST(request({action:'week',week:'2026-10-27',sourceWeek:'2026-10-14',version:9}));
  assert.equal(response.status,200);
  const updated=app.snapshot();
  assert.equal(updated.version,10);
  assert.equal(app.writes(),1);
  assert.deepEqual(updated.state.shifts.slice(0,state.shifts.length),state.shifts);
  assert.deepEqual(updated.state.requests,state.requests);
  assert.deepEqual(updated.state.employees,state.employees);
  assert.deepEqual(updated.state.weeks,{...state.weeks,'2026-10-25':'draft'});
  const copied=updated.state.shifts.slice(state.shifts.length);
  assert.deepEqual(copied.map(s=>[s.date,s.label,s.start,s.end]),[['2026-10-25','Front desk','08:00','12:00'],['2026-10-27','Custom duty','18:15','20:45'],['2026-10-31','Overnight','22:00','06:00']]);
  assert.ok(copied.every(s=>s.employeeId===null&&s.source==='copy'));
  assert.equal(new Set(copied.map(s=>s.id)).size,3);
  for(const shift of copied){
    assert.match(shift.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(!state.shifts.some(s=>s.id===shift.id));
    assert.deepEqual(Object.keys(shift).sort(),['date','employeeId','end','id','label','sheetId','source','start']);
  }
});

test('copy assignments retains active staff, reports unavailable staff, and requires fresh approvals only when needed',async()=>{
  const state=copyState();
  const app=harness({saved:{state,version:0}});
  const response=await app.POST(request({action:'week',week:'2026-10-25',sourceWeek:'2026-10-11',copyAssignments:true,allowOverlap:true,overrideHourLimits:true,version:0}));
  assert.equal(response.status,200);
  const body=await response.json();
  assert.match(body.message,/2 shifts were left unassigned/);
  const copied=app.snapshot().state.shifts.slice(state.shifts.length);
  assert.deepEqual(copied.map(s=>s.employeeId),[employee.employeeId,null,null]);
  assert.ok(copied.every(s=>s.source==='copy'&&!('hourLimitOverride' in s)&&!('requestAssignmentLocked' in s)&&!('note' in s)));
});

test('copy rejects overlapping assignments atomically until admin explicitly approves compatible duties',async()=>{
  const state=initial();
  state.shifts=[
    {id:'first',date:'2026-10-11',start:'08:00',end:'12:00',label:'Desk',employeeId:employee.employeeId,source:'manual'},
    {id:'second',date:'2026-10-11',start:'11:00',end:'14:00',label:'Cleaning',employeeId:employee.employeeId,source:'manual'},
  ];
  const saved={state,version:0},app=harness({saved});
  const action={action:'week',week:'2026-10-25',sourceWeek:'2026-10-11',copyAssignments:true,version:0};
  assert.equal((await app.POST(request(action))).status,422);
  assert.deepEqual(app.snapshot(),saved);
  assert.equal(app.writes(),0);
  assert.equal((await app.POST(request({...action,allowOverlap:true}))).status,200);
  assert.ok(app.snapshot().state.shifts.slice(2).every(s=>s.employeeId===employee.employeeId&&!s.hourLimitOverride));
});

test('copied daily overages need explicit hour approval and only affected new shifts receive it',async()=>{
  const state=initial();
  state.shifts=[
    {id:'first',date:'2026-10-11',start:'08:00',end:'13:00',label:'Morning',employeeId:employee.employeeId,source:'manual',hourLimitOverride:true},
    {id:'second',date:'2026-10-11',start:'13:00',end:'18:00',label:'Afternoon',employeeId:employee.employeeId,source:'manual',hourLimitOverride:true},
    {id:'safe',date:'2026-10-12',start:'08:00',end:'12:00',label:'Monday',employeeId:employee.employeeId,source:'manual',hourLimitOverride:true},
  ];
  const saved={state,version:0},app=harness({saved});
  const action={action:'week',week:'2026-10-25',sourceWeek:'2026-10-11',copyAssignments:true,version:0};
  assert.equal((await app.POST(request(action))).status,422);
  assert.equal(app.writes(),0);
  assert.deepEqual(app.snapshot(),saved);
  assert.equal((await app.POST(request({...action,overrideHourLimits:true}))).status,200);
  const copied=app.snapshot().state.shifts.slice(3);
  assert.deepEqual(copied.map(s=>s.hourLimitOverride),[true,true,undefined]);
  assert.deepEqual(app.snapshot().state.shifts.slice(0,3),state.shifts);
});

test('copy checks adjacent-week overnight conflicts and weekly totals before committing',async()=>{
  const state=initial();
  state.shifts=[{id:'night-source',date:'2026-10-17',start:'22:00',end:'06:00',label:'Overnight',employeeId:employee.employeeId,source:'manual'},...Array.from({length:5},(_,i)=>({id:`future-${i}`,date:`2026-11-${String(1+i).padStart(2,'0')}`,start:'05:00',end:'13:00',label:'Published work',employeeId:employee.employeeId,source:'manual'}))];
  state.weeks={'2026-11-01':'published'};
  const saved={state,version:0},app=harness({saved});
  const action={action:'week',week:'2026-10-25',sourceWeek:'2026-10-11',copyAssignments:true,version:0};
  assert.equal((await app.POST(request(action))).status,422);
  const hourFailure=await app.POST(request({...action,allowOverlap:true}));
  assert.equal(hourFailure.status,422);
  assert.match((await hourFailure.json()).error,/2026-11-01/);
  assert.equal(app.writes(),0);
  assert.deepEqual(app.snapshot(),saved);
  assert.equal((await app.POST(request({...action,allowOverlap:true,overrideHourLimits:true}))).status,200);
  assert.equal(app.snapshot().state.shifts.at(-1).hourLimitOverride,true);
  assert.deepEqual(app.snapshot().state.shifts.slice(0,state.shifts.length),state.shifts);
  assert.equal(app.snapshot().state.weeks['2026-11-01'],'published');
});

test('week creation validates source and target weeks, authorization, and optimistic version conflicts',async()=>{
  const state=copyState(),saved={state,version:4};
  const valid={action:'week',week:'2026-10-25',sourceWeek:'2026-10-11',version:4};
  const member=harness({user:employee,saved});
  assert.equal((await member.POST(request(valid))).status,403);
  assert.equal(member.writes(),0);
  for(const action of [{...valid,week:'2026-10-11'},{...valid,sourceWeek:'2026-10-25'},{...valid,sourceWeek:'2026-11-01'},{...valid,sourceWeek:'2026-10-04'},{...valid,sourceWeek:undefined,copyAssignments:true}]){
    const app=harness({saved});
    assert.ok([400,409].includes((await app.POST(request(action))).status));
    assert.equal(app.writes(),0);
    assert.deepEqual(app.snapshot(),saved);
  }
  const published=structuredClone(saved);published.state.weeks['2026-10-25']='published';
  const occupied=harness({saved:published});
  assert.equal((await occupied.POST(request(valid))).status,409);
  assert.equal(occupied.writes(),0);
  const stale=harness({saved});
  assert.equal((await stale.POST(request({...valid,version:3}))).status,409);
  assert.equal(stale.writes(),0);
  const raced=harness({saved,conflict:true});
  assert.equal((await raced.POST(request(valid))).status,409);
  assert.deepEqual(raced.snapshot(),saved);
  assert.equal(raced.writes(),1);
});

test('standard week templates remain available, respect canonical dates, and preserve unrelated requests',async()=>{
  const state=copyState();state.weeks['2026-10-25']='draft';
  const app=harness({saved:{state,version:0}});
  assert.equal((await app.POST(request({action:'week',week:'2026-10-28',version:0}))).status,200);
  const updated=app.snapshot().state;
  assert.equal(updated.shifts.length,state.shifts.length+35);
  const created=updated.shifts.slice(state.shifts.length);
  assert.equal(created[0].date,'2026-10-25');assert.equal(created.at(-1).date,'2026-10-31');
  assert.ok(created.every(s=>s.employeeId===null&&s.source==='template'));
  assert.deepEqual(updated.shifts.slice(0,state.shifts.length),state.shifts);
  assert.deepEqual(updated.requests,state.requests);
});

test('both copied and template weeks enforce the total shift cap without partial writes',async()=>{
  const state=initial();
  state.shifts=Array.from({length:9990},(_,i)=>({id:`existing-${i}`,date:'2026-10-11',start:'08:00',end:'12:00',label:'Existing',employeeId:null,source:'manual'}));
  for(const sourceWeek of [undefined,'2026-10-11']){
    const app=harness({saved:{state,version:0}});
    assert.equal((await app.POST(request({action:'week',week:'2026-10-25',sourceWeek,version:0}))).status,400);
    assert.equal(app.writes(),0);
    assert.equal(app.snapshot().state.shifts.length,9990);
  }
  state.shifts.length=9965;
  const exact=harness({saved:{state,version:0}});
  assert.equal((await exact.POST(request({action:'week',week:'2026-10-25',version:0}))).status,200);
  assert.equal(exact.snapshot().state.shifts.length,10000);
});

function publicCalendarState(){
  const state=initial();
  state.ownerName='Private owner name';state.notes=['Private workspace note'];state.priorityConfirmed=true;
  state.settings={dailyMaxHours:6,weeklyMaxHours:30};
  state.employees[0].hireDate='2020-02-03';state.employees[0].priority=7;
  state.employees.push({id:'other',name:'Other calendar employee',active:false,hireDate:'2021-04-05',priority:2,phone:'+16045550888',phoneVersion:'private-phone-token',codeHash:'private-legacy-token'});
  state.employees.push({id:'unassigned',name:'Private unused roster entry',active:true,hireDate:'2022-05-06',priority:1,phone:'+16045550777'});
  state.shifts=[
    {id:'manual-draft',date:'2026-10-11',start:'08:00',end:'12:00',label:'Front desk',employeeId:employee.employeeId,source:'manual',note:'Private shift note',hourLimitOverride:true,requestAssignmentLocked:true,privateMetadata:'Private extra metadata'},
    {id:'copied-draft',date:'2026-10-12',start:'13:00',end:'17:00',label:'Afternoon',employeeId:'other',source:'copy'},
    {id:'live-draft',date:'2026-10-13',start:'17:00',end:'22:00',label:'Evening',employeeId:employee.employeeId,source:'request-priority'},
    {id:'published',date:'2026-10-18',start:'22:00',end:'06:00',label:'Overnight',employeeId:'other',source:'imported',note:'Private published shift note'},
    {id:'open',date:'2026-10-19',start:'08:00',end:'12:00',label:'Open duty',employeeId:null,source:'template'},
  ];
  state.weeks={'2026-10-11':'draft','2026-10-18':'published','internal-note':'Private week metadata'};
  state.requests=[
    {id:'own-private-request-id',shiftId:'manual-draft',employeeId:employee.employeeId,createdAt:'2026-10-01',note:'Private own request note'},
    {id:'other-private-request-id',shiftId:'manual-draft',employeeId:'unassigned',createdAt:'2026-10-02',note:'Private coworker request note'},
  ];
  return state;
}

test('anonymous calendar uses an explicit public whitelist including draft assignees without private roster or request data',async()=>{
  const state=publicCalendarState(),saved={state,version:12},app=harness({user:null,saved});
  const response=await app.GET();
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json();
  assert.deepEqual(Object.keys(data).sort(),['employees','notes','priorityConfirmed','requests','role','settings','sheetWeeks','sheets','shifts','userName','version','weeks']);
  assert.equal(data.role,'public');assert.equal(data.userName,'');assert.equal(data.version,12);
  assert.equal(data.priorityConfirmed,false);
  assert.deepEqual(data.requests,[]);assert.deepEqual(data.notes,[]);
  assert.deepEqual(data.settings,{dailyMaxHours:8,weeklyMaxHours:40});
  assert.deepEqual(data.weeks,{'2026-10-11':'draft','2026-10-18':'published'});
  assert.deepEqual(data.employees,[{id:employee.employeeId,name:'Employee',hireDate:'',priority:0,active:true},{id:'other',name:'Other calendar employee',hireDate:'',priority:0,active:true}]);
  assert.deepEqual(data.shifts,state.shifts.map(({id,date,start,end,label,employeeId,source})=>({id,date,start,end,label,employeeId,source,sheetId:'front-desk'})));
  const text=JSON.stringify(data);
  for(const privateValue of ['Private','private-',state.ownerId,state.employees[0].phone,state.employees[0].hireDate,'old-chatgpt-user','old-code'])assert.ok(!text.includes(privateValue),privateValue);
  assert.equal(app.writes(),0);assert.deepEqual(app.snapshot(),saved);
});

test('anonymous requests to every mutation action remain unauthorized despite public calendar access',async()=>{
  const saved={state:publicCalendarState(),version:2},app=harness({user:null,saved});
  for(const action of ['setup','employee','priority','sheet','settings','assign','move','shift','deleteShift','request','withdraw','auto','week','publish']){
    const response=await app.POST(request({action,version:2},'https://schedule.example.test',{'oai-authenticated-user-id':admin.userId,'oai-authenticated-user-email':admin.email}));
    assert.equal(response.status,401,action);
  }
  assert.equal(app.writes(),0);assert.deepEqual(app.snapshot(),saved);
});

test('invalid, revoked, unverified, and nonmember identities fall back to the same public projection',async()=>{
  const saved={state:publicCalendarState(),version:2};
  const expected=await (await harness({user:null,saved}).GET()).json();
  const cases=[
    {user:null},
    {authError:new Error('Invalid session'),user:admin},
    {user:{...employee,phoneVersion:'revoked-version'}},
    {user:{...employee,employeeId:'other'}},
    {user:{...admin,emailVerified:false}},
    {user:{...admin,userId:'nonowner',email:'other@example.test'}},
  ];
  for(const options of cases){
    const app=harness({...options,saved});
    const response=await app.GET();
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),expected);
    assert.equal(app.writes(),0);
  }
  const broken=harness({saved,authError:new Error('Invalid session')});
  assert.equal((await broken.POST(request({action:'settings',dailyMaxHours:8,weeklyMaxHours:40,version:2}))).status,401);
  assert.equal(broken.writes(),0);
});

test('an uninitialized calendar returns a usable empty public shape without exposing the imported seed',async()=>{
  const app=harness({user:null});
  assert.deepEqual(await (await app.GET()).json(),{role:'public',userName:'',version:0,priorityConfirmed:false,notes:[],requests:[],settings:{dailyMaxHours:8,weeklyMaxHours:40},weeks:{},sheets:schedule.DEFAULT_SHEETS,sheetWeeks:{waiter:{},cook:{}},employees:[],shifts:[]});
  assert.equal(app.writes(),0);
  assert.equal((await (await harness().GET()).json()).role,'setup');
});

test('signed-in employee calendars include manual and copied drafts while private notes remain owner/admin only',async()=>{
  const state=publicCalendarState(),saved={state,version:2};
  const member=harness({user:employee,saved});
  const data=await (await member.GET()).json();
  assert.equal(data.role,'employee');
  assert.deepEqual(data.shifts.map(s=>[s.id,s.employeeId,s.source]),state.shifts.map(s=>[s.id,s.employeeId,s.source]));
  assert.ok(data.shifts.every(s=>s.note===undefined));
  assert.ok(data.shifts.every(s=>s.privateMetadata===undefined));
  assert.deepEqual(data.notes,[]);
  assert.equal(data.requests.find(r=>r.id==='own-private-request-id').note,'Private own request note');
  assert.equal(data.requests.find(r=>r.id==='other-private-request-id').note,'');
  assert.ok(data.employees.every(e=>e.phone===undefined&&e.phoneVersion===undefined&&e.hireDate===''));
  const owner=await (await harness({saved}).GET()).json();
  assert.equal(owner.role,'admin');
  assert.deepEqual(owner.notes,state.notes);
  assert.equal(owner.shifts[0].note,'Private shift note');
  assert.equal(owner.requests.find(r=>r.id==='other-private-request-id').note,'Private coworker request note');
});

const departmentShift=(id,sheetId='front-desk',date='2026-10-11',start='08:00',end='12:00',employeeId=null)=>({id,date,start,end,label:id,employeeId,source:'manual',...(sheetId==='front-desk'?{}:{sheetId})});
const postCurrent=(app,payload)=>app.POST(request({...payload,version:app.snapshot().version}));

test('legacy calendar identities stay unchanged while all roles receive default department metadata',async()=>{
  const state=copyState(),saved={state,version:7};
  for(const user of [null,employee,admin]){
    const app=harness({saved,user}),data=await (await app.GET()).json();
    assert.deepEqual(data.sheets,schedule.DEFAULT_SHEETS);
    assert.deepEqual(data.sheetWeeks,{waiter:{},cook:{}});
    assert.deepEqual(data.weeks,state.weeks);
    assert.deepEqual(data.shifts.map(s=>s.id),state.shifts.map(s=>s.id));
    assert.ok(data.shifts.every(s=>s.sheetId==='front-desk'));
    assert.deepEqual(app.snapshot(),saved);assert.equal(app.writes(),0);
  }
});

test('only admins create or rename unique sheets and sheet changes preserve all schedule data',async()=>{
  const state=copyState(),saved={state,version:0};
  const member=harness({saved,user:employee});
  assert.equal((await postCurrent(member,{action:'sheet',name:'Laundry'})).status,403);
  const app=harness({saved});
  assert.equal((await postCurrent(app,{action:'sheet',name:'  Laundry  '})).status,200);
  const laundry=app.snapshot().state.sheets.find(s=>s.name==='Laundry');
  assert.match(laundry.id,/^[0-9a-f-]{36}$/);
  assert.equal((await postCurrent(app,{action:'sheet',name:'lAuNdRy'})).status,409);
  assert.equal((await postCurrent(app,{action:'sheet',id:'waiter',name:'Kitchen'})).status,200);
  assert.equal((await postCurrent(app,{action:'sheet',id:'cook',name:' kitchen '})).status,409);
  assert.equal((await postCurrent(app,{action:'sheet',id:'missing',name:'Reception'})).status,404);
  assert.deepEqual(app.snapshot().state.shifts,state.shifts);
  assert.deepEqual(app.snapshot().state.requests,state.requests);
  assert.deepEqual(app.snapshot().state.weeks,state.weeks);
  const capped=initial();capped.sheets=[...schedule.DEFAULT_SHEETS,...Array.from({length:17},(_,i)=>({id:`custom-${i}`,name:`Department ${i}`}))];
  const limit=harness({saved:{state:capped,version:0}});
  assert.equal((await postCurrent(limit,{action:'sheet',name:'Too many'})).status,400);
  assert.equal(limit.writes(),0);
  const raced=harness({saved,conflict:true});
  assert.equal((await postCurrent(raced,{action:'sheet',name:'Laundry'})).status,409);
  assert.deepEqual(raced.snapshot(),saved);
});

test('sheet-aware actions reject unknown sheets and shift edits never silently move departments',async()=>{
  const state=initial();state.shifts=[departmentShift('waiter-shift','waiter')];
  state.weeks={'2026-10-11':'published'};state.sheetWeeks={waiter:{'2026-10-11':'published'},cook:{'2026-10-11':'published'}};
  const saved={state,version:0};
  for(const payload of [{action:'shift',date:'2026-10-11',start:'08:00',end:'12:00',label:'New'},{action:'week',week:'2026-10-18'},{action:'auto',week:'2026-10-11'},{action:'publish',week:'2026-10-11',published:true}]){
    const app=harness({saved});
    assert.equal((await postCurrent(app,{...payload,sheetId:'unknown'})).status,404);
    assert.equal(app.writes(),0);assert.deepEqual(app.snapshot(),saved);
  }
  const app=harness({saved}),edit={action:'shift',id:'waiter-shift',date:'2026-10-12',start:'09:00',end:'13:00',label:'Breakfast'};
  assert.equal((await postCurrent(app,{...edit,sheetId:'cook'})).status,400);
  assert.equal((await postCurrent(app,edit)).status,200);
  assert.equal(app.snapshot().state.shifts[0].sheetId,'waiter');
  assert.equal(app.snapshot().state.sheetWeeks.waiter['2026-10-11'],'draft');
  assert.equal(app.snapshot().state.sheetWeeks.cook['2026-10-11'],'published');
  assert.equal(app.snapshot().state.weeks['2026-10-11'],'published');
});

test('departments coexist in the same week with blank defaults and scoped copies without inheriting private data',async()=>{
  const state=initial();state.priorityConfirmed=true;
  state.shifts=[departmentShift('legacy'),{...departmentShift('waiter-source','waiter','2026-10-11'),employeeId:employee.employeeId,note:'Private source',hourLimitOverride:true,requestAssignmentLocked:true},departmentShift('front-target','front-desk','2026-10-18')];
  state.requests=[{id:'source-note',shiftId:'waiter-source',employeeId:employee.employeeId,createdAt:'2026-10-01',note:'Private request'}];
  state.weeks={'2026-10-11':'published','2026-10-18':'published'};state.sheetWeeks={waiter:{'2026-10-11':'published'}};
  const app=harness({saved:{state,version:0}});
  assert.equal((await postCurrent(app,{action:'week',week:'2026-10-13',sheetId:'cook'})).status,200);
  assert.equal(app.snapshot().state.shifts.length,state.shifts.length);
  assert.deepEqual(app.snapshot().state.sheetWeeks.cook,{'2026-10-11':'draft'});
  assert.equal((await postCurrent(app,{action:'week',week:'2026-10-20',sheetId:'waiter',sourceWeek:'2026-10-13'})).status,200);
  const copy=app.snapshot().state.shifts.at(-1);
  assert.equal(copy.sheetId,'waiter');assert.equal(copy.date,'2026-10-18');assert.equal(copy.employeeId,null);
  assert.notEqual(copy.id,'waiter-source');assert.equal(copy.source,'copy');
  assert.equal(copy.note,undefined);assert.equal(copy.hourLimitOverride,undefined);assert.equal(copy.requestAssignmentLocked,undefined);
  assert.deepEqual(app.snapshot().state.shifts.slice(0,state.shifts.length),state.shifts);
  assert.deepEqual(app.snapshot().state.requests,state.requests);
  assert.deepEqual(app.snapshot().state.weeks,state.weeks);
  assert.deepEqual(app.snapshot().state.sheetWeeks.waiter,{'2026-10-11':'published','2026-10-18':'draft'});
  const existing=app.snapshot();
  assert.equal((await postCurrent(app,{action:'week',week:'2026-10-18',sheetId:'waiter'})).status,409);
  assert.deepEqual(app.snapshot(),existing);
  for(const payload of [{sheetId:'waiter',sourceWeek:'2026-10-11',blank:true},{sheetId:'cook',copyAssignments:true},{sheetId:'cook',sourceWeek:'2026-10-11'}])assert.equal((await postCurrent(app,{action:'week',week:'2026-10-25',...payload})).status,400);
  assert.equal((await postCurrent(app,{action:'week',week:'2026-10-25',blank:true})).status,200);
  assert.equal(app.snapshot().state.shifts.length,state.shifts.length+1);
  assert.equal(app.snapshot().state.weeks['2026-10-25'],'draft');
});

test('department publishing, request gates, reopen and held-open release are independent',async()=>{
  const state=initial();state.priorityConfirmed=true;
  state.shifts=[departmentShift('front'),{...departmentShift('waiter','waiter'),requestAssignmentLocked:true},{...departmentShift('cook','cook'),requestAssignmentLocked:true}];
  state.weeks={'2026-10-11':'published'};state.sheetWeeks={waiter:{'2026-10-11':'draft'},cook:{'2026-10-11':'draft'}};
  state.requests=[{id:'cook-request',shiftId:'cook',employeeId:employee.employeeId,createdAt:'2026-10-01',note:''}];
  const member=harness({saved:{state,version:0},user:employee});
  assert.equal((await postCurrent(member,{action:'request',shiftId:'front',sheetId:'waiter',note:''})).status,400);
  assert.equal((await postCurrent(member,{action:'request',shiftId:'waiter',sheetId:'front-desk',note:'My private note'})).status,200);
  const app=harness({saved:member.snapshot()});
  assert.equal((await postCurrent(app,{action:'auto',week:'2026-10-13',sheetId:'waiter'})).status,200);
  assert.equal(app.snapshot().state.shifts.find(s=>s.id==='waiter').employeeId,employee.employeeId);
  assert.equal(app.snapshot().state.shifts.find(s=>s.id==='cook').requestAssignmentLocked,true);
  assert.equal(app.snapshot().state.shifts.find(s=>s.id==='cook').employeeId,null);
  assert.equal((await postCurrent(app,{action:'publish',week:'2026-10-13',sheetId:'waiter',published:true})).status,200);
  assert.equal(app.snapshot().state.weeks['2026-10-11'],'published');
  assert.equal(app.snapshot().state.sheetWeeks.waiter['2026-10-11'],'published');
  assert.equal(app.snapshot().state.sheetWeeks.cook['2026-10-11'],'draft');
  const frozen=harness({saved:app.snapshot(),user:employee});
  const waiterRequest=frozen.snapshot().state.requests.find(r=>r.shiftId==='waiter');
  assert.equal((await postCurrent(frozen,{action:'withdraw',requestId:waiterRequest.id})).status,400);
  assert.equal((await postCurrent(frozen,{action:'request',shiftId:'cook',note:''})).status,200);
  assert.equal((await postCurrent(app,{action:'publish',week:'2026-10-11',sheetId:'waiter',published:false})).status,200);
  assert.equal(app.snapshot().state.weeks['2026-10-11'],'published');
  assert.equal(app.snapshot().state.sheetWeeks.waiter['2026-10-11'],'draft');
});

test('assignment, move and deletion draft only the sheets belonging to their actual shifts',async()=>{
  const state=initial();state.shifts=[departmentShift('front'),departmentShift('waiter','waiter'),departmentShift('cook','cook','2026-10-12')];
  state.weeks={'2026-10-11':'published'};state.sheetWeeks={waiter:{'2026-10-11':'published'},cook:{'2026-10-11':'published'}};
  const app=harness({saved:{state,version:0}});
  assert.equal((await postCurrent(app,{action:'assign',shiftId:'waiter',employeeId:employee.employeeId})).status,200);
  assert.equal(app.snapshot().state.sheetWeeks.waiter['2026-10-11'],'draft');
  assert.equal(app.snapshot().state.sheetWeeks.cook['2026-10-11'],'published');
  assert.equal((await postCurrent(app,{action:'move',fromId:'waiter',toId:'cook'})).status,200);
  assert.equal(app.snapshot().state.sheetWeeks.cook['2026-10-11'],'draft');
  assert.equal(app.snapshot().state.shifts.find(s=>s.id==='cook').employeeId,employee.employeeId);
  assert.equal(app.snapshot().state.shifts.find(s=>s.id==='waiter').requestAssignmentLocked,true);
  assert.equal((await postCurrent(app,{action:'deleteShift',shiftId:'waiter'})).status,200);
  assert.equal(app.snapshot().state.weeks['2026-10-11'],'published');
  assert.deepEqual(app.snapshot().state.shifts.find(s=>s.id==='front'),state.shifts[0]);
});

test('cross-department assignments and copies require fresh overlap and hour approvals',async()=>{
  const state=initial();state.shifts=[departmentShift('front','front-desk','2026-10-18','08:00','13:00',employee.employeeId),departmentShift('waiter-source','waiter','2026-10-11','12:00','17:00',employee.employeeId),departmentShift('cook-open','cook','2026-10-18','12:00','17:00')];
  state.weeks={'2026-10-18':'published'};
  const app=harness({saved:{state,version:0}}),assign={action:'assign',shiftId:'cook-open',employeeId:employee.employeeId};
  assert.equal((await postCurrent(app,assign)).status,422);
  assert.equal((await postCurrent(app,{...assign,allowOverlap:true})).status,422);
  assert.equal(app.writes(),0);
  const copy={action:'week',week:'2026-10-18',sheetId:'waiter',sourceWeek:'2026-10-11',copyAssignments:true};
  assert.equal((await postCurrent(app,copy)).status,422);
  assert.equal((await postCurrent(app,{...copy,allowOverlap:true})).status,422);
  assert.equal((await postCurrent(app,{...copy,allowOverlap:true,overrideHourLimits:true})).status,200);
  assert.equal(app.snapshot().state.shifts.at(-1).hourLimitOverride,true);
  assert.equal(app.snapshot().state.weeks['2026-10-18'],'published');
  assert.equal((await postCurrent(app,{action:'publish',week:'2026-10-18',sheetId:'waiter',published:true})).status,422);
  assert.equal((await postCurrent(app,{action:'publish',week:'2026-10-18',sheetId:'waiter',published:true,overrideHourLimits:true})).status,200);
});

test('public department metadata is whitelisted and unknown or invalid statuses remain private',async()=>{
  const state=publicCalendarState();
  state.sheets=[{id:'waiter',name:'Dining',privateNote:'Private sheet note'},{id:'laundry',name:'Laundry',phone:'Private sheet phone'},{id:'__proto__',name:'Private invalid sheet'}];
  state.shifts[1].sheetId='waiter';
  state.sheetWeeks={waiter:{'2026-10-11':'published','2026-02-30':'draft','2026-10-18':'Private status','Private metadata':'draft'},laundry:{'2026-10-18':'draft'},unknown:{'2026-10-11':'Private unknown sheet'},'front-desk':{'2026-10-11':'Private duplicate'}};
  const app=harness({saved:{state,version:0},user:null}),data=await (await app.GET()).json();
  assert.deepEqual(data.sheets,[{id:'front-desk',name:'Front Desk'},{id:'waiter',name:'Dining'},{id:'cook',name:'Cook'},{id:'laundry',name:'Laundry'}]);
  assert.deepEqual(data.sheetWeeks,{waiter:{'2026-10-11':'published'},cook:{},laundry:{'2026-10-18':'draft'}});
  assert.equal(data.weeks['2026-10-11'],'draft');assert.equal(data.shifts[1].sheetId,'waiter');
  assert.ok(!JSON.stringify(data).includes('Private'));
  assert.ok(data.shifts.every(s=>Object.keys(s).sort().join(',')==='date,employeeId,end,id,label,sheetId,source,start'));
  assert.equal(app.writes(),0);
});
