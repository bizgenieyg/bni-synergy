'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'groups-'));
process.env.DB_PATH = path.join(TMP, 'app.db');
process.env.BACKUP_DIR = path.join(TMP, 'backups-app');

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const mig = require('../services/groupsMigration');
const { nextMeetingDate, createGroups } = require('../services/groups');

// ─── A copy of the pre-migration schema with a little data ───────────────────

function oldDb(file) {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE guests (id TEXT PRIMARY KEY, firstName TEXT NOT NULL DEFAULT '', lastName TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL,
      specialty TEXT NOT NULL DEFAULT '', invitedBy TEXT NOT NULL DEFAULT '', meetingDate TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0,
      paidAt TEXT, createdAt TEXT NOT NULL, waSent INTEGER NOT NULL DEFAULT 0, sheetRow INTEGER, wa_enabled INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL DEFAULT '');
    CREATE TABLE members (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, profession TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '', birthday TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL,
      photo TEXT, profession_he TEXT NOT NULL DEFAULT '', sort_order INTEGER DEFAULT 999, name_he TEXT NOT NULL DEFAULT '');
    CREATE INDEX idx_members_active ON members(active);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');
    CREATE TABLE votes (id TEXT PRIMARY KEY, meetingDate TEXT NOT NULL, voterPhone TEXT NOT NULL, voterName TEXT NOT NULL,
      candidateId INTEGER NOT NULL, candidateName TEXT NOT NULL, createdAt TEXT NOT NULL);
    CREATE TABLE presentations (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_date TEXT NOT NULL, member_name TEXT NOT NULL,
      change_description TEXT NOT NULL, notes TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      member_id INTEGER REFERENCES members(id));
    CREATE UNIQUE INDEX idx_pres_date_unique ON presentations(meeting_date);
    CREATE TABLE group_value (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_date TEXT NOT NULL, member_id INTEGER REFERENCES members(id),
      member_name TEXT NOT NULL, meetings_1on1 INTEGER DEFAULT 0, referrals INTEGER DEFAULT 0, closed_deals INTEGER DEFAULT 0,
      deal_amount REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE meeting_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_date TEXT NOT NULL UNIQUE, meetings_1on1 INTEGER DEFAULT 0,
      referrals INTEGER DEFAULT 0, closed_deals INTEGER DEFAULT 0, deal_amount REAL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX idx_meeting_stats_date ON meeting_stats(meeting_date);
    CREATE TABLE mail_intake (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL UNIQUE, received_at TEXT NOT NULL,
      status TEXT NOT NULL, guest_id TEXT, raw_path TEXT NOT NULL DEFAULT '');
    CREATE TABLE member_socials (id TEXT PRIMARY KEY, member_id INTEGER NOT NULL, platform TEXT NOT NULL, url TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0);
  `);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO members (name, name_he, phone, createdAt) VALUES (?,?,?,?)").run('Анна Иванова', 'אנה איבנוב', '972501111111', now);
  db.prepare("INSERT INTO members (name, name_he, phone, createdAt) VALUES (?,?,?,?)").run('Борис Петров', 'בוריס פטרוב', '972502222222', now);
  const g = db.prepare("INSERT INTO guests (id, phone, invitedBy, meetingDate, createdAt, name) VALUES (?,?,?,?,?,?)");
  g.run('g1', '972541000001', 'Анна Иванова', '30/11/26', now, 'Гость 1');          // exact
  g.run('g2', '972541000002', '  Борис Петров ', '30/11/26', now, 'Гость 2');       // exact after trim
  g.run('g3', '972541000003', 'Гость Анны', '30/11/26', now, 'Гость 3');            // free text: stays unmatched
  g.run('g4', '972541000004', '', '30/11/26', now, 'Гость 4');                       // empty
  g.run('g5', '972541000005', 'анна иванова', '23/11/26', now, 'Гость 5');           // different case: NOT guessed
  const s = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  s.run('meeting_location', 'Rishon'); s.run('meeting_waze_url', 'https://waze.com/ul/x'); s.run('meeting_zoom_url', 'https://zoom.us/j/1');
  s.run('next_meeting_date', '30/11/26'); s.run('voting_open', '0');
  db.prepare("INSERT INTO presentations (meeting_date, member_name, change_description, member_id) VALUES ('30/11/26', 'Анна', '', 1)").run();
  db.prepare("INSERT INTO meeting_stats (meeting_date, referrals) VALUES ('30/11/26', 3)").run();
  db.prepare("INSERT INTO group_value (meeting_date, member_id, member_name) VALUES ('30/11/26', 1, 'Анна')").run();
  db.prepare("INSERT INTO votes (id, meetingDate, voterPhone, voterName, candidateId, candidateName, createdAt) VALUES ('v1','30/11/26','p','',1,'Анна',?)").run(now);
  db.prepare("INSERT INTO member_socials (id, member_id, platform, url) VALUES ('s1', 1, 'instagram', 'https://i/x')").run();
  return db;
}

function dump(db) {
  const out = {};
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
    out[name] = db.prepare(`SELECT * FROM ${name} ORDER BY 1, 2`).all();
  }
  out.__schema = db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").all();
  return JSON.stringify(out);
}

test('migration on a copy of an old DB: groups, group_id, inviter ids, backup; second run changes nothing', () => {
  const file = path.join(TMP, 'old.db');
  const backups = path.join(TMP, 'backups');
  const db = oldDb(file);
  const logs = [];
  const r1 = mig.runMigration(db, { backupsDir: backups, wahaSession: 'default', log: m => logs.push(m) });
  assert.equal(r1.migrated, true);

  // backup of the pre-migration DB exists and has the OLD schema
  assert.ok(r1.backup && fs.existsSync(r1.backup));
  const bak = new Database(r1.backup, { readonly: true });
  assert.equal(mig.hasTable(bak, 'groups'), false);
  assert.equal(bak.prepare('SELECT COUNT(*) c FROM guests').get().c, 5);
  bak.close();

  // group 1 from the current settings; weekday/time are not invented
  const g = db.prepare('SELECT * FROM groups WHERE id = 1').get();
  assert.equal(g.address, 'Rishon');
  assert.equal(g.waze_url, 'https://waze.com/ul/x');
  assert.equal(g.zoom_url, 'https://zoom.us/j/1');
  assert.equal(g.waha_session, 'default');
  assert.equal(g.payment_url, mig.LEGACY_PAYBOX_LINK);
  assert.equal(g.payment_amount, 80);
  assert.equal(g.meeting_weekday, null);
  assert.equal(g.meeting_time, null);
  assert.equal(g.timezone, 'Asia/Jerusalem');

  // group_id in all data tables, existing rows belong to group 1
  for (const t of ['members', 'guests', 'votes', 'presentations', 'group_value', 'meeting_stats', 'mail_intake']) {
    assert.ok(mig.hasColumn(db, t, 'group_id'), `${t}.group_id`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) c FROM guests WHERE group_id = 1').get().c, 5);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM members WHERE group_id = 1').get().c, 2);
  assert.equal(db.prepare('SELECT phone FROM members WHERE id = 1').get().phone, '972501111111'); // ids and data kept

  // name unique per group, not globally
  const ins = (name, gid) => db.prepare("INSERT INTO members (name, createdAt, group_id) VALUES (?, 'x', ?)").run(name, gid);
  ins('Анна Иванова', 2); // same name, other group: fine
  assert.throws(() => ins('Анна Иванова', 1), /UNIQUE/);
  // meeting_stats and presentations: one row per date per group
  db.prepare("INSERT INTO meeting_stats (meeting_date, group_id) VALUES ('30/11/26', 2)").run();
  assert.throws(() => db.prepare("INSERT INTO meeting_stats (meeting_date, group_id) VALUES ('30/11/26', 1)").run(), /UNIQUE/);
  db.prepare("INSERT INTO presentations (meeting_date, member_name, change_description, group_id) VALUES ('30/11/26', 'x', '', 2)").run();
  assert.throws(() => db.prepare("INSERT INTO presentations (meeting_date, member_name, change_description, group_id) VALUES ('30/11/26', 'y', '', 1)").run(), /UNIQUE/);
  db.exec("DELETE FROM members WHERE group_id = 2; DELETE FROM meeting_stats WHERE group_id = 2; DELETE FROM presentations WHERE group_id = 2");

  // inviter ids: exact (trimmed) matches only
  const by = id => db.prepare('SELECT invited_by_member_id v, invitedBy FROM guests WHERE id = ?').get(id);
  assert.equal(by('g1').v, 1);
  assert.equal(by('g2').v, 2);
  assert.equal(by('g3').v, null);
  assert.equal(by('g4').v, null);
  assert.equal(by('g5').v, null); // case difference is not guessed
  assert.equal(by('g3').invitedBy, 'Гость Анны'); // old text is kept
  assert.deepEqual(r1.unmatchedInviters.map(x => x.name).sort(), ['Гость Анны', 'анна иванова']);
  assert.ok(logs.some(l => l.includes('Гость Анны') && l.includes('unmatched')));

  // foreign keys still consistent
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.pragma('user_version', { simple: true }), mig.SCHEMA_VERSION);

  // second run: nothing changes
  const before = dump(db);
  const r2 = mig.runMigration(db, { backupsDir: backups, log: () => {} });
  assert.equal(r2.migrated, false);
  assert.equal(r2.backup, null);
  assert.equal(dump(db), before);
  assert.equal(fs.readdirSync(backups).length, 1); // no second backup
  db.close();
});

test('migration of an empty DB makes no backup and still creates group 1', () => {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE guests (id TEXT PRIMARY KEY, invitedBy TEXT NOT NULL DEFAULT '', meetingDate TEXT);" +
    "CREATE TABLE members (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, createdAt TEXT);" +
    "CREATE TABLE meeting_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_date TEXT NOT NULL UNIQUE);" +
    "CREATE TABLE presentations (id INTEGER PRIMARY KEY AUTOINCREMENT, meeting_date TEXT);");
  const r = mig.runMigration(db, { backupsDir: path.join(TMP, 'never'), log: () => {} });
  assert.equal(r.backup, null);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM groups').get().c, 1);
  assert.equal(fs.existsSync(path.join(TMP, 'never')), false);
});

// ─── Next meeting date ────────────────────────────────────────────────────────

const d = iso => new Date(iso);
test('nextMeetingDate: on the meeting day it is today, the next day it is +7', () => {
  // Monday 30/11/2026 (weekday 1), Israel is UTC+2 in winter
  assert.equal(nextMeetingDate(d('2026-11-30T05:00:00Z'), 1, '19:30', 'Asia/Jerusalem'), '30/11/26');
  assert.equal(nextMeetingDate(d('2026-11-30T21:00:00Z'), 1, '19:30', 'Asia/Jerusalem'), '30/11/26'); // 23:00 Israel, still Monday
  assert.equal(nextMeetingDate(d('2026-11-30T22:30:00Z'), 1, '19:30', 'Asia/Jerusalem'), '07/12/26'); // 00:30 Tuesday Israel
  assert.equal(nextMeetingDate(d('2026-12-01T10:00:00Z'), 1, null, 'Asia/Jerusalem'), '07/12/26');
  assert.equal(nextMeetingDate(d('2026-11-26T10:00:00Z'), 1, null, 'Asia/Jerusalem'), '30/11/26'); // Thursday -> Monday
});

test('nextMeetingDate: month and year rollover, Sunday = 0, no weekday = null', () => {
  assert.equal(nextMeetingDate(d('2026-12-29T10:00:00Z'), 1, null, 'Asia/Jerusalem'), '04/01/27'); // Tue 29 Dec -> Mon 4 Jan
  assert.equal(nextMeetingDate(d('2026-12-31T10:00:00Z'), 0, null, 'Asia/Jerusalem'), '03/01/27'); // Thu -> Sun
  assert.equal(nextMeetingDate(d('2027-02-26T10:00:00Z'), 1, null, 'Asia/Jerusalem'), '01/03/27'); // Feb -> Mar (non-leap)
  assert.equal(nextMeetingDate(d('2028-02-26T10:00:00Z'), 1, null, 'Asia/Jerusalem'), '28/02/28'); // leap year Monday
  assert.equal(nextMeetingDate(d('2026-11-26T10:00:00Z'), null, null, 'Asia/Jerusalem'), null);
  assert.equal(nextMeetingDate(d('2026-11-26T10:00:00Z'), undefined, null, 'Asia/Jerusalem'), null);
});

test('nextMeetingDate: time zone decides which day it is', () => {
  const instant = d('2026-11-30T23:30:00Z'); // Mon 23:30 UTC = Tue 01:30 Israel = Mon 18:30 New York
  assert.equal(nextMeetingDate(instant, 1, null, 'Asia/Jerusalem'), '07/12/26');
  assert.equal(nextMeetingDate(instant, 1, null, 'UTC'), '30/11/26');
  assert.equal(nextMeetingDate(instant, 1, null, 'America/New_York'), '30/11/26');
  // DST: Israel summer time (UTC+3) — 21:30 UTC Monday is already Tuesday 00:30
  assert.equal(nextMeetingDate(d('2026-07-06T21:30:00Z'), 1, null, 'Asia/Jerusalem'), '13/07/26');
  assert.equal(nextMeetingDate(d('2026-07-06T20:30:00Z'), 1, null, 'Asia/Jerusalem'), '06/07/26');
});

// ─── With the real db module (fresh DB is migrated at import) ─────────────────

const dbm = require('../services/db');
const logs = [];
const groups = createGroups(dbm, { now: () => d('2026-11-26T10:00:00Z'), log: m => logs.push(m) });

test('fresh DB: group 1 exists; meeting date falls back to the old setting until a weekday is set', () => {
  assert.equal(groups.getGroup(1).slug, 'synergy');
  dbm.setSetting('next_meeting_date', '30/11/26');
  assert.equal(groups.scheduleIsSet(1), false);
  assert.equal(groups.meetingDateFor(1), '30/11/26');
  const r = groups.updateGroup(1, { meeting_weekday: 1, meeting_time: '19:30' });
  assert.equal(r.group.meeting_weekday, 1);
  assert.equal(groups.scheduleIsSet(1), true);
  assert.equal(groups.meetingDateFor(1), '30/11/26'); // Thursday 26/11 -> Monday 30/11, computed
  dbm.setSetting('next_meeting_date', '07/12/26');     // the old setting no longer wins
  assert.equal(groups.meetingDateFor(1), '30/11/26');
  assert.equal(groups.meetingDateFor(2), '');          // another group without schedule: nothing invented
});

test('updateGroup validates input', () => {
  assert.ok(groups.updateGroup(1, { meeting_weekday: 7 }).error);
  assert.ok(groups.updateGroup(1, { meeting_time: '25:00' }).error);
  assert.ok(groups.updateGroup(1, { waze_url: 'javascript:alert(1)' }).error);
  assert.ok(groups.updateGroup(1, { payment_amount: '-5' }).error);
  assert.ok(groups.updateGroup(99, { address: 'x' }).error);
  assert.equal(groups.updateGroup(1, { payment_url: '', payment_amount: '' }).group.payment_url, '');
});

test('inviter by ID: API name comes from the member, free text stays for unmatched; search by name works', () => {
  const aid = dbm.insertMember({ name: 'Анна Иванова', phone: '0501111111' });
  const bid = dbm.insertMember({ name: 'Борис Петров', phone: '0502222222' });
  dbm.insertGuest({ name: 'Гость А', phone: '0541000001', invitedBy: 'Анна Иванова', invitedByMemberId: aid, meetingDate: '30/11/26' });
  dbm.insertGuest({ name: 'Гость Б', phone: '0541000002', invitedBy: 'что-то', meetingDate: '30/11/26' });
  const all = dbm.getAllGuests();
  const a = all.find(x => x.name === 'Гость А');
  assert.equal(a.invitedBy, 'Анна Иванова');
  assert.equal(a.invitedByMemberId, aid);
  // member renamed: the guest follows the ID (the name is not copied)
  dbm.updateMember(aid, { name: 'Анна Смирнова' });
  assert.equal(dbm.getAllGuests().find(x => x.name === 'Гость А').invitedBy, 'Анна Смирнова');
  assert.equal(dbm.getGuestsByDate('30/11/26', 1).find(x => x.name === 'Гость А').invitedBy, 'Анна Смирнова');
  // free text kept for guests without an id
  assert.equal(all.find(x => x.name === 'Гость Б').invitedBy, 'что-то');
  assert.equal(all.find(x => x.name === 'Гость Б').invitedByMemberId, null);
  // admin search over the names the API returns (same filter as the UI)
  const q = 'смирн';
  assert.deepEqual(dbm.getAllGuests().filter(g => g.invitedBy.toLowerCase().includes(q)).map(g => g.name), ['Гость А']);
  void bid;
});

test('data is separated by group', () => {
  const m2 = dbm.insertMember({ name: 'Анна Смирнова', groupId: 2 }); // same name as group 1: allowed
  dbm.insertGuest({ name: 'Чужой', phone: '0549999999', invitedBy: '', meetingDate: '30/11/26', groupId: 2, invitedByMemberId: m2 });
  assert.equal(dbm.getGuestsByDate('30/11/26', 1).some(g => g.name === 'Чужой'), false);
  assert.equal(dbm.getGuestsByDate('30/11/26', 2).length, 1);
  assert.equal(dbm.getActiveMembers(2).length, 1);
  assert.ok(dbm.getActiveMembers(1).length >= 2);
  assert.equal(dbm.getMeetingDates(2).length, 1);
  dbm.insertAnonymousVote({ meetingDate: '30/11/26', candidateId: m2, candidateName: 'x', groupId: 2 });
  assert.equal(dbm.getVoteCount('30/11/26', 2), 1);
  assert.equal(dbm.getVoteCount('30/11/26', 1), 0);
  dbm.upsertPresentationByDate('30/11/26', { member_id: m2, member_name: 'Анна' }, 2);
  assert.equal(dbm.getPresentationByDate('30/11/26', 1), null);
  assert.equal(dbm.getPresentationByDate('30/11/26', 2).member_id, m2);
  dbm.upsertMeetingStats('30/11/26', { referrals: 2 }, 2);
  assert.equal(dbm.getAllMeetingStats(1).length, 0);
  assert.equal(dbm.getAllMeetingStats(2).length, 1);
});

// ─── Positions ────────────────────────────────────────────────────────────────

const POSITIONS = {
  positions: [
    { code: 'chair', name_he: 'יו"ר', name_ru: 'Председатель', name_en: 'Chair', grants_admin: 1, notify_unconfirmed: 0 },
    { code: 'vp', name_he: 'סגן יו"ר', name_ru: 'Вице-председатель', name_en: 'Vice chair', grants_admin: 1, notify_unconfirmed: 1 },
  ],
  assignments: [
    { position: 'chair', name_he: 'אנה איבנוב', name_ru_hint: 'Анна Иванова', is_head: 1 },
    { position: 'vp', name_he: 'לא קיים', name_ru_hint: 'Нет такого', is_head: 1 },
    { position: 'vp', name_he: 'בוריס פטרוב', name_ru_hint: '', is_head: 1 },
    { position: 'nope', name_he: 'בוריס פטרוב', is_head: 0 },
  ],
};

test('positions seed matches members, logs the rest, and is idempotent', () => {
  const db = dbm.db;
  db.prepare("UPDATE members SET name_he = 'בוריס פטרוב' WHERE name = 'Борис Петров' AND group_id = 1").run();
  db.prepare("UPDATE members SET name_he = 'אנה איבנוב' WHERE name = 'Анна Смирнова' AND group_id = 1").run();
  const log = [];
  const r1 = mig.seedPositions(db, POSITIONS, { log: m => log.push(m) });
  assert.equal(r1.positions, 2);
  assert.equal(r1.assigned, 2);
  assert.equal(r1.unmatched.length, 2);
  assert.ok(log.some(l => l.includes('לא קיים') && l.includes('unknown position')));
  const snap = () => JSON.stringify([db.prepare('SELECT * FROM positions ORDER BY id').all(), db.prepare('SELECT * FROM member_positions ORDER BY member_id, position_id').all()]);
  const before = snap();
  const r2 = mig.seedPositions(db, POSITIONS, { log: () => {} });
  assert.equal(r2.positions, 0);
  assert.equal(r2.assigned, 0);
  assert.equal(snap(), before);
});

test('member positions: several per member, head flag, positions of another group are refused', () => {
  const bid = dbm.db.prepare("SELECT id FROM members WHERE name = 'Борис Петров' AND group_id = 1").get().id;
  const [chair, vp] = groups.listPositions(1);
  const ok = groups.setMemberPositions(bid, [{ position_id: chair.id, is_head: 0 }, { position_id: vp.id, is_head: 1 }]);
  assert.equal(ok.positions.length, 2);
  assert.equal(groups.memberPositionsMap(1)[bid].find(p => p.position_id === vp.id).is_head, 1);
  dbm.db.prepare("INSERT INTO positions (group_id, code) VALUES (2, 'foreign')").run();
  const foreign = dbm.db.prepare("SELECT id FROM positions WHERE group_id = 2").get().id;
  assert.ok(groups.setMemberPositions(bid, [{ position_id: foreign }]).error);
  assert.equal(groups.memberPositionsMap(1)[bid].length, 2); // refused change did not touch anything
  assert.deepEqual(groups.setMemberPositions(bid, []).positions, []);
});

test('unconfirmed-guests recipient: head of a position with notify_unconfirmed, else the old setting with a warning', () => {
  const bid = dbm.db.prepare("SELECT id FROM members WHERE name = 'Борис Петров' AND group_id = 1").get().id;
  const aid = dbm.db.prepare("SELECT id FROM members WHERE name = 'Анна Смирнова' AND group_id = 1").get().id;
  const [chair, vp] = groups.listPositions(1);
  dbm.setSetting('unconfirmed_notify_phone', '972509999999');
  logs.length = 0;
  assert.equal(groups.unconfirmedNotifyPhone(1), '972509999999'); // nobody assigned yet -> old setting
  assert.ok(logs.some(l => l.includes('notify_unconfirmed')));

  groups.setMemberPositions(aid, [{ position_id: chair.id, is_head: 1 }]);                  // chair does not notify
  groups.setMemberPositions(bid, [{ position_id: vp.id, is_head: 0 }]);                     // notifies, but not head
  assert.equal(groups.unconfirmedNotifyPhone(1), '972509999999');
  groups.setMemberPositions(bid, [{ position_id: vp.id, is_head: 1 }]);                     // head of the notifying position
  logs.length = 0;
  assert.equal(groups.unconfirmedNotifyPhone(1), '972502222222');
  assert.equal(logs.length, 0);
  dbm.setMemberActive(bid, 0);                                                              // inactive head is skipped
  assert.equal(groups.unconfirmedNotifyPhone(1), '972509999999');
  dbm.setMemberActive(bid, 1);
  assert.equal(groups.unconfirmedNotifyPhone(2), ''); // another group never falls back to group 1's old setting
});
