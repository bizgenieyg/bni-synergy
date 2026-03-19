'use strict';
// Запуск: node scripts/import-guests.js
// Использует те же env-переменные, что и сервер:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL
//   GOOGLE_PRIVATE_KEY
//   GOOGLE_SHEET_ID  (опционально — или хардкод ниже)

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { google } = require('googleapis');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || '1QIDMcAeMupan0oGjsQwMgi4vB5oeTgfOV-ovrxd5C6s';

function createAuthClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key   = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!email || !key) {
    throw new Error(
      'Не заданы GOOGLE_SERVICE_ACCOUNT_EMAIL и/или GOOGLE_PRIVATE_KEY в .env',
    );
  }

  return new google.auth.JWT(
    email,
    null,
    key,
    ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  );
}

/**
 * Нормализовать название вкладки → DD/MM/YY
 * "16/03"       → "16/03/25"  (используем currentYear)
 * "16/03/25"    → "16/03/25"
 * "16/03/2025"  → "16/03/25"
 * "16.03.2025"  → "16/03/25"
 */
function normalizeDateStr(str, currentYY) {
  const clean = str.trim().replace(/\./g, '/');
  const parts = clean.split('/');
  if (parts.length < 2) return str;

  const dd = parts[0].padStart(2, '0');
  const mm = parts[1].padStart(2, '0');

  if (parts.length >= 3) {
    const raw = parts[2];
    const yy  = raw.length === 4 ? raw.slice(2) : raw.padStart(2, '0');
    return `${dd}/${mm}/${yy}`;
  }

  // No year in sheet name — use provided currentYY
  return `${dd}/${mm}/${currentYY}`;
}

/** Normalise phone to 0XX-XXX-XXXX domestic format for dedup */
function normalizePhone(phone) {
  let d = String(phone).replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return d;
}

async function importGuests() {
  const auth = createAuthClient();
  await auth.authorize();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Получить список вкладок
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const allSheets = meta.data.sheets.map(s => s.properties.title);

  // 2. Фильтровать только вкладки с датами
  const dateRegex = /^\d{1,2}[\/\.\-]\d{1,2}([\/\.\-]\d{2,4})?$/;
  const dateSheets = allSheets.filter(name => dateRegex.test(name.trim()));

  console.log(`Найдено вкладок с датами: ${dateSheets.length}`);
  console.log(dateSheets.join(', '));

  const currentYY = String(new Date().getFullYear()).slice(2);

  // 3. Открыть БД
  const db = new Database(path.join(__dirname, '../data/guests.db'));

  let imported = 0;
  let skipped  = 0;

  for (const sheetName of dateSheets) {
    const meetingDate = normalizeDateStr(sheetName, currentYY);

    console.log(`\nОбрабатываю вкладку: "${sheetName}" → ${meetingDate}`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A:I`,
    });

    const rows = response.data.values || [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 4) continue;

      const name = (row[3] || '').trim(); // D — Имя и Фамилия (полностью)
      if (!name) continue;

      const profession  = (row[4] || '').trim(); // E
      const rawPhone    = (row[5] || '').trim(); // F
      const invitedBy   = (row[6] || '').trim(); // G
      const paymentStr  = (row[1] || '').trim(); // B — Способ оплаты

      const phone    = normalizePhone(rawPhone);
      const payLower = paymentStr.toLowerCase();
      const paid     = (payLower.includes('оплач') || payLower.includes('наличн') || payLower.includes('опл,')) ? 1 : 0;

      // Дедупликация по телефону + дате встречи
      const existing = phone
        ? db.prepare('SELECT id FROM guests WHERE phone=? AND meetingDate=?').get(phone, meetingDate)
        : db.prepare('SELECT id FROM guests WHERE name=? AND meetingDate=?').get(name, meetingDate);

      if (existing) {
        skipped++;
        continue;
      }

      db.prepare(`
        INSERT INTO guests
          (id, name, firstName, lastName, phone, specialty, invitedBy, meetingDate, paid, createdAt, waSent, wa_enabled)
        VALUES (?, ?, '', '', ?, ?, ?, ?, ?, ?, 0, 1)
      `).run(
        uuidv4(),
        name,
        rawPhone,   // хранить оригинальный телефон
        profession,
        invitedBy,
        meetingDate,
        paid,
        new Date().toISOString(),
      );

      imported++;
      console.log(`  + ${name}  (${meetingDate})`);
    }
  }

  console.log(`\n✅ Готово! Импортировано: ${imported}, пропущено дубликатов: ${skipped}`);
  db.close();
}

importGuests().catch(console.error);
