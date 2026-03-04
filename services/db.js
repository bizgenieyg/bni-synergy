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
  let d = String(phone).replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return d;
}

// ─── Guests CRUD ──────────────────────────────────────────────────────────────

function insertGuest({ firstName, lastName, phone, specialty, invitedBy, meetingDate, paid = 0, paidAt = null }) {
  const id        = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO guests
      (id, firstName, lastName, phone, specialty, invitedBy, meetingDate, paid, paidAt, createdAt, wa_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    id,
    firstName.trim(), lastName.trim(), phone.trim(),
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

function getMeetingDates() {
  return db.prepare(
    'SELECT DISTINCT meetingDate FROM guests ORDER BY createdAt DESC'
  ).all().map(r => r.meetingDate);
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

function insertMember({ name, profession, phone, birthday }) {
  const createdAt = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO members (name, profession, phone, birthday, active, createdAt)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).run(name.trim(), (profession || '').trim(), (phone || '').trim(), (birthday || '').trim(), createdAt);
  return info.lastInsertRowid;
}

function updateMember(id, { name, profession, phone, birthday, active }) {
  const current = getMemberById(id);
  if (!current) return null;
  db.prepare(
    `UPDATE members SET
       name       = ?,
       profession = ?,
       phone      = ?,
       birthday   = ?,
       active     = ?
     WHERE id = ?`
  ).run(
    (name       ?? current.name).trim(),
    (profession ?? current.profession).trim(),
    (phone      ?? current.phone).trim(),
    (birthday   ?? current.birthday).trim(),
    active      ?? current.active,
    id,
  );
  return getMemberById(id);
}

function setMemberActive(id, active) {
  db.prepare('UPDATE members SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

/**
 * Find members whose birthday starts with the given "DD/MM" prefix.
 */
function getMembersBirthday(ddmm) {
  return db.prepare(
    "SELECT * FROM members WHERE birthday LIKE ? AND active = 1"
  ).all(`${ddmm}%`);
}

module.exports = {
  db,
  // guests
  insertGuest,
  updateSheetRow,
  markWaSent,
  markPaid,
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
  getMembersBirthday,
};
