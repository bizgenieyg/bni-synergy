'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const w = require('../services/wahaSession');

test('window state by WAHA status: all 5 statuses and "WAHA unavailable"', () => {
  assert.equal(w.pickWindowState('WORKING'), 'connected');
  assert.equal(w.pickWindowState('SCAN_QR_CODE'), 'scan');
  assert.equal(w.pickWindowState('STARTING'), 'starting');
  assert.equal(w.pickWindowState('STOPPED'), 'restart');
  assert.equal(w.pickWindowState('FAILED'), 'restart');
  assert.equal(w.pickWindowState('UNAVAILABLE'), 'unavailable');
  assert.equal(w.pickWindowState(undefined), 'unavailable');
  assert.equal(w.pickWindowState('SOMETHING_NEW'), 'unavailable');
  assert.equal(w.pickWindowState('NOT_FOUND'), 'restart'); // session does not exist yet: start it
});

test('poll intervals: 3 s on QR, 2 s while starting', () => {
  assert.equal(w.pollIntervalMs('scan'), 3000);
  assert.equal(w.pollIntervalMs('starting'), 2000);
});

function recovery(extra = {}) {
  let t = 1_000_000;
  const calls = [];
  const logs = [];
  const r = w.createAutoRecovery({
    restart: async s => { calls.push(s); if (extra.fail) throw new Error('boom'); },
    now: () => t, log: m => logs.push(m), onProblem: extra.onProblem,
  });
  return { r, calls, logs, tick: ms => { t += ms; } };
}

test('auto-restart: FAILED restarts once, then waits 5 minutes', async () => {
  const { r, calls, tick } = recovery();
  assert.equal((await r.check('default', 'FAILED')).action, 'restarted');
  tick(60_000);
  assert.equal((await r.check('default', 'FAILED')).action, 'cooldown');
  tick(3 * 60_000);
  assert.equal((await r.check('default', 'FAILED')).action, 'cooldown'); // 4 min total
  tick(61_000);
  assert.equal((await r.check('default', 'STOPPED')).action, 'restarted'); // > 5 min
  assert.deepEqual(calls, ['default', 'default']);
});

test('auto-restart: never on WORKING, SCAN_QR_CODE, STARTING, UNAVAILABLE', async () => {
  const { r, calls } = recovery();
  for (const s of ['WORKING', 'SCAN_QR_CODE', 'STARTING', 'UNAVAILABLE', 'NOT_FOUND']) {
    assert.equal((await r.check('default', s)).action, 'none', s);
  }
  assert.equal(calls.length, 0);
});

test('auto-restart: sessions have independent limits; pause blocks until resume', async () => {
  const { r, calls } = recovery();
  assert.equal((await r.check('a', 'FAILED')).action, 'restarted');
  assert.equal((await r.check('b', 'FAILED')).action, 'restarted');
  r.pause('a');
  // a deliberate disconnect (STOPPED) must not be undone by the watchdog
  assert.equal((await r.check('a', 'STOPPED')).action, 'paused');
  r.resume('a');
  assert.equal((await r.check('a', 'STOPPED')).action, 'restarted');
  assert.deepEqual(calls, ['a', 'b', 'a']);
});

test('auto-restart: a failed restart still counts toward the cooldown and is logged without secrets', async () => {
  const { r, calls, logs, tick } = recovery({ fail: true });
  assert.equal((await r.check('default', 'FAILED')).action, 'restart_failed');
  tick(30_000);
  assert.equal((await r.check('default', 'FAILED')).action, 'cooldown');
  assert.equal(calls.length, 1);
  assert.ok(logs.some(l => l.includes('failed')));
});

test('last problem: recorded on status change only, with time and status', async () => {
  const seen = [];
  const { r, tick } = recovery({ onProblem: (s, p) => seen.push([s, p.status]) });
  await r.check('default', 'WORKING');
  assert.equal(r.lastProblem('default'), null);
  tick(1000);
  await r.check('default', 'FAILED');
  const p1 = r.lastProblem('default');
  assert.equal(p1.status, 'FAILED');
  assert.ok(!Number.isNaN(Date.parse(p1.at)));
  tick(60_000);
  await r.check('default', 'FAILED'); // same status: time is not overwritten
  assert.equal(r.lastProblem('default').at, p1.at);
  await r.check('default', 'WORKING'); // recovered: the last problem stays visible
  assert.equal(r.lastProblem('default').status, 'FAILED');
  assert.deepEqual(seen, [['default', 'FAILED']]);
});

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body, headers: opts.headers });
    const key = `${opts.method || 'GET'} ${new URL(url).pathname}`;
    const hit = routes[key];
    if (!hit) return { ok: false, status: 404, json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
    if (hit instanceof Error) throw hit;
    return { ok: hit.status < 400, status: hit.status, json: async () => hit.body || {}, arrayBuffer: async () => hit.buf || new ArrayBuffer(0) };
  };
  f.calls = calls;
  return f;
}

test('client.getSession: WORKING with pushName and number, 404, network error', async () => {
  const f = fakeFetch({ 'GET /api/sessions/default': { status: 200, body: { status: 'WORKING', me: { id: '972525159393@c.us', pushName: 'BNI Synergy' } } } });
  const c = w.createWahaClient({ url: 'http://x:1', apiKey: 'K', fetchImpl: f });
  assert.deepEqual(await c.getSession('default'), { status: 'WORKING', me: { pushName: 'BNI Synergy', number: '972525159393' } });
  assert.equal(f.calls[0].headers['X-Api-Key'], 'K');
  assert.equal((await c.getSession('nope')).status, 'NOT_FOUND');
  const down = w.createWahaClient({ url: 'http://x:1', fetchImpl: fakeFetch({ 'GET /api/sessions/default': new Error('ECONNREFUSED') }) });
  assert.deepEqual(await down.getSession('default'), { status: 'UNAVAILABLE', me: null });
});

test('client.getQr: PNG data URL on 200, null on 422', async () => {
  const buf = Uint8Array.from([137, 80, 78, 71]).buffer;
  const c = w.createWahaClient({ url: 'http://x:1', fetchImpl: fakeFetch({ 'GET /api/s1/auth/qr': { status: 200, buf }, 'GET /api/s2/auth/qr': { status: 422 } }) });
  assert.match(await c.getQr('s1'), /^data:image\/png;base64,iVBORw==$/);
  assert.equal(await c.getQr('s2'), null);
});

test('client.restart falls back to start; disconnect = logout + stop; session name is URL-encoded', async () => {
  const f = fakeFetch({ 'POST /api/sessions/g1/restart': { status: 404 }, 'POST /api/sessions/start': { status: 201 },
    'POST /api/sessions/g1/logout': { status: 200 }, 'POST /api/sessions/g1/stop': { status: 200 } });
  const c = w.createWahaClient({ url: 'http://x:1', fetchImpl: f });
  await c.restart('g1');
  assert.deepEqual(f.calls.map(x => x.url.replace('http://x:1', '')), ['/api/sessions/g1/restart', '/api/sessions/start']);
  assert.deepEqual(JSON.parse(f.calls[1].body), { name: 'g1' });
  await c.disconnect('g1');
  assert.ok(f.calls.some(x => x.url.endsWith('/logout')) && f.calls.some(x => x.url.endsWith('/stop')));
  await assert.rejects(() => w.createWahaClient({ url: 'http://x:1', fetchImpl: fakeFetch({}) }).restart('zz'));
});

test('client.requestCode: returns the code, or the WAHA refusal (422 outside SCAN_QR_CODE)', async () => {
  const f = fakeFetch({
    'POST /api/ok/auth/request-code': { status: 201, body: { code: 'ABCD-EFGH' } },
    'POST /api/bad/auth/request-code': { status: 422, body: { message: 'Can request code only in SCAN_QR_CODE status.' } },
  });
  const c = w.createWahaClient({ url: 'http://x:1', fetchImpl: f });
  assert.deepEqual(await c.requestCode('ok', '972501234567'), { ok: true, code: 'ABCD-EFGH' });
  assert.deepEqual(JSON.parse(f.calls[0].body), { phoneNumber: '972501234567' });
  const bad = await c.requestCode('bad', '972501234567');
  assert.equal(bad.ok, false);
  assert.equal(bad.status, 422);
});

test('phone number for pairing: digits only, 8-15 digits; session names are validated', () => {
  assert.equal(w.cleanPhoneNumber('+972 50-123 4567'), '972501234567');
  assert.equal(w.cleanPhoneNumber('123'), '');
  assert.equal(w.cleanPhoneNumber(''), '');
  assert.equal(w.cleanPhoneNumber('1'.repeat(16)), '');
  assert.equal(w.isValidSession('default'), true);
  assert.equal(w.isValidSession('group-12_a'), true);
  assert.equal(w.isValidSession('../x'), false);
  assert.equal(w.isValidSession(''), false);
  assert.equal(w.isValidSession('a b'), false);
});

test('number from WAHA id', () => {
  assert.equal(w.numberFromId('972525159393@c.us'), '972525159393');
  assert.equal(w.numberFromId('972525159393:15@s.whatsapp.net'), '972525159393');
  assert.equal(w.numberFromId(undefined), '');
});
