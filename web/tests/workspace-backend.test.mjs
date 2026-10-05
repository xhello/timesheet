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
const admin = { userId: 'admin-id', displayName: 'Admin', email: 'admin@example.test', emailVerified: true };
const employee = { userId: 'employee-user', displayName: 'Employee', email: 'employee@example.test', emailVerified: true };
const seed = { employees: [{ id: 'employee-id', name: 'Employee', hireDate: '', priority: 1, active: true, userId: 'old-chatgpt-user', codeHash: 'old-code', codeExpires: 999 }], shifts: [], notes: [] };
const initial = () => ({ ownerId: admin.userId, ownerName: admin.displayName, employees: [{ ...seed.employees[0], userId: employee.userId }], shifts: [], requests: [], weeks: {}, imported: true, priorityConfirmed: false, notes: [] });

function harness({ user = admin, saved = null, env = { ADMIN_EMAIL: admin.email }, imported = seed, conflict = false } = {}) {
  let snapshot = structuredClone(saved);
  let writes = 0;
  const origin = load('../app/auth/origin.ts', { 'server-only': {}, 'next/headers': {} }, env);
  const route = load('../app/api/workspace/route.ts', {
    '@/lib/auth': { getCurrentUser: async () => user },
    '@/app/auth/origin': origin,
    '@/lib/schedule': schedule,
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
