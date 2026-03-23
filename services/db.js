'use strict';

const path           = require('path');
const fs             = require('fs');
const { randomUUID } = require('crypto');
const Database       = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'guests.db');

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema: guests ───────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS guests (
    id          TEXT PRIMARY KEY,
    firstName   TEXT NOT NULL,
    lastName    TEXT NOT NULL,
    phone       TEXT NOT NULL,
    specialty   TEXT NOT NULL DEFAULT '',
    invitedBy   TEXT NOT NULL DEFAULT '',
    meetingDate TEXT NOT NULL,
    paid        INTEGER NOT NULL DEFAULT 0,
    paidAt      TEXT,
    createdAt   TEXT NOT NULL,
    waSent      INTEGER NOT NULL DEFAULT 0,
    sheetRow    INTEGER,
    wa_enabled  INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_guests_meeting ON guests(meetingDate);
  CREATE INDEX IF NOT EXISTS idx_guests_phone   ON guests(phone);
  CREATE INDEX IF NOT EXISTS idx_guests_created ON guests(createdAt);
`);

// Migrate existing DBs that predate wa_enabled column
try {
  db.exec('ALTER TABLE guests ADD COLUMN wa_enabled INTEGER NOT NULL DEFAULT 1');
} catch { /* column already exists — ignore */ }

// Migrate: merge firstName + lastName into single name column
try {
  db.exec('ALTER TABLE guests ADD COLUMN name TEXT NOT NULL DEFAULT \'\'');
} catch { /* already exists */ }
db.exec("UPDATE guests SET name = TRIM(firstName || ' ' || COALESCE(lastName, '')) WHERE name = '' OR name IS NULL");

// Migrate: add guest confirmation columns
try { db.exec('ALTER TABLE guests ADD COLUMN confirmed INTEGER DEFAULT 0'); } catch {}
try { db.exec('ALTER TABLE guests ADD COLUMN confirmed_at TEXT'); } catch {}
// Auto-confirm all guests registered before 2026-03-20
db.exec("UPDATE guests SET confirmed = 1 WHERE createdAt < '2026-03-20T00:00:00.000Z' AND confirmed = 0");

// ─── Schema: members ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT UNIQUE NOT NULL,
    profession TEXT NOT NULL DEFAULT '',
    phone     TEXT NOT NULL DEFAULT '',
    birthday  TEXT NOT NULL DEFAULT '',
    active    INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_members_active   ON members(active);
  CREATE INDEX IF NOT EXISTS idx_members_birthday ON members(birthday);
`);

// ─── Seed members ─────────────────────────────────────────────────────────────

const seedMembers = [
  { name: 'Виктория Колтун',      profession: 'Мега Макс Перевозки',                                    phone: '0546815561', birthday: '01/01/1978' },
  { name: 'Юля Тронза',           profession: 'Агентство недвижимости Явне',                            phone: '0544757547', birthday: '03/01'      },
  { name: 'Мила Рассказов Чирков',profession: 'Кейтеринг/Фуршеты/Торты/Мастер классы',                 phone: '0526765562', birthday: '20/01/1983' },
  { name: 'Лена Смолкин',         profession: 'Стилист и владелица ателье',                             phone: '0544744053', birthday: '27/01'      },
  { name: 'Юрий Голд',            profession: 'Интернет-маркетинг, SEO и AI',                           phone: '0535390080', birthday: '31/01'      },
  { name: 'Игорь Лупинский',      profession: 'Бухгалтерия',                                            phone: '0505812236', birthday: '03/02'      },
  { name: 'Марта Штайнберг',      profession: 'Пастилатье, витаминные роллы ручной работы',             phone: '0526074257', birthday: '03/02'      },
  { name: 'Натали Жук',           profession: 'Шеф-повар домашней кухни',                               phone: '0587958060', birthday: '06/02/1968' },
  { name: 'Даниель Биленсон',     profession: 'Адвокат по возмещению ущерба',                           phone: '0546444999', birthday: '19/02/1984' },
  { name: 'Андрей Скиба',         profession: 'Диджей',                                                 phone: '0547602162', birthday: '25/02/1974' },
  { name: 'Тэнзиля Коренберг',    profession: 'Парикмахер стилист',                                     phone: '0534453912', birthday: '02/03/1980' },
  { name: 'Антон Михеев',         profession: 'Автоматизация маркетинга',                               phone: '0586443182', birthday: '07/03/1985' },
  { name: 'Сабина Эренштейн',     profession: '',                                                        phone: '',           birthday: '12/03'      },
  { name: 'Шарон Соколовски',     profession: '',                                                        phone: '',           birthday: '20/03'      },
  { name: 'Михаил Ткач',          profession: 'Риэлтор Беэр-Шева и Южный округ',                       phone: '0545619163', birthday: '22/03/1976' },
  { name: 'Виктория Фогель',      profession: 'Адвокат по недвижимости',                                phone: '0525681177', birthday: '29/03/1978' },
  { name: 'Лора Блантер',         profession: 'Бутик Cartel',                                           phone: '0548041987', birthday: '09/04/1987' },
  { name: 'Ирина Заманская',      profession: 'Аквагример',                                             phone: '0585040567', birthday: '21/04/1967' },
  { name: 'Олег Волох',           profession: 'Консультант по ипотекам',                                phone: '0546690524', birthday: '05/05/1979' },
  { name: 'Евгений Сидельский',   profession: 'Типография',                                             phone: '0546554221', birthday: '27/05'      },
  { name: 'Дариен Ройтман',       profession: 'Специалист по психологии продаж и AI видео',             phone: '0545919330', birthday: '14/07'      },
  { name: 'Александр Кудинов',    profession: 'Консультант по семейным финансам',                       phone: '0549019324', birthday: '14/08/1972' },
  { name: 'Артур Блаер',          profession: '',                                                        phone: '',           birthday: '23/08/1976' },
  { name: 'Людмила Губарева',     profession: 'Коуч + НЛП',                                             phone: '0534882340', birthday: '27/08/1974' },
  { name: 'Дарья Марис',          profession: 'Художник-декоратор интерьера',                           phone: '0587060973', birthday: '06/09/1973' },
  { name: 'Дмитрий Мельгорский',  profession: 'AI-видео контент, графический дизайн и сайты',          phone: '0539290639', birthday: '11/09/1978' },
  { name: 'Татьяна Лев',          profession: 'Бизнес-наставник и нейро-коуч',                         phone: '0526331457', birthday: '01/10/1974' },
  { name: 'Александр Коско',      profession: 'Ведущий тренингов по голосу и ораторскому искусству',   phone: '0528966740', birthday: '02/10'      },
  { name: 'Евгения Писман',       profession: 'Копирайтер',                                             phone: '0503204861', birthday: '07/10'      },
  { name: 'Татьяна Вайс',         profession: 'Адвокат по дорожному и уголовному праву',               phone: '0546960404', birthday: '04/11/1980' },
  { name: 'Ольга Гасперт',        profession: 'Флорист',                                                phone: '0528191040', birthday: '08/11'      },
  { name: 'Ирина Кроль',          profession: 'Груммер',                                                phone: '0523986032', birthday: '09/11/1960' },
  { name: 'Алексей Поповских',    profession: 'Массажный терапевт',                                    phone: '0522751187', birthday: '11/11/1981' },
  { name: 'Рита Хазанович',       profession: 'Аудитор',                                                phone: '0545809092', birthday: '16/11'      },
  { name: 'Сергей Фишбах',        profession: 'Съемка торжеств и мероприятий',                         phone: '0502714814', birthday: '20/11/1971' },
  { name: 'Диана Шаривкер',       profession: 'Страховое агентство',                                   phone: '0503399829', birthday: '01/12'      },
  { name: 'Ольга Грановская',     profession: 'Интернет-маркетинг, SEO и AI',                          phone: '0535390080', birthday: '02/12/1972' },
  { name: 'Марина Кондратьев',    profession: 'Косметолог',                                             phone: '0509887199', birthday: '10/12/1988' },
  { name: 'Леонид Лурия',         profession: 'Разработчик и производитель косметики',                 phone: '0544956734', birthday: '25/12'      },
  { name: 'Игорь Бутин',          profession: '',                                                        phone: '',           birthday: ''           },
  { name: 'Степан Минькович',     profession: 'Автоматизация маркетинга',                               phone: '0586443182', birthday: ''           },
];

const stmtSeedMember = db.prepare(
  `INSERT OR IGNORE INTO members (name, profession, phone, birthday, active, createdAt)
   VALUES (?, ?, ?, ?, 1, datetime('now'))`
);
// Always run seeds — INSERT OR IGNORE means existing rows are safely skipped.
// Also re-runs if the table was wiped (count = 0).
const seedAll = db.transaction(() => {
  for (const m of seedMembers) {
    stmtSeedMember.run(m.name, m.profession, m.phone, m.birthday);
  }
});
seedAll();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(phone) {
  if (!phone) return '';
  let digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('972')) digits = digits.slice(3);
  if (digits.startsWith('0'))   digits = digits.slice(1);
  if (digits.length !== 9) return String(phone); // unrecognised — keep original
  return '972' + digits;
}

// Migrate existing phones to 972XXXXXXXXX — idempotent, runs every startup
;(function migratePhones() {
  const gRows = db.prepare('SELECT id, phone FROM guests').all();
  for (const g of gRows) {
    const n = normalizePhone(g.phone);
    if (n !== g.phone) db.prepare('UPDATE guests SET phone=? WHERE id=?').run(n, g.id);
  }
  const mRows = db.prepare('SELECT id, phone FROM members').all();
  for (const m of mRows) {
    const n = normalizePhone(m.phone);
    if (n !== m.phone) db.prepare('UPDATE members SET phone=? WHERE id=?').run(n, m.id);
  }
}());

// ─── Guests CRUD ──────────────────────────────────────────────────────────────

function insertGuest({ name, phone, specialty, invitedBy, meetingDate, paid = 0, paidAt = null }) {
  const id        = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO guests
      (id, name, firstName, lastName, phone, specialty, invitedBy, meetingDate, paid, paidAt, createdAt, wa_enabled)
    VALUES (?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id,
    name.trim(), normalizePhone(phone),
    (specialty || '').trim(), (invitedBy || '').trim(),
    meetingDate, paid, paidAt, createdAt,
  );
  return id;
}

function updateSheetRow(id, sheetRow) {
  db.prepare('UPDATE guests SET sheetRow = ? WHERE id = ?').run(sheetRow, id);
}

function markWaSent(id) {
  db.prepare('UPDATE guests SET waSent = 1 WHERE id = ?').run(id);
}

function markPaid(id) {
  db.prepare('UPDATE guests SET paid = 1, paidAt = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

function markConfirmed(id) {
  db.prepare('UPDATE guests SET confirmed = 1, confirmed_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

function markDeclined(id) {
  db.prepare('UPDATE guests SET confirmed = -1, wa_enabled = 0, confirmed_at = ? WHERE id = ?')
    .run(new Date().toISOString(), id);
}

function toggleWaEnabled(id) {
  const guest = db.prepare('SELECT wa_enabled FROM guests WHERE id = ?').get(id);
  if (!guest) return null;
  const next = guest.wa_enabled ? 0 : 1;
  db.prepare('UPDATE guests SET wa_enabled = ? WHERE id = ?').run(next, id);
  return next;
}

function getGuestsByDate(meetingDate) {
  return db.prepare(
    'SELECT * FROM guests WHERE meetingDate = ? ORDER BY createdAt ASC'
  ).all(meetingDate);
}

function getAllGuests() {
  return db.prepare('SELECT * FROM guests ORDER BY meetingDate DESC, createdAt ASC').all();
}

/**
 * Compute a numeric sort score for a meeting date string.
 * Handles DD/MM, DD/MM/YY, DD/MM/YYYY.
 * For DD/MM without year: infers year using Monday-check then past/future check.
 */
function _dateScore(dateStr) {
  const parts = dateStr.split('/');
  if (parts.length < 2) return 0;
  const dd = parseInt(parts[0], 10) || 0;
  const mm = parseInt(parts[1], 10) || 0;
  let year;
  if (parts.length >= 3) {
    const raw = parseInt(parts[2], 10) || 0;
    year = raw < 100 ? 2000 + raw : raw;
  } else {
    // Infer year: prefer the year where this DD/MM falls on a Monday
    const today    = new Date();
    const curYear  = today.getFullYear();
    const isMonday = (y) => new Date(y, mm - 1, dd).getDay() === 1;
    if      (isMonday(curYear))     year = curYear;
    else if (isMonday(curYear - 1)) year = curYear - 1;
    else {
      // Fallback: if date is in the future this year → last year
      today.setHours(0, 0, 0, 0);
      year = new Date(curYear, mm - 1, dd) > today ? curYear - 1 : curYear;
    }
  }
  return year * 10000 + mm * 100 + dd;
}

function getMeetingDates() {
  const rows = db.prepare('SELECT DISTINCT meetingDate FROM guests').all();
  return rows
    .map(r => r.meetingDate)
    .sort((a, b) => _dateScore(b) - _dateScore(a)); // newest first
}

function getGuestById(id) {
  return db.prepare('SELECT * FROM guests WHERE id = ?').get(id);
}

function findGuestByPhone(rawPhone) {
  const target = normalizePhone(rawPhone);
  const all    = db.prepare('SELECT * FROM guests').all();
  return all.find(g => normalizePhone(g.phone) === target) || null;
}

function getTotalCount() {
  return db.prepare('SELECT COUNT(*) as c FROM guests').get().c;
}

// ─── Members CRUD ─────────────────────────────────────────────────────────────

function getAllMembers() {
  return db.prepare('SELECT * FROM members ORDER BY name ASC').all();
}

function getActiveMembers() {
  return db.prepare('SELECT * FROM members WHERE active = 1 ORDER BY name ASC').all();
}

function getMemberById(id) {
  return db.prepare('SELECT * FROM members WHERE id = ?').get(id);
}

function insertMember({ name, profession, profession_he, phone, birthday }) {
  const createdAt = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO members (name, profession, profession_he, phone, birthday, active, createdAt)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(name.trim(), (profession || '').trim(), (profession_he || '').trim(), normalizePhone(phone || ''), (birthday || '').trim(), createdAt);
  return info.lastInsertRowid;
}

function updateMember(id, { name, profession, profession_he, phone, birthday, active }) {
  const current = getMemberById(id);
  if (!current) return null;
  db.prepare(
    `UPDATE members SET
       name          = ?,
       profession    = ?,
       profession_he = ?,
       phone         = ?,
       birthday      = ?,
       active        = ?
     WHERE id = ?`
  ).run(
    (name          ?? current.name).trim(),
    (profession    ?? current.profession).trim(),
    (profession_he ?? current.profession_he ?? '').trim(),
    normalizePhone(phone ?? current.phone),
    (birthday      ?? current.birthday).trim(),
    active         ?? current.active,
    id,
  );
  return getMemberById(id);
}

function setMemberActive(id, active) {
  db.prepare('UPDATE members SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

function updateMemberPhoto(id, filename) {
  db.prepare('UPDATE members SET photo = ? WHERE id = ?').run(filename, id);
}

function updateMemberProfile(id, { profession, phone, birthday }) {
  const current = getMemberById(id);
  if (!current) return null;
  db.prepare(
    'UPDATE members SET profession = ?, phone = ?, birthday = ? WHERE id = ?'
  ).run(
    (profession ?? current.profession).trim(),
    normalizePhone(phone ?? current.phone),
    (birthday   ?? current.birthday).trim(),
    id,
  );
  return getMemberById(id);
}

/**
 * Find members whose birthday starts with the given "DD/MM" prefix.
 */
function getMembersBirthday(ddmm) {
  return db.prepare(
    "SELECT * FROM members WHERE birthday LIKE ? AND active = 1"
  ).all(`${ddmm}%`);
}

// Migrate existing DBs: add photo column to members
try { db.exec("ALTER TABLE members ADD COLUMN photo TEXT"); } catch {}
// Migrate: add Hebrew profession
try { db.exec("ALTER TABLE members ADD COLUMN profession_he TEXT NOT NULL DEFAULT ''"); } catch {}

// ─── Schema: settings ─────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );
`);

// Seed defaults
db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('voting_open', '0')").run();

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ─── Schema: votes ────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS votes (
    id            TEXT PRIMARY KEY,
    meetingDate   TEXT NOT NULL,
    voterPhone    TEXT NOT NULL,
    voterName     TEXT NOT NULL,
    candidateId   INTEGER NOT NULL,
    candidateName TEXT NOT NULL,
    createdAt     TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_voter ON votes(meetingDate, voterPhone);
  CREATE INDEX IF NOT EXISTS idx_votes_date ON votes(meetingDate);
`);

// ─── Votes CRUD ───────────────────────────────────────────────────────────────

function hasVoted(meetingDate, rawPhone) {
  const phone = normalizePhone(rawPhone);
  return !!db.prepare(
    'SELECT 1 FROM votes WHERE meetingDate = ? AND voterPhone = ?'
  ).get(meetingDate, phone);
}

function insertVote({ meetingDate, voterPhone, voterName, candidateId, candidateName }) {
  const id        = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO votes (id, meetingDate, voterPhone, voterName, candidateId, candidateName, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, meetingDate, normalizePhone(voterPhone), voterName.trim(), candidateId, candidateName, createdAt);
  return id;
}

function hasVotedByIp(meetingDate, ip) {
  return !!db.prepare(
    'SELECT 1 FROM votes WHERE meetingDate = ? AND voterPhone = ?'
  ).get(meetingDate, ip);
}

function insertVoteByIp({ meetingDate, voterIp, candidateId, candidateName }) {
  const id        = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO votes (id, meetingDate, voterPhone, voterName, candidateId, candidateName, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, meetingDate, voterIp, '', candidateId, candidateName, createdAt);
  return id;
}

function getVoteResults(meetingDate) {
  return db.prepare(`
    SELECT candidateId, candidateName, COUNT(*) as votes
    FROM votes
    WHERE meetingDate = ?
    GROUP BY candidateId, candidateName
    ORDER BY votes DESC
  `).all(meetingDate);
}

function getVoteCount(meetingDate) {
  return db.prepare('SELECT COUNT(*) as c FROM votes WHERE meetingDate = ?').get(meetingDate).c;
}

function deleteVotesByDate(meetingDate) {
  db.prepare('DELETE FROM votes WHERE meetingDate = ?').run(meetingDate);
}

function insertAnonymousVote({ meetingDate, candidateId, candidateName }) {
  const id        = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO votes (id, meetingDate, voterPhone, voterName, candidateId, candidateName, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, meetingDate, id, '', candidateId, candidateName, createdAt);
}

// ─── Schema: member_socials ───────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS member_socials (
    id         TEXT PRIMARY KEY,
    member_id  INTEGER NOT NULL,
    platform   TEXT NOT NULL,
    url        TEXT NOT NULL,
    label      TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_socials_member ON member_socials(member_id);
`);

// ─── Socials CRUD ─────────────────────────────────────────────────────────────

function getMemberSocials(memberId) {
  return db.prepare(
    'SELECT * FROM member_socials WHERE member_id = ? ORDER BY sort_order ASC, rowid ASC'
  ).all(memberId);
}

function setMemberSocials(memberId, socials) {
  const del = db.prepare('DELETE FROM member_socials WHERE member_id = ?');
  const ins = db.prepare(
    `INSERT INTO member_socials (id, member_id, platform, url, label, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    del.run(memberId);
    socials.forEach((s, i) => {
      ins.run(randomUUID(), memberId, s.platform, s.url.trim(), (s.label || '').trim(), i);
    });
  })();
}

// ─── Schema: presentations ────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS presentations (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_date       TEXT NOT NULL,
    member_name        TEXT NOT NULL,
    change_description TEXT NOT NULL,
    notes              TEXT,
    status             TEXT NOT NULL DEFAULT 'pending',
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_presentations_date ON presentations(meeting_date);
`);

// ─── Presentations CRUD ───────────────────────────────────────────────────────

function getPresentations(meetingDate) {
  return meetingDate
    ? db.prepare('SELECT * FROM presentations WHERE meeting_date = ? ORDER BY created_at DESC').all(meetingDate)
    : db.prepare('SELECT * FROM presentations ORDER BY meeting_date DESC, created_at DESC').all();
}

function insertPresentation({ meeting_date, member_name, change_description, notes }) {
  const info = db.prepare(`
    INSERT INTO presentations (meeting_date, member_name, change_description, notes)
    VALUES (?, ?, ?, ?)
  `).run(meeting_date.trim(), member_name.trim(), change_description.trim(), (notes || '').trim());
  return info.lastInsertRowid;
}

function updatePresentation(id, { meeting_date, member_name, change_description, notes, status }) {
  const cur = db.prepare('SELECT * FROM presentations WHERE id = ?').get(id);
  if (!cur) return null;
  db.prepare(`
    UPDATE presentations
    SET meeting_date = ?, member_name = ?, change_description = ?, notes = ?, status = ?
    WHERE id = ?
  `).run(
    (meeting_date       ?? cur.meeting_date).trim(),
    (member_name        ?? cur.member_name).trim(),
    (change_description ?? cur.change_description).trim(),
    (notes              ?? cur.notes ?? '').trim(),
    status              ?? cur.status,
    id,
  );
  return db.prepare('SELECT * FROM presentations WHERE id = ?').get(id);
}

function togglePresentationStatus(id) {
  const cur = db.prepare('SELECT status FROM presentations WHERE id = ?').get(id);
  if (!cur) return null;
  const next = cur.status === 'done' ? 'pending' : 'done';
  db.prepare('UPDATE presentations SET status = ? WHERE id = ?').run(next, id);
  return next;
}

function deletePresentation(id) {
  db.prepare('DELETE FROM presentations WHERE id = ?').run(id);
}

// ─── Schema: group_value ──────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS group_value (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_date  TEXT NOT NULL,
    member_id     INTEGER REFERENCES members(id),
    member_name   TEXT NOT NULL,
    meetings_1on1 INTEGER DEFAULT 0,
    referrals     INTEGER DEFAULT 0,
    closed_deals  INTEGER DEFAULT 0,
    deal_amount   REAL DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_group_value_date ON group_value(meeting_date);
`);

// ─── Group Value CRUD ─────────────────────────────────────────────────────────

function getGroupValue(meetingDate) {
  return meetingDate
    ? db.prepare('SELECT * FROM group_value WHERE meeting_date = ? ORDER BY member_name ASC').all(meetingDate)
    : db.prepare('SELECT * FROM group_value ORDER BY meeting_date DESC, member_name ASC').all();
}

function getGroupValueSummary() {
  return db.prepare(`
    SELECT meeting_date,
           SUM(meetings_1on1) as total_1on1,
           SUM(referrals)     as total_referrals,
           SUM(closed_deals)  as total_deals,
           SUM(deal_amount)   as total_amount,
           COUNT(*)           as member_count
    FROM group_value
    GROUP BY meeting_date
    ORDER BY meeting_date DESC
  `).all();
}

function getGroupValueTotals() {
  return db.prepare(`
    SELECT SUM(meetings_1on1) as total_1on1,
           SUM(referrals)     as total_referrals,
           SUM(closed_deals)  as total_deals,
           SUM(deal_amount)   as total_amount
    FROM group_value
  `).get();
}

function getGroupValueTotalsByPeriod(days) {
  return db.prepare(`
    SELECT SUM(meetings_1on1) as total_1on1,
           SUM(referrals)     as total_referrals,
           SUM(closed_deals)  as total_deals,
           SUM(deal_amount)   as total_amount
    FROM group_value
    WHERE created_at >= datetime('now', ? || ' days')
  `).get(`-${days}`);
}

function upsertGroupValue({ meeting_date, member_id, member_name, meetings_1on1 = 0, referrals = 0, closed_deals = 0, deal_amount = 0 }) {
  const existing = member_id
    ? db.prepare('SELECT id FROM group_value WHERE meeting_date = ? AND member_id = ?').get(meeting_date, member_id)
    : db.prepare('SELECT id FROM group_value WHERE meeting_date = ? AND member_name = ? AND member_id IS NULL').get(meeting_date, member_name);

  if (existing) {
    db.prepare(`
      UPDATE group_value
      SET meetings_1on1 = ?, referrals = ?, closed_deals = ?, deal_amount = ?, member_name = ?
      WHERE id = ?
    `).run(meetings_1on1, referrals, closed_deals, deal_amount, member_name, existing.id);
    return existing.id;
  } else {
    const info = db.prepare(`
      INSERT INTO group_value (meeting_date, member_id, member_name, meetings_1on1, referrals, closed_deals, deal_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(meeting_date, member_id || null, member_name, meetings_1on1, referrals, closed_deals, deal_amount);
    return info.lastInsertRowid;
  }
}

function updateGroupValue(id, { meetings_1on1, referrals, closed_deals, deal_amount, member_name }) {
  const cur = db.prepare('SELECT * FROM group_value WHERE id = ?').get(id);
  if (!cur) return null;
  db.prepare(`
    UPDATE group_value
    SET meetings_1on1 = ?, referrals = ?, closed_deals = ?, deal_amount = ?, member_name = ?
    WHERE id = ?
  `).run(
    meetings_1on1 ?? cur.meetings_1on1,
    referrals     ?? cur.referrals,
    closed_deals  ?? cur.closed_deals,
    deal_amount   ?? cur.deal_amount,
    member_name   ?? cur.member_name,
    id,
  );
  return db.prepare('SELECT * FROM group_value WHERE id = ?').get(id);
}

function deleteGroupValue(id) {
  db.prepare('DELETE FROM group_value WHERE id = ?').run(id);
}

// ─── Schema: meeting_stats ────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS meeting_stats (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_date  TEXT NOT NULL UNIQUE,
    meetings_1on1 INTEGER DEFAULT 0,
    referrals     INTEGER DEFAULT 0,
    closed_deals  INTEGER DEFAULT 0,
    deal_amount   REAL DEFAULT 0,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_meeting_stats_date ON meeting_stats(meeting_date);
`);

// Migrate existing DD/MM records to DD/MM/YY (assume year 26)
db.exec(`UPDATE meeting_stats SET meeting_date = meeting_date || '/26' WHERE meeting_date NOT LIKE '%/%/%';`);

// ─── Meeting Stats CRUD ───────────────────────────────────────────────────────

function getAllMeetingStats() {
  return db.prepare('SELECT * FROM meeting_stats ORDER BY meeting_date DESC').all();
}

function upsertMeetingStats(meeting_date, { meetings_1on1 = 0, referrals = 0, closed_deals = 0, deal_amount = 0 } = {}) {
  db.prepare(`
    INSERT INTO meeting_stats (meeting_date, meetings_1on1, referrals, closed_deals, deal_amount)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(meeting_date) DO UPDATE SET
      meetings_1on1 = excluded.meetings_1on1,
      referrals     = excluded.referrals,
      closed_deals  = excluded.closed_deals,
      deal_amount   = excluded.deal_amount
  `).run(meeting_date, meetings_1on1, referrals, closed_deals, deal_amount);
}

function getMeetingStatsTotals(days) {
  const where = days ? `WHERE created_at >= datetime('now', '-${Number(days)} days')` : '';
  return db.prepare(`
    SELECT SUM(meetings_1on1) as total_1on1,
           SUM(referrals)     as total_referrals,
           SUM(closed_deals)  as total_deals,
           SUM(deal_amount)   as total_amount
    FROM meeting_stats ${where}
  `).get();
}

function deleteMeetingStats(id) {
  db.prepare('DELETE FROM meeting_stats WHERE id = ?').run(id);
}

/** Last N meeting winners (1 per meeting date) from votes table. */
function getLastWinners(limit = 3) {
  const rows = db.prepare(`
    SELECT meetingDate AS date, candidateName AS winner_name, COUNT(*) AS votes
    FROM votes
    GROUP BY meetingDate, candidateId
    ORDER BY meetingDate DESC, votes DESC
  `).all();
  const seen = new Set();
  const result = [];
  for (const row of rows) {
    if (!seen.has(row.date)) {
      seen.add(row.date);
      result.push(row);
      if (result.length >= limit) break;
    }
  }
  return result;
}

module.exports = {
  db,
  // guests
  insertGuest,
  updateSheetRow,
  markWaSent,
  markPaid,
  markConfirmed,
  markDeclined,
  toggleWaEnabled,
  getGuestsByDate,
  getAllGuests,
  getMeetingDates,
  getGuestById,
  findGuestByPhone,
  getTotalCount,
  normalizePhone,
  // members
  getAllMembers,
  getActiveMembers,
  getMemberById,
  insertMember,
  updateMember,
  setMemberActive,
  updateMemberPhoto,
  updateMemberProfile,
  getMembersBirthday,
  // socials
  getMemberSocials,
  setMemberSocials,
  // settings
  getSetting,
  setSetting,
  getAllSettings,
  // votes
  hasVoted,
  insertVote,
  hasVotedByIp,
  insertVoteByIp,
  getVoteResults,
  getVoteCount,
  deleteVotesByDate,
  insertAnonymousVote,
  // presentations
  getPresentations,
  insertPresentation,
  updatePresentation,
  togglePresentationStatus,
  deletePresentation,
  // group_value
  getGroupValue,
  getGroupValueSummary,
  getGroupValueTotals,
  getGroupValueTotalsByPeriod,
  upsertGroupValue,
  updateGroupValue,
  deleteGroupValue,
  // meeting_stats
  getAllMeetingStats,
  upsertMeetingStats,
  getMeetingStatsTotals,
  deleteMeetingStats,
  getLastWinners,
};
