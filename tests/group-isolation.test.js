'use strict';

// Task 17b: no data of one group may be visible in, or changed by, another group.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-'));
process.env.DB_PATH = path.join(TMP, 'iso.db');
process.env.BACKUP_DIR = path.join(TMP, 'backups');

const test = require('node:test');
const assert = require('node:assert/strict');
const dbm = require('../services/db');
const mig = require('../services/groupsMigration');
const { createGroups } = require('../services/groups');
const { createGroupScheduler } = require('../services/groupScheduler');
const { computeVisitCounts } = require('../services/visitCounts');

const ROOT = path.join(__dirname, '..');
const groups = createGroups(dbm, { now: () => new Date('2026-11-26T10:00:00Z'), log: () => {} });
const A = 1;
const B = groups.createGroup({ name: 'Second Group', slug: 'second' }).group.id;

// ─── Regression guard ─────────────────────────────────────────────────────────

// Only these tables may exist without group_id: `groups` itself and the global system settings.
const NO_GROUP_ID_OK = new Set(['groups', 'settings', 'sqlite_sequence']);

test('GUARD: every table has group_id (new table without group_id fails the build)', () => {
  const tables = dbm.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  const missing = tables.filter(t => !NO_GROUP_ID_OK.has(t) && !mig.hasColumn(dbm.db, t, 'group_id'));
  assert.deepEqual(missing, [], `tables without group_id: ${missing.join(', ')}. Add group_id or (system data only) extend NO_GROUP_ID_OK deliberately.`);
});

test('GUARD: the global settings table keeps no group-level key; touching one throws', () => {
  for (const k of mig.GROUP_SETTING_KEYS.concat(['meeting_type', 'meeting_location'])) {
    assert.throws(() => dbm.setSetting(k, 'x'), /belongs to a group/);
    assert.throws(() => dbm.getSetting(k), /belongs to a group/);
  }
  const keys = dbm.db.prepare('SELECT key FROM settings').all().map(r => r.key);
  assert.deepEqual(keys.filter(k => mig.GROUP_SETTING_KEYS.includes(k)), []);
  dbm.setSetting('waha_last_problem:x', '{}');
  assert.equal(dbm.getSetting('waha_last_problem:x'), '{}');
});

// Values that belong to group 1 (or to the old PayBox/Sheets setup). They may live in the DB and, as one-time
// migration seeds, in services/groupsMigration.js; they must never appear in code, templates or pages.
const FORBIDDEN_LITERALS = [
  'BNI SYNERGY', 'BNI Synergy', 'Ришон', 'Нес Цион', 'נס ציונה', 'השריון',
  'hsv8txufjn', '82828722073', '1PXaN6Uxgg', '7SB6P3stE6b', 'payboxapp',
  '972523695741', '972528191040', '1QIDMcAeMupan0oGjsQwMgi4vB5oeTgfOV', 'Тронза', 'в 7:30', '>7:30<',
];
// Not scanned: the one-time seed of group 1, the legacy admin.html fallback (served only when the React build
// is missing), message texts that task 19 turns into templates are NOT excluded - they carry no group data.
const SCAN_SKIP = new Set(['services/groupsMigration.js', 'public/admin.html']);

function codeFiles() {
  const out = ['server.js', 'src/App.tsx', 'src/i18n.ts'];
  for (const dir of ['services', 'public']) {
    for (const f of fs.readdirSync(path.join(ROOT, dir))) {
      if (/\.(js|html)$/.test(f)) out.push(`${dir}/${f}`);
    }
  }
  return out.filter(f => !SCAN_SKIP.has(f));
}

test('GUARD: no group data (names, addresses, links, phones, meeting time) is hard-coded in code or templates', () => {
  const bad = [];
  for (const f of codeFiles()) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const lit of FORBIDDEN_LITERALS) if (text.includes(lit)) bad.push(`${f}: "${lit}"`);
    if (/process\.env\.(WAHA_GROUP_ID|GOOGLE_SHEET_ID)/.test(text)) bad.push(`${f}: group data from env`);
  }
  assert.deepEqual(bad, []);
});

test('the PayBox webhook and its secrets are gone from the repository', () => {
  const files = [...codeFiles(), 'README.md', 'services/groupsMigration.js', 'scripts/import-guests.js'];
  const bad = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (/paybox-webhook|PAYBOX_WEBHOOK_SECRET|PAYBOX_SECRET|webhookKeyOk/i.test(text)) bad.push(f);
  }
  assert.deepEqual(bad, []);
  assert.ok(!require('../services/authGuard').PUBLIC_ROUTES.some(r => /paybox/i.test(r.path)));
});

test('Google Sheets is still called by registration, so it stays; its ID is only a group setting (no hard-coded sheet)', () => {
  const imp = fs.readFileSync(path.join(ROOT, 'scripts/import-guests.js'), 'utf8');
  assert.ok(!/1QIDMc/.test(imp));
  assert.match(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'), /sheets\.appendGuest/);
});

// ─── Settings isolation ───────────────────────────────────────────────────────

test('settings: changing every setting of group A leaves group B untouched', () => {
  const before = JSON.stringify([groups.getGroup(B), dbm.getGroupSettings(B)]);
  groups.updateGroup(A, { name: 'A changed', address: 'Somewhere', waze_url: 'https://waze.com/a', zoom_url: 'https://zoom.us/a',
    payment_url: 'https://pay/a', payment_amount: 55, meeting_weekday: 3, meeting_time: '18:00', meeting_type: 'zoom',
    default_language: 'he', facebook_url: 'https://facebook.com/a', timezone: 'America/New_York', waha_session: 'a-session',
    whatsapp_chat_id: 'a@g.us', sheet_id: 'sheet-a' });
  for (const k of mig.GROUP_SETTING_KEYS) dbm.setGroupSetting(A, k, 'A-' + k);
  assert.equal(JSON.stringify([groups.getGroup(B), dbm.getGroupSettings(B)]), before);
  // and the other way round
  const beforeA = JSON.stringify([groups.getGroup(A), dbm.getGroupSettings(A)]);
  groups.updateGroup(B, { address: 'B street', meeting_type: 'zoom', default_language: 'en' });
  dbm.setGroupSetting(B, 'voting_open', '1');
  assert.equal(JSON.stringify([groups.getGroup(A), dbm.getGroupSettings(A)]), beforeA);
  assert.equal(groups.getGroup(B).default_language, 'en');
  assert.equal(groups.getGroup(A).default_language, 'he');
  groups.updateGroup(A, { name: 'BNI Synergy', default_language: 'ru', meeting_type: 'offline', timezone: 'Asia/Jerusalem', meeting_weekday: 1, meeting_time: '07:30' });
  dbm.setGroupSetting(A, 'voting_open', '0');
});

test('a fresh group starts empty: defaults only, nothing copied from group 1', () => {
  const g = groups.createGroup({ name: 'Third', slug: 'third' }).group;
  assert.equal(g.default_language, 'he');   // groups other than group 1 are Hebrew-speaking by default
  assert.equal(g.address, ''); assert.equal(g.payment_url, ''); assert.equal(g.meeting_weekday, null);
  assert.equal(g.waha_session, 'third');
  assert.equal(dbm.getGroupSetting(g.id, 'voting_open'), '0');
  assert.equal(dbm.getGroupSetting(g.id, 'next_meeting_date'), null);
  assert.equal(dbm.getActiveMembers(g.id).length + dbm.getAllGuests(g.id).length + groups.listPositions(g.id).length, 0);
  assert.ok(groups.createGroup({ name: 'x', slug: 'third' }).error);   // slug is unique
  assert.ok(groups.createGroup({ name: 'x', slug: 'Bad Slug!' }).error);
});

// ─── Data isolation ───────────────────────────────────────────────────────────

test('data: guests, members, votes, presentations, stats, group value, positions of A are invisible in B', () => {
  const ma = dbm.insertMember({ name: 'Anna Alpha', phone: '0501000001', groupId: A });
  const mb = dbm.insertMember({ name: 'Boris Beta', phone: '0502000002', groupId: B });
  dbm.insertGuest({ name: 'Guest Of A', phone: '0541111111', invitedBy: 'Anna Alpha', invitedByMemberId: ma, meetingDate: '30/11/26', groupId: A });
  dbm.insertGuest({ name: 'Guest Of B', phone: '0542222222', invitedBy: 'Boris Beta', invitedByMemberId: mb, meetingDate: '30/11/26', groupId: B });
  assert.deepEqual(dbm.getGuestsByDate('30/11/26', A).map(g => g.name), ['Guest Of A']);
  assert.deepEqual(dbm.getGuestsByDate('30/11/26', B).map(g => g.name), ['Guest Of B']);
  assert.deepEqual(dbm.getAllGuests(B).map(g => g.name), ['Guest Of B']);
  assert.deepEqual(dbm.getAllMembers(B).map(m => m.name), ['Boris Beta']);
  assert.equal(dbm.findDuplicateGuest('30/11/26', '0541111111', 'Guest Of A', B), null);
  // search by inviter name stays inside the group
  assert.deepEqual(dbm.getAllGuests(B).filter(g => g.invitedBy.toLowerCase().includes('anna')).map(g => g.name), []);

  dbm.insertAnonymousVote({ meetingDate: '30/11/26', candidateId: ma, candidateName: 'Anna', groupId: A });
  assert.equal(dbm.getVoteCount('30/11/26', A), 1);
  assert.equal(dbm.getVoteCount('30/11/26', B), 0);
  assert.deepEqual(dbm.getVoteResults('30/11/26', B), []);
  dbm.insertVote({ meetingDate: '01/12/26', voterPhone: '0549999999', voterName: 'v', candidateId: ma, candidateName: 'Anna', groupId: A });
  assert.equal(dbm.hasVoted('01/12/26', '0549999999', A), true);
  assert.equal(dbm.hasVoted('01/12/26', '0549999999', B), false);   // the same person can still vote in group B
  dbm.deleteVotesByDate('30/11/26', B);
  assert.equal(dbm.getVoteCount('30/11/26', A), 1);                  // resetting B did not touch A

  dbm.upsertPresentationByDate('30/11/26', { member_id: ma, member_name: 'Anna' }, A);
  assert.equal(dbm.getPresentationByDate('30/11/26', B), null);
  assert.equal(dbm.getPresentations(null, B).length, 0);
  dbm.upsertMeetingStats('30/11/26', { referrals: 5 }, A);
  assert.equal(dbm.getAllMeetingStats(B).length, 0);
  assert.equal(dbm.getMeetingStatsTotals(null, B).total_referrals || 0, 0);
  dbm.upsertGroupValue({ meeting_date: '30/11/26', member_id: ma, member_name: 'Anna', referrals: 3, groupId: A });
  assert.equal(dbm.getGroupValue(null, B).length, 0);
  assert.equal((dbm.getGroupValueTotals(B) || {}).total_referrals || 0, 0);

  dbm.setMemberSocials(ma, [{ platform: 'instagram', url: 'https://i/a' }]);
  assert.equal(dbm.db.prepare('SELECT group_id FROM member_socials WHERE member_id = ?').get(ma).group_id, A);

  groups.updateGroup(B, {});
  dbm.db.prepare("INSERT INTO positions (group_id, code, name_he) VALUES (?, 'chair', 'x')").run(B);
  assert.equal(groups.listPositions(A).filter(p => p.group_id === B).length, 0);
  assert.equal(groups.listPositions(B).length >= 1, true);
  const pa = groups.listPositions(A)[0];
  if (pa) assert.ok(groups.setMemberPositions(mb, [{ position_id: pa.id }]).error); // cannot cross groups
});

test('visit counter: one phone in two groups is counted separately per group', () => {
  const phone = '0548888888';
  for (const d of ['02/11/26', '09/11/26', '16/11/26']) dbm.insertGuest({ name: 'Dual A', phone, meetingDate: d, groupId: A });
  dbm.insertGuest({ name: 'Dual B', phone, meetingDate: '23/11/26', groupId: B });
  const countsA = computeVisitCounts(dbm.getAllGuests(A));
  const countsB = computeVisitCounts(dbm.getAllGuests(B));
  const lastA = dbm.getAllGuests(A).filter(g => g.name === 'Dual A').map(g => countsA.get(g.id).visitsAll).sort();
  assert.deepEqual(lastA, [1, 2, 3]);                       // group B's visit did not raise A's counter
  const b = dbm.getAllGuests(B).find(g => g.name === 'Dual B');
  assert.equal(countsB.get(b.id).visitsAll, 1);             // A's three visits did not raise B's counter
});

test('payment webhook lookup can be limited to one group', () => {
  assert.equal(dbm.findGuestByPhone('0548888888', B).name, 'Dual B');
  assert.equal(dbm.findGuestByPhone('0542222222', A), null);
});

// ─── Background jobs ──────────────────────────────────────────────────────────

test('scheduler: each group in its own time zone; a failing group does not stop the other', async () => {
  const gs = [
    { id: 1, slug: 'a', timezone: 'Asia/Jerusalem', meeting_weekday: 1 },
    { id: 2, slug: 'b', timezone: 'America/New_York', meeting_weekday: 1 },
    { id: 3, slug: 'c', timezone: 'UTC', meeting_weekday: null },
  ];
  const ran = []; const errors = [];
  let now = new Date('2026-11-26T08:00:00Z'); // Thu 10:00 Jerusalem, Thu 03:00 New York, Thu 08:00 UTC
  const sched = createGroupScheduler({
    listGroups: () => gs, now: () => now, log: () => {}, logError: m => errors.push(m),
    jobs: [
      { name: 'wave', offsetDays: 3, time: '10:00', run: g => { if (g.id === 1) throw new Error('no WhatsApp session'); ran.push(['wave', g.id]); } },
      { name: 'daily', daily: true, time: '08:00', run: g => { ran.push(['daily', g.id]); } },
    ],
  });
  await sched.tick();
  assert.deepEqual(ran, [['daily', 3]]);         // group 3 has no weekday (daily jobs only); group 2 is not due yet
  assert.equal(errors.length, 1);                // group 1's wave failed ...
  assert.match(errors[0], /group 1 .*wave.*no WhatsApp session/);   // ... logged with the group id
  now = new Date('2026-11-26T08:00:20Z'); await sched.tick();       // same minute: nothing repeats
  assert.deepEqual(ran, [['daily', 3]]);
  assert.equal(errors.length, 1);
  now = new Date('2026-11-26T15:00:00Z');                            // 10:00 in New York
  await sched.tick();
  assert.deepEqual(ran, [['daily', 3], ['wave', 2]]);                // group 2 runs although group 1 failed earlier
});

test('scheduler: jobs of a group run with its own WhatsApp session and notify recipient', async () => {
  const sessions = { 1: 'default', 2: 'second' };
  const sentVia = [];
  const send = (gid, phone) => sentVia.push([sessions[gid], phone]);
  dbm.db.exec('DELETE FROM member_positions; DELETE FROM positions');   // the real file's positions were seeded at startup
  dbm.db.prepare("INSERT OR IGNORE INTO positions (group_id, code, notify_unconfirmed) VALUES (?, 'hosp', 1)").run(A);
  const ma = dbm.insertMember({ name: 'Head A', phone: '0503000001', groupId: A });
  const mb = dbm.insertMember({ name: 'Head B', phone: '0503000002', groupId: B });
  const posA = dbm.db.prepare("SELECT id FROM positions WHERE group_id = ? AND code = 'hosp'").get(A).id;
  dbm.db.prepare("INSERT OR IGNORE INTO positions (group_id, code, notify_unconfirmed) VALUES (?, 'hosp', 1)").run(B);
  const posB = dbm.db.prepare("SELECT id FROM positions WHERE group_id = ? AND code = 'hosp'").get(B).id;
  groups.setMemberPositions(ma, [{ position_id: posA, is_head: 1 }]);
  groups.setMemberPositions(mb, [{ position_id: posB, is_head: 1 }]);
  send(1, groups.unconfirmedNotifyPhone(1));
  send(2, groups.unconfirmedNotifyPhone(2));
  assert.deepEqual(sentVia, [['default', '972503000001'], ['second', '972503000002']]);
});

// ─── The running server: public API, group resolution, language ───────────────

let server, port, base;
const get = async (p, headers = {}) => { const r = await fetch(base + p, { headers }); return { status: r.status, body: await r.json().catch(() => null) }; };

test('server: start', async () => {
  port = 39000 + Math.floor(Math.random() * 900);
  base = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(port), ADMIN_PASSWORD: 'iso-test-pw', WAHA_URL: 'http://127.0.0.1:1', MAIL_INTAKE_SECRET: '' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/test')).ok) return; } catch {} await new Promise(r => setTimeout(r, 250)); }
  assert.fail('server did not start');
});

const token = () => require('../services/authGuard').makeStaticToken('iso-test-pw');
const admin = () => ({ Authorization: 'Bearer ' + token() });

test('server: public /api/settings returns only the requested group, never another one', async () => {
  const a = (await get('/api/settings?group=synergy')).body;
  const b = (await get('/api/settings?group=second')).body;
  assert.equal(a.group_name, 'BNI Synergy');
  assert.equal(b.group_name, 'Second Group');
  assert.equal(b.meeting_location, 'B street');
  assert.notEqual(a.meeting_location, b.meeting_location);
  assert.equal(b.meeting_type, 'zoom');
  for (const k of Object.keys(b)) assert.ok(['meeting_location', 'meeting_waze_url', 'meeting_type', 'meeting_time', 'meeting_weekday', 'group_name', 'default_language'].includes(k), `unexpected public key ${k}`);
});

test('server: unknown group is an error; no group parameter is the legacy group 1; ?group_id= is admin only', async () => {
  assert.equal((await get('/api/settings?group=nope')).status, 404);
  assert.equal((await get('/api/catalog?group=nope')).status, 404);
  assert.equal((await get('/api/members?group=nope')).status, 404);
  const legacy = (await get('/api/settings')).body;                    // old link without a group = group 1, on purpose
  assert.equal(legacy.group_name, (await get('/api/settings?group=synergy')).body.group_name);
  // a public caller cannot pick a group through group_id: it is ignored (group 1), not honoured
  assert.equal((await get('/api/settings?group_id=2')).body.group_name, legacy.group_name);
  assert.equal((await get('/api/group?group_id=2')).status, 401);
  assert.equal((await get('/api/group?group_id=abc', admin())).status, 400);
  assert.equal((await get('/api/group?group_id=999', admin())).status, 404);
  assert.equal((await get('/api/group?group_id=2', admin())).body.name, 'Second Group');
  const guestPage = await fetch(base + '/guest?group=nope');
  assert.equal(guestPage.status, 404);
});

test('server: members, catalog and voting status are per group', async () => {
  const ca = (await get('/api/catalog?group=synergy')).body.map(m => m.name);
  const cb = (await get('/api/catalog?group=second')).body.map(m => m.name);
  assert.ok(ca.includes('Anna Alpha') && !ca.includes('Boris Beta'));
  assert.deepEqual(cb.filter(n => n.startsWith('Head') || n.startsWith('Boris')).sort(), ['Boris Beta', 'Head B']);
  const vb = (await get('/api/voting/status?group=second')).body;
  const va = (await get('/api/voting/status?group=synergy')).body;
  assert.equal(vb.open, true);                // opened above for B
  assert.equal(va.open, false);
});

test('language: the server stores none; only the group default changes, only by an admin, never per user', async () => {
  assert.equal(dbm.db.prepare("SELECT COUNT(*) c FROM settings WHERE key LIKE '%lang%'").get().c, 0);
  assert.equal(dbm.db.prepare("SELECT COUNT(*) c FROM group_settings WHERE key LIKE '%lang%'").get().c, 0);
  const put = async (h, body) => (await fetch(base + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) })).status;
  assert.equal(await put({}, { key: 'lang', value: 'he' }), 401);        // no token
  assert.equal(await put(admin(), { key: 'lang', value: 'he' }), 400);   // not a settings key at all
  const before = (await get('/api/group?group_id=2', admin())).body.default_language;
  await fetch(base + '/api/group?group_id=1', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...admin() }, body: JSON.stringify({ default_language: 'en' }) });
  assert.equal((await get('/api/group?group_id=2', admin())).body.default_language, before); // other group unchanged
  assert.equal((await get('/api/group?group_id=1', admin())).body.default_language, 'en');
  const src = fs.readFileSync(path.join(ROOT, 'src', 'App.tsx'), 'utf8') + fs.readFileSync(path.join(ROOT, 'src', 'i18n.ts'), 'utf8');
  assert.ok(/localStorage\.setItem\('lang'/.test(src));                  // the user's choice goes to the browser
  assert.ok(!/api\([^)]*lang/i.test(src.replace(/default_language/g, '')));  // never sent to the server by the UI
});

test('server: stop', () => { if (server) server.kill(); });

// ─── Group creation script ────────────────────────────────────────────────────

test('scripts/create-group.js creates an empty group and refuses a duplicate slug', () => {
  const env = { ...process.env, DB_PATH: path.join(TMP, 'script.db'), BACKUP_DIR: path.join(TMP, 'b2') };
  const run = args => spawnSync(process.execPath, ['scripts/create-group.js', ...args], { cwd: ROOT, env, encoding: 'utf8' });
  const ok = run(['Rehovot Group', 'rehovot']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /slug=rehovot/);
  assert.match(ok.stdout, /default_language=he/);
  const Database = require('better-sqlite3');
  const sdb = new Database(env.DB_PATH, { readonly: true });
  assert.equal(sdb.prepare("SELECT default_language l FROM groups WHERE slug = 'rehovot'").get().l, 'he');
  assert.equal(sdb.prepare("SELECT default_language l FROM groups WHERE id = 1").get().l, 'ru');
  sdb.close();
  const dup = run(['Again', 'rehovot']);
  assert.notEqual(dup.status, 0);
  assert.match(dup.stderr, /already taken/);
  assert.notEqual(run(['only-name']).status, 0);
});

// ─── Positions file (the real format) ─────────────────────────────────────────

test('positions-he.json: real file format seeds positions and assignments, idempotently', () => {
  const file = path.join(ROOT, 'scripts', 'positions-he.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(data.positions.length >= 4);
  const g = groups.createGroup({ name: 'Seed Group', slug: 'seedgrp' }).group;
  for (const a of data.assignments) {
    if (!dbm.db.prepare('SELECT 1 FROM members WHERE group_id = ? AND name_he = ?').get(g.id, a.name_he)) {
      dbm.insertMember({ name: a.name_ru_hint || a.name_he, name_he: a.name_he, groupId: g.id });
    }
  }
  const log = [];
  const r1 = mig.seedPositionsFromFile(dbm.db, file, { groupId: g.id, log: m => log.push(m) });
  assert.equal(r1.positions, data.positions.length);
  assert.equal(r1.assigned, data.assignments.length);
  assert.equal(r1.unmatched.length, 0);
  const keys = groups.listPositions(g.id).map(p => p.code).sort();
  assert.deepEqual(keys, data.positions.map(p => p.key).sort());
  assert.equal(groups.listPositions(g.id).find(p => p.code === 'hospitality').notify_unconfirmed, 1);
  const head = dbm.db.prepare(`SELECT m.name_he FROM member_positions mp JOIN positions p ON p.id = mp.position_id JOIN members m ON m.id = mp.member_id
                               WHERE p.group_id = ? AND p.code = 'hospitality' AND mp.is_head = 1`).get(g.id);
  assert.equal(head.name_he, data.assignments.find(a => a.position === 'hospitality' && a.is_head).name_he);
  const again = mig.seedPositionsFromFile(dbm.db, file, { groupId: g.id, log: () => {} });
  assert.equal(again.positions, 0); assert.equal(again.assigned, 0);
});

// ─── Hebrew groups: right-to-left, Russian fallback ───────────────────────────

test('public pages for a Hebrew group: rtl, and a missing translation falls back to the Russian text', () => {
  const gi = require('../public/group.js');
  assert.equal(gi.dirFor('he'), 'rtl');
  assert.equal(gi.dirFor('ru'), 'ltr');
  assert.equal(gi.tr('he', 'Зарегистрироваться'), 'Зарегистрироваться');   // no translation yet: Russian, not a key, not empty
  assert.equal(gi.tr('ru', 'Зарегистрироваться'), 'Зарегистрироваться');
  assert.equal(gi.tr('en', 'x'), 'x');
  for (const f of fs.readdirSync(path.join(ROOT, 'public')).filter(x => x.endsWith('.html') && x !== 'admin.html')) {
    assert.ok(!/data-i18n=""/.test(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')), `${f}: empty i18n key`);
  }
});

test('server: the guest page of a Hebrew group still renders (Russian text) and tells the page its language', async () => {
  // started in the earlier server test; restart a short-lived one here because that test stopped it
  const p2 = 39900 + Math.floor(Math.random() * 90);
  const srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(p2), ADMIN_PASSWORD: 'iso-test-pw', WAHA_URL: 'http://127.0.0.1:1', MAIL_INTAKE_SECRET: '' }, stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${p2}/api/test`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 250)); }
    const r = await fetch(`http://127.0.0.1:${p2}/guest?group=seedgrp`);
    const html = await r.text();
    assert.equal(r.status, 200);
    assert.match(html, /"default_language":"he"/);
    assert.match(html, /Регистрация|Зарегистрироваться|регистр/i);   // Russian text is there
    assert.match(html, /src="\/group\.js"/);
  } finally { srv.kill(); }
});

// ─── list-unmatched-inviters.js ───────────────────────────────────────────────

test('list-unmatched-inviters.js: counts, hints, and it writes nothing', () => {
  dbm.insertGuest({ name: 'Free Text 1', phone: '0547000001', invitedBy: 'Anna Alfa', meetingDate: '30/11/26', groupId: A });
  dbm.insertGuest({ name: 'Free Text 2', phone: '0547000002', invitedBy: 'Anna Alfa', meetingDate: '30/11/26', groupId: A });
  dbm.insertGuest({ name: 'Free Text 3', phone: '0547000003', invitedBy: 'Nobody Known', meetingDate: '30/11/26', groupId: A });
  const nullBefore = dbm.db.prepare('SELECT COUNT(*) c FROM guests WHERE invited_by_member_id IS NULL').get().c;
  const r = spawnSync(process.execPath, ['scripts/list-unmatched-inviters.js', '1'], { cwd: ROOT, env: { ...process.env, DB_PATH: process.env.DB_PATH }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Anna Alfa\s*\n\s+closest: Anna Alpha/);       // hint only
  assert.match(r.stdout, /   2  Anna Alfa/);                           // two guests with this spelling
  assert.match(r.stdout, /distinct spellings/);
  assert.equal(dbm.db.prepare('SELECT COUNT(*) c FROM guests WHERE invited_by_member_id IS NULL').get().c, nullBefore);   // nothing written
});
