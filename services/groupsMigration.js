'use strict';

// Multi-group foundation (task 17). Idempotent, runs in one transaction, preceded by a
// consistent backup of the DB file. Pure with respect to the app: takes a better-sqlite3 handle.
//
// Tables with group_id: members, guests, votes, presentations, group_value, meeting_stats, mail_intake.
// Not scoped: member_socials (belongs to a member, so it follows the member's group), settings (global,
// except the per-group fields that moved to `groups`).

const fs = require('fs');
const path = require('path');

const DEFAULT_GROUP_ID = 1;
const SCHEMA_VERSION = 17;

// Payment link that used to be a constant in server.js; kept here only to seed group 1.
const LEGACY_PAYBOX_LINK = 'https://links.payboxapp.com/7SB6P3stE6b';
const LEGACY_PAYMENT_AMOUNT = 80;

const hasTable = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
const columns = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all();
const hasColumn = (db, t, c) => columns(db, t).some(x => x.name === c);

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function needsMigration(db) {
  return db.pragma('user_version', { simple: true }) < SCHEMA_VERSION;
}

// Consistent copy of the DB (VACUUM INTO) before touching the schema. Skipped for empty DBs.
function backupBeforeMigration(db, backupsDir, log = console.log) {
  const rows = ['guests', 'members'].reduce((n, t) => n + (hasTable(db, t) ? db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c : 0), 0);
  if (rows === 0) return null;
  fs.mkdirSync(backupsDir, { recursive: true });
  const file = path.join(backupsDir, `guests-pre-groups-${stamp()}.db`);
  db.prepare('VACUUM INTO ?').run(file);
  log(`[Migration 17] backup written: ${file}`);
  return file;
}

// Rebuild a table adding group_id and a composite UNIQUE (the standard SQLite procedure;
// foreign_keys must be OFF, which runMigration guarantees).
function rebuildWithGroup(db, table, uniqueCols) {
  const cols = columns(db, table);
  const sqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
  const autoinc = /AUTOINCREMENT/i.test(sqlRow.sql);
  const defs = cols.map(c => {
    let d = `"${c.name}" ${c.type || ''}`.trim();
    if (c.pk) d += ' PRIMARY KEY' + (autoinc ? ' AUTOINCREMENT' : '');
    if (c.notnull && !c.pk) d += ' NOT NULL';
    if (c.dflt_value !== null) d += ` DEFAULT ${c.dflt_value}`;
    return d;
  });
  defs.push('"group_id" INTEGER NOT NULL DEFAULT 1');
  const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table).map(r => r.sql);
  const colList = cols.map(c => `"${c.name}"`).join(', ');
  db.exec(`CREATE TABLE "${table}__new" (${defs.join(', ')}, UNIQUE (${uniqueCols.map(c => `"${c}"`).join(', ')}))`);
  db.exec(`INSERT INTO "${table}__new" (${colList}, "group_id") SELECT ${colList}, 1 FROM "${table}"`);
  db.exec(`DROP TABLE "${table}"`);
  db.exec(`ALTER TABLE "${table}__new" RENAME TO "${table}"`);
  for (const sql of indexes) db.exec(sql);
}

function addGroupColumn(db, table) {
  if (!hasTable(db, table) || hasColumn(db, table, 'group_id')) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN group_id INTEGER NOT NULL DEFAULT 1`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_group ON ${table}(group_id)`);
  return true;
}

function createCoreTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      slug            TEXT NOT NULL UNIQUE,
      waha_session    TEXT NOT NULL DEFAULT 'default',
      timezone        TEXT NOT NULL DEFAULT 'Asia/Jerusalem',
      meeting_weekday INTEGER,
      meeting_time    TEXT,
      address         TEXT NOT NULL DEFAULT '',
      waze_url        TEXT NOT NULL DEFAULT '',
      zoom_url        TEXT NOT NULL DEFAULT '',
      payment_url     TEXT NOT NULL DEFAULT '',
      payment_amount  INTEGER,
      created_at      TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS positions (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id           INTEGER NOT NULL DEFAULT 1,
      code               TEXT NOT NULL,
      name_he            TEXT NOT NULL DEFAULT '',
      name_ru            TEXT NOT NULL DEFAULT '',
      name_en            TEXT NOT NULL DEFAULT '',
      grants_admin       INTEGER NOT NULL DEFAULT 0,
      notify_unconfirmed INTEGER NOT NULL DEFAULT 0,
      UNIQUE (group_id, code)
    );
    CREATE TABLE IF NOT EXISTS member_positions (
      member_id   INTEGER NOT NULL,
      position_id INTEGER NOT NULL,
      is_head     INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (member_id, position_id)
    );
    CREATE INDEX IF NOT EXISTS idx_member_positions_pos ON member_positions(position_id);
  `);
}

function seedGroupOne(db, { wahaSession, paymentUrl, paymentAmount }) {
  if (db.prepare('SELECT 1 FROM groups WHERE id = ?').get(DEFAULT_GROUP_ID)) return false;
  const s = key => {
    if (!hasTable(db, 'settings')) return null;
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return r ? r.value : null;
  };
  // Weekday/time are NOT invented: taken from existing settings if they exist, else NULL.
  const wd = s('meeting_weekday');
  const weekday = wd !== null && /^[0-6]$/.test(String(wd).trim()) ? Number(wd) : null;
  const tm = s('meeting_time');
  const time = tm !== null && /^([01]\d|2[0-3]):[0-5]\d$/.test(String(tm).trim()) ? String(tm).trim() : null;
  db.prepare(`
    INSERT INTO groups (id, name, slug, waha_session, timezone, meeting_weekday, meeting_time,
                        address, waze_url, zoom_url, payment_url, payment_amount, created_at)
    VALUES (?, 'BNI Synergy', 'synergy', ?, 'Asia/Jerusalem', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(DEFAULT_GROUP_ID, wahaSession, weekday, time,
    s('meeting_location') || '', s('meeting_waze_url') || '', s('meeting_zoom_url') || '',
    paymentUrl, paymentAmount, new Date().toISOString());
  return true;
}

// Exact (trimmed) match of guests.invitedBy to members.name inside the guest's group.
// Anything else stays NULL and is returned for the log. No fuzzy matching.
function fillInvitedByIds(db) {
  db.exec(`
    UPDATE guests SET invited_by_member_id = (
      SELECT m.id FROM members m WHERE TRIM(m.name) = TRIM(guests.invitedBy) AND m.group_id = guests.group_id LIMIT 1
    ) WHERE invited_by_member_id IS NULL AND TRIM(invitedBy) != ''
  `);
  return db.prepare(`
    SELECT TRIM(invitedBy) AS name, COUNT(*) AS guests FROM guests
    WHERE invited_by_member_id IS NULL AND TRIM(invitedBy) != ''
    GROUP BY TRIM(invitedBy) ORDER BY guests DESC, name
  `).all();
}

function runMigration(db, opts = {}) {
  const log = opts.log || console.log;
  const result = { migrated: false, backup: null, unmatchedInviters: [] };
  if (!needsMigration(db)) return result;

  result.backup = backupBeforeMigration(db, opts.backupsDir || path.join(process.cwd(), 'backups'), log);

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      createCoreTables(db);
      seedGroupOne(db, {
        wahaSession: opts.wahaSession || process.env.WAHA_SESSION || 'default',
        paymentUrl: opts.paymentUrl ?? LEGACY_PAYBOX_LINK,
        paymentAmount: opts.paymentAmount ?? LEGACY_PAYMENT_AMOUNT,
      });

      if (hasTable(db, 'members') && !hasColumn(db, 'members', 'group_id')) rebuildWithGroup(db, 'members', ['group_id', 'name']);
      if (hasTable(db, 'meeting_stats') && !hasColumn(db, 'meeting_stats', 'group_id')) rebuildWithGroup(db, 'meeting_stats', ['group_id', 'meeting_date']);
      for (const t of ['guests', 'votes', 'presentations', 'group_value', 'mail_intake']) addGroupColumn(db, t);
      db.exec('CREATE INDEX IF NOT EXISTS idx_members_group ON members(group_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_meeting_stats_group ON meeting_stats(group_id)');

      // presentations: one row per date PER GROUP
      db.exec('DROP INDEX IF EXISTS idx_pres_date_unique');
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_pres_group_date ON presentations(group_id, meeting_date)');

      if (!hasColumn(db, 'guests', 'invited_by_member_id')) db.exec('ALTER TABLE guests ADD COLUMN invited_by_member_id INTEGER');
      db.exec('CREATE INDEX IF NOT EXISTS idx_guests_inviter ON guests(invited_by_member_id)');
      result.unmatchedInviters = fillInvitedByIds(db);

      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
    result.migrated = true;
  } finally {
    db.pragma('foreign_keys = ON');
  }

  const total = db.prepare("SELECT COUNT(*) c FROM guests WHERE TRIM(invitedBy) != ''").get().c;
  log(`[Migration 17] groups/group_id done. Inviters matched by exact name: ${total - result.unmatchedInviters.reduce((n, r) => n + r.guests, 0)} of ${total} guests with a name; ` +
      `${result.unmatchedInviters.length} distinct names left unmatched (text kept, id NULL).`);
  if (result.unmatchedInviters.length) {
    log('[Migration 17] unmatched inviter names: ' + result.unmatchedInviters.map(r => `${r.name} (${r.guests})`).join('; '));
  }
  return result;
}

// ─── Positions seed (idempotent) ──────────────────────────────────────────────
//
// scripts/positions_he.json:
// { "positions":   [{ "code", "name_he", "name_ru", "name_en", "grants_admin", "notify_unconfirmed" }],
//   "assignments": [{ "position": "<code>", "name_he": "...", "name_ru_hint": "...", "is_head": 1 }] }

const norm = s => String(s || '').replace(/[֑-ׇ]/g, '').replace(/["'״׳]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

function seedPositions(db, data, { groupId = DEFAULT_GROUP_ID, log = console.log } = {}) {
  const out = { positions: 0, assigned: 0, unmatched: [] };
  if (!data || !Array.isArray(data.positions)) return out;
  const insPos = db.prepare(`INSERT OR IGNORE INTO positions (group_id, code, name_he, name_ru, name_en, grants_admin, notify_unconfirmed)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insAssign = db.prepare('INSERT OR IGNORE INTO member_positions (member_id, position_id, is_head) VALUES (?, ?, ?)');
  const members = db.prepare('SELECT id, name, name_he FROM members WHERE group_id = ?').all(groupId);

  db.transaction(() => {
    for (const p of data.positions) {
      out.positions += insPos.run(groupId, p.code, p.name_he || '', p.name_ru || '', p.name_en || '',
        p.grants_admin ? 1 : 0, p.notify_unconfirmed ? 1 : 0).changes;
    }
    for (const a of data.assignments || []) {
      const pos = db.prepare('SELECT id FROM positions WHERE group_id = ? AND code = ?').get(groupId, a.position);
      const byHe = a.name_he ? members.filter(m => norm(m.name_he) === norm(a.name_he)) : [];
      const byRu = a.name_ru_hint ? members.filter(m => norm(m.name) === norm(a.name_ru_hint)) : [];
      const found = byHe.length === 1 ? byHe[0] : (byHe.length === 0 && byRu.length === 1 ? byRu[0] : null);
      if (!pos || !found) { out.unmatched.push({ ...a, reason: !pos ? 'unknown position' : (byHe.length > 1 || byRu.length > 1 ? 'ambiguous' : 'no member') }); continue; }
      out.assigned += insAssign.run(found.id, pos.id, a.is_head ? 1 : 0).changes;
    }
  })();
  if (out.unmatched.length) {
    log('[Positions] not matched (not guessed): ' + out.unmatched.map(a => `${a.name_he || a.name_ru_hint} → ${a.position} (${a.reason})`).join('; '));
  }
  return out;
}

function seedPositionsFromFile(db, file, opts = {}) {
  if (!fs.existsSync(file)) return null;
  return seedPositions(db, JSON.parse(fs.readFileSync(file, 'utf8')), opts);
}

module.exports = {
  DEFAULT_GROUP_ID, SCHEMA_VERSION, LEGACY_PAYBOX_LINK, runMigration, needsMigration, backupBeforeMigration,
  seedPositions, seedPositionsFromFile, fillInvitedByIds, hasColumn, hasTable,
};
