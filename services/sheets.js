'use strict';

const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

// Column order — DO NOT change headers
// A = ВСТРЕЧА | B = Способ оплаты | C = № | D = Имя и Фамилия
// E = Профессия/вид деятельности | F = Телефон | G = Кто пригласил | H = Заметки | I = Email
const FALLBACK_HEADERS = [
  'ВСТРЕЧА', 'Способ оплаты', '№', 'Имя и Фамилия',
  'Профессия/вид деятельности', 'Телефон', 'Кто пригласил', 'Заметки', 'Email',
];

// ─── Auth ─────────────────────────────────────────────────────────────────────

function createAuthClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key   = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!email || !key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY must be set');
  }

  return new google.auth.JWT(
    email,
    null,
    key,
    ['https://www.googleapis.com/auth/spreadsheets'],
  );
}

async function getSheetsClient() {
  const auth = createAuthClient();
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

// ─── Tab management ───────────────────────────────────────────────────────────

async function getAllTabs(sheets) {
  const res = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  return res.data.sheets || [];
}

/** Filter tabs that match the DD/MM date pattern */
function getDateTabs(tabs) {
  return tabs.filter(s => /^\d{2}\/\d{2}$/.test(s.properties.title));
}

/**
 * Return the most recent date tab by calendar order (month desc, day desc).
 * Assumes all dates are within the same year.
 */
function getMostRecentDateTab(tabs) {
  const dateTabs = getDateTabs(tabs);
  if (!dateTabs.length) return null;

  dateTabs.sort((a, b) => {
    const [ad, am] = a.properties.title.split('/').map(Number);
    const [bd, bm] = b.properties.title.split('/').map(Number);
    if (am !== bm) return bm - am; // month descending
    return bd - ad;                // day descending
  });

  return dateTabs[0];
}

/**
 * Create a new sheet tab and initialise it with headers copied from the most
 * recent existing date tab (or the fallback header list).
 */
async function createTab(sheets, tabTitle) {
  // 1. Add sheet
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabTitle } } }],
    },
  });

  // 2. Find headers to copy from most recent tab
  const tabs    = await getAllTabs(sheets);
  const recent  = getMostRecentDateTab(tabs.filter(t => t.properties.title !== tabTitle));
  let headers   = FALLBACK_HEADERS;

  if (recent) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `'${recent.properties.title}'!A1:I1`,
      });
      if (res.data.values?.[0]?.length) {
        headers = res.data.values[0];
        // Ensure Email column is always present
        if (!headers.includes('Email')) headers = [...headers, 'Email'];
      }
    } catch (e) {
      console.warn(`[Sheets] Could not copy headers from "${recent.properties.title}":`, e.message);
    }
  }

  // 3. Write headers
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${tabTitle}'!A1:I1`,
    valueInputOption: 'RAW',
    requestBody: { values: [headers] },
  });

  console.log(`[Sheets] Created tab "${tabTitle}"`);
}

// ─── Row numbering ────────────────────────────────────────────────────────────

/**
 * Return the next sequential number for column C in the given tab.
 * Reads column C (skipping header row), finds the max numeric value.
 */
async function getNextRowNumber(sheets, tabTitle) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${tabTitle}'!C2:C`,
    });
    const values = res.data.values || [];
    let max = 0;
    for (const row of values) {
      const n = parseInt(row[0], 10);
      if (!isNaN(n) && n > max) max = n;
    }
    return max + 1;
  } catch {
    return 1;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Append a guest row to the tab named `meetingDate` (e.g. "09/03").
 * Creates the tab if it doesn't exist.
 * Returns the 1-based sheet row index that was written.
 */
async function appendGuest({ name, phone, specialty, invitedBy, meetingDate, paymentMethod = 'онлайн', email = '' }) {
  const sheets = await getSheetsClient();

  // Tab name is always DD/MM (strip year if present in meetingDate DD/MM/YY)
  const tabTitle = meetingDate.split('/').slice(0, 2).join('/');

  // Ensure the tab exists
  const tabs = await getAllTabs(sheets);
  if (!tabs.find(t => t.properties.title === tabTitle)) {
    await createTab(sheets, tabTitle);
  }

  const rowNum   = await getNextRowNumber(sheets, tabTitle);
  const fullName = name;

  // A=ВСТРЕЧА(empty) B=Способ оплаты C=№ D=Имя и Фамилия E=Профессия F=Телефон G=Кто пригласил H=Заметки(empty) I=Email
  const row = ['', paymentMethod, rowNum, fullName, specialty || '', phone, invitedBy || '', '', email || ''];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `'${tabTitle}'!A:I`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  // Parse actual row number from updatedRange, e.g. "'09/03'!A7:H7"
  const updatedRange = res.data.updates?.updatedRange || '';
  const match = updatedRange.match(/!A(\d+)/);
  const sheetRow = match ? parseInt(match[1], 10) : null;

  console.log(`[Sheets] Appended "${fullName}" to tab "${tabTitle}" row ${sheetRow}`);
  return sheetRow;
}

/**
 * Update column B of a guest's row to "опл,{DD/MM}" (e.g. "опл,09/03").
 */
async function markPaid(meetingDate, sheetRow) {
  if (!meetingDate || !sheetRow) return;

  // Tab name is always DD/MM (strip year if present)
  const sheetTab = meetingDate.split('/').slice(0, 2).join('/');
  const sheets   = await getSheetsClient();
  const value    = `опл,${sheetTab}`;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `'${sheetTab}'!B${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });

  console.log(`[Sheets] Marked paid: tab "${sheetTab}" row ${sheetRow} → "${value}"`);
}

module.exports = { appendGuest, markPaid };
