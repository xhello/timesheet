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

function harness({ user = admin, saved = null, env = { ADMIN_EMAIL: admin.email }, imported = seed, conflict = false } = {}) {
  let snapshot = structuredClone(saved);
  let writes = 0;
  const origin = load('../app/auth/origin.ts', { 'server-only': {}, 'next/headers': {} }, env);
  const route = load('../app/api/workspace/route.ts', {
    '@/lib/auth': { getCurrentUser: async () => user },
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
  assert.equal((await app.GET()).status, 401);
  assert.equal((await app.POST(request({ action: 'setup' }, 'https://schedule.example.test', { 'oai-authenticated-user-id': admin.userId, 'oai-authenticated-user-email': admin.email }))).status, 401);
  assert.equal(app.writes(), 0);
});

test('unverified users cannot read or mutate the workspace', async () => {
  const app = harness({ user: { ...admin, emailVerified: false } });
  assert.equal((await app.GET()).status, 403);
  assert.equal((await app.POST(request({ action: 'setup' }))).status, 403);
  assert.equal(app.writes(), 0);
});

test('only the configured admin receives setup and can initialize storage', async () => {
  for (const options of [{ user: employee }, { env: {} }, { env: { ADMIN_EMAIL: '   ' } }]) {
    const app = harness(options);
    assert.equal((await (await app.GET()).json()).role, 'guest');
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
  assert.equal((await (await app.GET()).json()).role, 'guest');
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
  assert.equal((await (await revoked.GET()).json()).role, 'guest');
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
  assert.equal(data.shifts[1].employeeId, null);
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
    assert.deepEqual(Object.keys(shift).sort(),['date','employeeId','end','id','label','source','start']);
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
