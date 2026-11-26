'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const g = require('../services/authGuard');

const auth = g.createAuth('test-password-123');
const GOOD = { authorization: `Bearer ${auth.token}` };
const BAD = { authorization: 'Bearer deadbeef' };

// Runs the default-deny guard on a synthetic request; returns { status, passed }.
function run(method, url, headers = {}) {
  const [p] = url.split('?');
  const req = { method, baseUrl: '/api', path: p.replace(/^\/api/, '') || '/', headers };
  let status = null;
  let passed = false;
  const res = { status(c) { status = c; return this; }, json() { return this; } };
  auth.guard(req, res, () => { passed = true; });
  return { status, passed };
}

const PROTECTED = [
  ['GET', '/api/guests'], ['GET', '/api/guests?date=30/11/26'], ['GET', '/api/meetings'],
  ['GET', '/api/guests/stats'], ['GET', '/api/guests/active-count'],
  ['DELETE', '/api/guests/x'], ['PUT', '/api/guests/x/paid'], ['PATCH', '/api/guests/x'],
  ['PATCH', '/api/guests/x/wa-toggle'],
  ['POST', '/api/members'], ['PUT', '/api/members/5'], ['DELETE', '/api/members/5'],
  ['PUT', '/api/members/reorder'], ['PATCH', '/api/members/5/activate'], ['GET', '/api/members/count'],
  ['GET', '/api/birthdays/upcoming'], ['POST', '/api/members/5/wish-birthday'],
  ['GET', '/api/pdf/list'], ['GET', '/api/pdf/badges'], ['GET', '/api/pdf/members'],
  ['GET', '/api/voting/results'], ['GET', '/api/voting/winners'],
  ['POST', '/api/voting/open'], ['POST', '/api/voting/close'], ['POST', '/api/voting/reset'],
  ['POST', '/api/send-voting'], ['POST', '/api/send-contacts'],
  ['POST', '/api/whatsapp/send-catalog'], ['POST', '/api/whatsapp/send-confirmations'],
  ['POST', '/api/waha/restart'], ['GET', '/api/waha/qr'], ['GET', '/api/waha/status'],
  ['GET', '/api/presentations'], ['POST', '/api/presentations'], ['PUT', '/api/presentations/3'],
  ['PATCH', '/api/presentations/3/toggle'], ['DELETE', '/api/presentations/3'],
  ['GET', '/api/group-value'], ['GET', '/api/group-value/totals'], ['GET', '/api/group-value/summary'],
  ['POST', '/api/group-value'], ['PUT', '/api/group-value/1'], ['DELETE', '/api/group-value/1'],
  ['GET', '/api/meeting-stats'], ['GET', '/api/meeting-stats/totals'],
  ['POST', '/api/meeting-stats'], ['DELETE', '/api/meeting-stats/1'],
  ['GET', '/api/settings/next-meeting'], ['PATCH', '/api/settings/next-meeting'], ['PUT', '/api/settings'],
];

test('protected routes: 401 without token, 401 with a wrong token, pass with the right one', () => {
  for (const [m, u] of PROTECTED) {
    const none = run(m, u);
    assert.equal(none.status, 401, `${m} ${u} without token`);
    assert.equal(none.passed, false);
    const bad = run(m, u, BAD);
    assert.equal(bad.status, 401, `${m} ${u} with bad token`);
    const ok = run(m, u, GOOD);
    assert.equal(ok.passed, true, `${m} ${u} with good token`);
  }
});

const PUBLIC = [
  ['POST', '/api/admin/login'], ['GET', '/api/test'], ['POST', '/api/register'],
  ['GET', '/api/guests/abc123/public'], ['POST', '/api/guests/abc123/confirm'],
  ['POST', '/api/voting'], ['GET', '/api/voting/status'], ['GET', '/api/catalog'],
  ['GET', '/api/members?active=true'], ['GET', '/api/members/7'], ['GET', '/api/members/7/photo'],
  ['POST', '/api/members/7/photo'], ['GET', '/api/members/7/socials'], ['PUT', '/api/members/7/socials'],
  ['PATCH', '/api/members/7/profile'],
  ['GET', '/api/presentations/30%2F11%2F26'],
  ['GET', '/api/settings'],
];

test('public routes pass without a token', () => {
  for (const [m, u] of PUBLIC) {
    const r = run(m, u);
    assert.equal(r.passed, true, `${m} ${u}`);
  }
});

test('default-deny: unknown and future /api paths need a token', () => {
  for (const [m, u] of [['GET', '/api/new-feature'], ['POST', '/api/admin/users'], ['GET', '/api/members/7/secret'],
    ['DELETE', '/api/members/7/photo'], ['PUT', '/api/members/abc'], ['GET', '/api/'], ['GET', '/api/catalog/x'],
    ['POST', '/api/settings'], ['PUT', '/api/presentations/30%2F11%2F26/x']]) {
    assert.equal(run(m, u).status, 401, `${m} ${u}`);
    assert.equal(run(m, u, GOOD).passed, true, `${m} ${u} (admin)`);
  }
});

test('trailing slash and query string do not bypass the guard', () => {
  assert.equal(run('GET', '/api/guests/').status, 401);
  assert.equal(run('GET', '/api/guests?x=/api/test').status, 401);
  assert.equal(run('GET', '/api/test/').passed, true);
});

test('no password configured -> cannot build the auth (fail closed)', () => {
  assert.throws(() => g.createAuth(''));
  assert.throws(() => g.createAuth(undefined));
});

test('password check and token are constant-time and exact', () => {
  assert.equal(auth.checkPassword('test-password-123'), true);
  assert.equal(auth.checkPassword('test-password-12'), false);
  assert.equal(auth.checkPassword(''), false);
  assert.equal(auth.checkPassword(undefined), false);
  assert.equal(auth.isAdminRequest({ headers: { authorization: 'Bearer ' } }), false);
  assert.equal(auth.isAdminRequest({ headers: { authorization: auth.token } }), false); // no "Bearer "
  assert.equal(auth.isAdminRequest({ headers: GOOD }), true);
  assert.notEqual(g.makeStaticToken('bni2024'), auth.token);
});

test('/api/settings without a token has no notification, mail or phone keys', () => {
  const all = {
    meeting_location: 'Rishon', meeting_waze_url: 'https://waze.com/x', meeting_type: 'zoom',
    meeting_zoom_url: 'https://zoom.us/j/1', unconfirmed_notify_phone: '972501234567',
    mail_intake_notify_phone: '972501234567', mail_intake_mode: 'test', next_meeting_date: '30/11/26',
  };
  const pub = g.filterSettings(all, false);
  assert.deepEqual(Object.keys(pub).sort(), ['meeting_location', 'meeting_type', 'meeting_waze_url']);
  assert.equal(JSON.stringify(pub).includes('9725'), false);
  assert.deepEqual(g.filterSettings(all, true), all);
});

test('public member shapes drop birthday/phone where pages do not need them', () => {
  const m = { id: 1, name: 'A', name_he: 'א', profession: 'P', phone: '050', birthday: '01/01', photo: 'x.jpg', active: 1, sort_order: 3 };
  assert.deepEqual(g.publicMemberList(m), { id: 1, name: 'A', profession: 'P', photo: 'x.jpg' });
  assert.deepEqual(g.publicMemberProfile(m), { id: 1, name: 'A', profession: 'P', phone: '050', birthday: '01/01', photo: 'x.jpg' });
  assert.deepEqual(g.publicCatalogMember({ ...m, socials: [1] }), { id: 1, name: 'A', profession: 'P', phone: '050', photo: 'x.jpg', socials: [1] });
});

test('login limiter: 10 failures in 15 minutes block, then the window expires', () => {
  let t = 1_000_000;
  const lim = g.createLoginLimiter({ max: 10, windowMs: 15 * 60 * 1000, now: () => t });
  for (let i = 0; i < 9; i++) { lim.recordFailure('1.1.1.1'); t += 1000; }
  assert.equal(lim.isBlocked('1.1.1.1'), false);
  lim.recordFailure('1.1.1.1');
  assert.equal(lim.isBlocked('1.1.1.1'), true);
  assert.equal(lim.isBlocked('2.2.2.2'), false);
  assert.ok(lim.retryAfterSec('1.1.1.1') > 0);
  t += 15 * 60 * 1000;
  assert.equal(lim.isBlocked('1.1.1.1'), false);
  assert.equal(lim.size(), 0);
});

test('client IP: X-Real-IP only from the local proxy, never from a remote peer', () => {
  const local = { socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-real-ip': '5.5.5.5', 'x-forwarded-for': '9.9.9.9' } };
  assert.equal(g.clientIp(local), '5.5.5.5');
  const remote = { socket: { remoteAddress: '8.8.8.8' }, headers: { 'x-real-ip': '5.5.5.5' } };
  assert.equal(g.clientIp(remote), '8.8.8.8');
});

// ─── Static checks against the real files ─────────────────────────────────────

const ROOT = path.join(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('server.js: every /api route is either public or answers 401 without a token', () => {
  const re = /app\.(get|post|put|patch|delete)\(\s*'(\/api\/[^']*)'/g;
  const routes = [];
  let m;
  while ((m = re.exec(serverSrc))) routes.push([m[1].toUpperCase(), m[2]]);
  assert.ok(routes.length > 60, `found only ${routes.length} routes`);
  for (const [method, p] of routes) {
    const url = p.replace(/:num\b/g, '1').replace(/:[A-Za-z]+/g, 'x');
    const r = run(method, url);
    assert.ok(r.passed || r.status === 401, `${method} ${p}`);
    if (!g.isPublicRoute(method, url)) assert.equal(r.status, 401, `${method} ${p} must be protected`);
  }
});

test('every PUBLIC_ROUTES entry exists in server.js (nothing extra is public)', () => {
  const norm = p => p.replace(/:[A-Za-z]+/g, ':p');
  const have = new Set();
  for (const m of serverSrc.matchAll(/app\.(get|post|put|patch|delete)\(\s*'(\/api\/[^']*)'/g)) have.add(`${m[1].toUpperCase()} ${norm(m[2])}`);
  for (const r of g.PUBLIC_ROUTES) {
    assert.ok(have.has(`${r.method} ${norm(r.path)}`), `${r.method} ${r.path} is public but not defined in server.js`);
  }
});

test('public pages only call public API routes (admin.html / presentations.html editors excluded)', () => {
  for (const f of ['guest', 'confirm', 'member', 'members-catalog', 'profile', 'voting']) {
    const html = fs.readFileSync(path.join(ROOT, 'public', `${f}.html`), 'utf8');
    for (const m of html.matchAll(/\/api\/[A-Za-z0-9_\-/${}.]*/g)) {
      const url = m[0].replace(/\$\{[^}]*\}/g, '7').replace(/\/+$/, '');
      const ok = ['GET', 'POST', 'PUT', 'PATCH'].some(me => g.isPublicRoute(me, url));
      assert.ok(ok, `${f}.html calls ${m[0]} which is not public`);
    }
  }
});

test('server.js: no fallback password, guard registered before other /api routes', () => {
  assert.equal(serverSrc.includes('bni2024'), false);
  const guardAt = serverSrc.indexOf("app.use('/api', auth.guard)");
  assert.ok(guardAt > 0);
  const firstRoute = serverSrc.search(/app\.(get|post|put|patch|delete)\(\s*'\/api\/(?!admin\/login)/);
  assert.ok(guardAt < firstRoute, 'guard must come before the first /api route');
  assert.match(serverSrc, /if \(!process\.env\.ADMIN_PASSWORD\) \{[\s\S]*process\.exit\(1\)/);
});
