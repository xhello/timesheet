import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(relative, dependencies = {}, env = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', outputText)(name => name in dependencies ? dependencies[name] : require(name), module, module.exports, { env });
  return module.exports;
}
const phone = load('../lib/phone.ts');
const secret = 'test-only-secret-with-at-least-thirty-two-characters';
const employee = { id: 'employee-id', name: 'Employee', active: true, phone: '+14155550123', phoneVersion: 'version-one' };
function sessionHarness({ roster = [employee], token, env = { EMPLOYEE_SESSION_SECRET: secret, NODE_ENV: 'production' } } = {}) {
  const writes = [];
  const session = load('../lib/employee-session.ts', {
    'server-only': {},
    'next/headers': { cookies: async () => ({ get: () => token ? { value: token } : undefined, set: (...args) => writes.push(args) }) },
    '@/lib/phone': phone,
    '@/lib/storage': { readState: async () => ({ state: { employees: roster } }) },
  }, env);
  return { ...session, writes };
}

test('phone normalization accepts common US and explicit international numbers consistently', () => {
  for (const value of ['4155550123', '(415) 555-0123', '1 415 555 0123', '+1 (415) 555-0123', ' 415.555.0123 ']) assert.equal(phone.normalizePhone(value), '+14155550123', value);
  assert.equal(phone.normalizePhone('+44 20 7946 0123'), '+442079460123');
  for (const value of [null, 4155550123, '', '+0123456789', '+1234567', '+1234567890123456', '4155550123 ext 9', 'call4155550123', '++14155550123', '1+4155550123', '(4155550123', '415)555(0123', '(41(5))5550123', '415\n5550123', '00442079460123']) assert.equal(phone.normalizePhone(value), null, String(value));
});

test('employee session rejects tampering, the wrong key, expiry, oversized tokens, and future claims', () => {
  const session = sessionHarness();
  const token = session.sealEmployeeSession(employee, secret, 1000);
  assert.equal(session.unsealEmployeeSession(token, secret, 1001).employeeId, employee.id);
  assert.equal(session.unsealEmployeeSession(token, secret, 1000 + session.EMPLOYEE_SESSION_SECONDS), null);
  assert.equal(session.unsealEmployeeSession(token, 'another-secret-with-at-least-thirty-two-characters', 1001), null);
  const [body, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString());
  assert.equal(claims.phone, undefined);
  claims.employeeId = 'someone-else';
  assert.equal(session.unsealEmployeeSession(`${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${signature}`, secret, 1001), null);
  assert.equal(session.unsealEmployeeSession(`${body}.${signature.slice(0, -1)}`, secret, 1001), null);
  assert.equal(session.unsealEmployeeSession(`${token}.extra`, secret, 1001), null);
  assert.equal(session.unsealEmployeeSession('a'.repeat(2049), secret, 1001), null);
  assert.equal(session.unsealEmployeeSession(session.sealEmployeeSession(employee, secret, 2000), secret, 1000), null);
  assert.throws(() => session.sealEmployeeSession(employee, 'short', 1000));
});

test('phone sessions authenticate only active current roster entries and revoke when their number changes', async () => {
  const token = sessionHarness().sealEmployeeSession(employee, secret);
  const user = await sessionHarness({ token }).readEmployeeSession();
  assert.deepEqual(user, { authType: 'phone', userId: 'employee:employee-id', employeeId: 'employee-id', phoneVersion: 'version-one', displayName: 'Employee', email: '', emailVerified: false });
  for (const roster of [[], [{ ...employee, active: false }], [{ ...employee, phone: undefined }], [{ ...employee, phone: 'malformed' }], [{ ...employee, phoneVersion: 'version-two' }]]) {
    assert.equal(await sessionHarness({ token, roster }).readEmployeeSession(), null);
  }
  assert.equal(await sessionHarness({ token: 'fake' }).readEmployeeSession(), null);
});

test('employee cookies are HttpOnly, secure in production, expiring, and removable on identity changes', async () => {
  const session = sessionHarness();
  await session.createEmployeeSession(employee);
  const [name, token, options] = session.writes[0];
  assert.equal(name, session.EMPLOYEE_SESSION_COOKIE);
  assert.ok(session.unsealEmployeeSession(token, secret));
  assert.deepEqual(options, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 604800 });
  await session.clearEmployeeSession();
  assert.equal(session.writes[1][1], '');
  assert.equal(session.writes[1][2].maxAge, 0);
  assert.equal(session.writes[1][2].expires.getTime(), 0);
  await assert.rejects(() => session.createEmployeeSession({ ...employee, active: false }));
});

const request = (value = { phone: '(415) 555-0123' }, headers = {}) => new Request('https://schedule.example.test/api/employee-login', { method: 'POST', headers: { origin: 'https://schedule.example.test', 'content-type': 'application/json', 'x-vercel-forwarded-for': '203.0.113.10', ...headers }, body: JSON.stringify(value) });
function loginHarness({ roster = [employee], rate = { data: 0, error: null }, signoutError = null, env = { EMPLOYEE_SESSION_SECRET: secret, VERCEL: '1' } } = {}) {
  const calls = { counters: [], reads: 0, signouts: 0, sessions: [] };
  const origin = load('../app/auth/origin.ts', { 'server-only': {}, 'next/headers': {} });
  const route = load('../app/api/employee-login/route.ts', {
    '@/app/auth/origin': origin,
    '@/lib/employee-session': { employeeSessionSecret: () => { if (!env.EMPLOYEE_SESSION_SECRET) throw Error(); return env.EMPLOYEE_SESSION_SECRET; }, createEmployeeSession: async item => calls.sessions.push(item) },
    '@/lib/phone': phone,
    '@/lib/storage': { readState: async () => { calls.reads++; return { state: { employees: roster } }; } },
    '@/lib/supabase/admin': { createAdminClient: () => ({ rpc: async (name, args) => { calls.counters.push({ name, args }); return rate; } }) },
    '@/lib/supabase/server': { hasSupabaseConfiguration: () => true, createClient: async () => ({ auth: { signOut: async () => { calls.signouts++; return { error: signoutError }; } } }) },
  }, env);
  return { ...route, calls };
}

test('employee phone login normalizes input, uses opaque shared counters, and signs out the email identity', async () => {
  const app = loginHarness();
  const response = await app.POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, redirectTo: '/' });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(app.calls.signouts, 1);
  assert.equal(app.calls.sessions[0].id, employee.id);
  const counter = app.calls.counters[0];
  assert.equal(counter.name, 'consume_employee_login_rate_limits');
  assert.match(counter.args.p_ip_hash, /^[0-9a-f]{64}$/);
  assert.match(counter.args.p_phone_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(counter.args.p_phone_hash, counter.args.p_ip_hash);
  assert.ok(!JSON.stringify(counter).includes('4155550123'));
  const formatted = loginHarness();
  await formatted.POST(request({ phone: '+14155550123' }));
  assert.equal(formatted.calls.counters[0].args.p_phone_hash, counter.args.p_phone_hash);
});

test('unknown, inactive, incomplete, and duplicate phone records all deny login without identity disclosure', async () => {
  let message;
  for (const roster of [[], [{ ...employee, active: false }], [{ ...employee, phoneVersion: undefined }], [employee, { ...employee, id: 'duplicate' }]]) {
    const app = loginHarness({ roster });
    const response = await app.POST(request());
    assert.equal(response.status, 401);
    const body = await response.json();
    message ??= body;
    assert.deepEqual(body, message);
    assert.equal(app.calls.sessions.length, 0);
    assert.equal(app.calls.counters.length, 1);
  }
});

test('rate limiting and database failures prevent all roster reads and session creation', async () => {
  for (const rate of [{ data: 30, error: null }, { data: null, error: Error('storage unavailable') }, { data: '0', error: null }, { data: -1, error: null }, { data: 901, error: null }]) {
    const app = loginHarness({ rate });
    const response = await app.POST(request());
    assert.equal(response.status, rate.data === 30 ? 429 : 503);
    if (rate.data === 30) assert.equal(response.headers.get('retry-after'), '30');
    assert.equal(app.calls.reads, 0);
    assert.equal(app.calls.sessions.length, 0);
  }
  const missingConfig = loginHarness({ env: {} });
  assert.equal((await missingConfig.POST(request())).status, 503);
  assert.equal(missingConfig.calls.counters.length, 0);
  const signoutFailure = loginHarness({ signoutError: Error('failed') });
  assert.equal((await signoutFailure.POST(request())).status, 503);
  assert.equal(signoutFailure.calls.sessions.length, 0);
});

test('phone login rejects cross-origin requests and malformed input, and ignores untrusted forwarding headers locally', async () => {
  const app = loginHarness();
  for (const origin of ['', 'null', 'https://other.example.test']) assert.equal((await app.POST(request(undefined, { origin }))).status, 403);
  for (const value of [null, {}, { phone: 'not a phone' }, { phone: '1'.repeat(513) }]) assert.equal((await app.POST(request(value))).status, 400);
  assert.equal(app.calls.counters.length, 0);
  const local = loginHarness({ env: { EMPLOYEE_SESSION_SECRET: secret } });
  await local.POST(request(undefined, { 'x-vercel-forwarded-for': '198.51.100.1' }));
  await local.POST(request(undefined, { 'x-vercel-forwarded-for': '198.51.100.2' }));
  assert.equal(local.calls.counters[0].args.p_ip_hash, local.calls.counters[1].args.p_ip_hash);
});
