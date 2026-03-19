'use strict';
// Запуск: node scripts/import-guests.js
// Требует: credentials.json в корне проекта (Google Service Account key)
// или GOOGLE_APPLICATION_CREDENTIALS=./credentials.json в .env

const { google } = require('googleapis');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

async function importGuests() {
  // 1. Подключиться к Google Sheets API
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, '../credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const SPREADSHEET_ID = '1QIDMcAeMupan0oGjsQwMgi4vB5oeTgfOV-ovrxd5C6s';

  // 2. Получить список вкладок
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const allSheets = meta.data.sheets.map(s => s.properties.title);

  // 3. Фильтровать только вкладки с датами
  // Форматы: DD/MM/YYYY, DD/MM/YY, DD.MM.YY, DD/MM, DD.MM
  const dateRegex = /^\d{1,2}[\/\.\-]\d{1,2}([\/\.\-]\d{2,4})?$/;
  const dateSheets = allSheets.filter(name => dateRegex.test(name.trim()));

  console.log(`Найдено вкладок с датами: ${dateSheets.length}`);
  console.log(dateSheets.join(', '));

  // 4. Открыть БД
  const db = new Database(path.join(__dirname, '../data/guests.db'));

  let imported = 0;
  let skipped = 0;

  for (const sheetName of dateSheets) {
    // Нормализовать дату встречи → DD/MM формат
    const meetingDate = normalizeDateStr(sheetName);

    console.log(`\nОбрабатываю вкладку: ${sheetName} → ${meetingDate}`);

    // 5. Читать данные вкладки
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A:I`,
    });

    const rows = response.data.values || [];

    // Пропустить заголовок (строка 1)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 4) continue;

      const fullName = (row[3] || '').trim(); // колонка D
      if (!fullName) continue;

      const profession  = (row[4] || '').trim(); // E
      const phone       = (row[5] || '').trim(); // F
      const invitedBy   = (row[6] || '').trim(); // G
      // const notes    = (row[7] || '').trim(); // H — не используется пока
      const paymentStr  = (row[1] || '').trim(); // B — способ оплаты

      // Определить статус оплаты
      const payLower = paymentStr.toLowerCase();
      const paid = (payLower.includes('оплач') || payLower.includes('наличн')) ? 1 : 0;

      // Разбить имя на firstName + lastName
      const nameParts = fullName.split(/\s+/);
      const firstName  = nameParts[0] || fullName;
      const lastName   = nameParts.slice(1).join(' ') || '';

      // Проверить дубликат (по имени + дате встречи)
      const existing = db.prepare(
        'SELECT id FROM guests WHERE firstName=? AND lastName=? AND meetingDate=?',
      ).get(firstName, lastName, meetingDate);

      if (existing) {
        skipped++;
        continue;
      }

      // Вставить гостя
      db.prepare(`
        INSERT INTO guests (id, firstName, lastName, phone, specialty, invitedBy, meetingDate, paid, createdAt, waSent, wa_enabled)
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
    }

    console.log(`  Импортировано с этой вкладки: ${imported} (всего)`);
  }

  console.log(`\n✅ Готово! Импортировано: ${imported}, пропущено дубликатов: ${skipped}`);
  db.close();
}

function normalizeDateStr(str) {
  // Преобразует "12/05/2025", "12/05/25", "12.05.25" → "12/05"
  const clean = str.trim().replace(/\./g, '/');
  const parts  = clean.split('/');
  if (parts.length >= 2) {
    return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}`;
  }
  return str;
}

importGuests().catch(console.error);
