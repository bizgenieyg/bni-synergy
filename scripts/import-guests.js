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

async function importGuests() {
  const auth = createAuthClient();
  await auth.authorize();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Получить список вкладок
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const allSheets = meta.data.sheets.map(s => s.properties.title);

  // 2. Фильтровать только вкладки с датами
  // Поддерживает: DD/MM, DD/MM/YY, DD/MM/YYYY, DD.MM, DD.MM.YY, DD.MM.YYYY
  const dateRegex = /^\d{1,2}[\/\.\-]\d{1,2}([\/\.\-]\d{2,4})?$/;
  const dateSheets = allSheets.filter(name => dateRegex.test(name.trim()));

  console.log(`Найдено вкладок с датами: ${dateSheets.length}`);
  console.log(dateSheets.join(', '));

  // 3. Открыть БД
  const db = new Database(path.join(__dirname, '../data/guests.db'));

  let imported = 0;
  let skipped = 0;

  for (const sheetName of dateSheets) {
    const meetingDate = normalizeDateStr(sheetName);

    console.log(`\nОбрабатываю вкладку: "${sheetName}" → ${meetingDate}`);

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A:I`,
    });

    const rows = response.data.values || [];

    // Пропустить заголовок (строка 1)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 4) continue;

      const fullName = (row[3] || '').trim(); // D — Имя и Фамилия
      if (!fullName) continue;

      const profession  = (row[4] || '').trim(); // E
      const phone       = (row[5] || '').trim(); // F
      const invitedBy   = (row[6] || '').trim(); // G
      const paymentStr  = (row[1] || '').trim(); // B — Способ оплаты

      const payLower = paymentStr.toLowerCase();
      const paid = (
        payLower.includes('оплач') ||
        payLower.includes('наличн') ||
        payLower.includes('опл,')
      ) ? 1 : 0;

      // Имя + Фамилия
      const nameParts = fullName.split(/\s+/);
      const firstName  = nameParts[0] || fullName;
      const lastName   = nameParts.slice(1).join(' ') || '';

      // Проверить дубликат
      const existing = db.prepare(
        'SELECT id FROM guests WHERE firstName=? AND lastName=? AND meetingDate=?',
      ).get(firstName, lastName, meetingDate);

      if (existing) {
        skipped++;
        continue;
      }

      db.prepare(`
        INSERT INTO guests
          (id, firstName, lastName, phone, specialty, invitedBy, meetingDate, paid, createdAt, waSent, wa_enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
      `).run(
        uuidv4(),
        firstName,
        lastName,
        phone,
        profession,
        invitedBy,
        meetingDate,
        paid,
        new Date().toISOString(),
      );

      imported++;
      console.log(`  + ${firstName} ${lastName}`);
    }
  }

  console.log(`\n✅ Готово! Импортировано: ${imported}, пропущено дубликатов: ${skipped}`);
  db.close();
}

function normalizeDateStr(str) {
  // "12/05/2025", "12/05/25", "12.05.25" → "12/05"
  const clean = str.trim().replace(/\./g, '/');
  const parts  = clean.split('/');
  if (parts.length >= 2) {
    return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}`;
  }
  return str;
}

importGuests().catch(console.error);
