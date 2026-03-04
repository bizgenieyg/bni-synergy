'use strict';

const path      = require('path');
const fs        = require('fs');
const { randomUUID } = require('crypto');
const Database  = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'guests.db');

// Ensure data directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────

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
    sheetRow    INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_guests_meeting  ON guests(meetingDate);
  CREATE INDEX IF NOT EXISTS idx_guests_phone    ON guests(phone);
  CREATE INDEX IF NOT EXISTS idx_guests_created  ON guests(createdAt);
`);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Normalise a phone number to Israeli local format (e.g. "0521234567").
 * Accepts: 052-123-4567 | +972521234567 | 972521234567 | 0521234567
 */
function normalizePhone(phone) {
  let d = String(phone).replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return d;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

function insertGuest({ firstName, lastName, phone, specialty, invitedBy, meetingDate }) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO guests (id, firstName, lastName, phone, specialty, invitedBy, meetingDate, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, firstName.trim(), lastName.trim(), phone.trim(), (specialty || '').trim(), (invitedBy || '').trim(), meetingDate, createdAt);
  return id;
}

function updateSheetRow(id, sheetRow) {
  db.prepare('UPDATE guests SET sheetRow = ? WHERE id = ?').run(sheetRow, id);
}

function markWaSent(id) {
  db.prepare('UPDATE guests SET waSent = 1 WHERE id = ?').run(id);
}

function markPaid(id) {
  db.prepare("UPDATE guests SET paid = 1, paidAt = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
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

/**
 * Find a guest by phone number, comparing normalised digits.
 */
function findGuestByPhone(rawPhone) {
  const target = normalizePhone(rawPhone);
  const all = db.prepare('SELECT * FROM guests').all();
  return all.find(g => normalizePhone(g.phone) === target) || null;
}

function getTotalCount() {
  return db.prepare('SELECT COUNT(*) as c FROM guests').get().c;
}

module.exports = {
  db,
  insertGuest,
  updateSheetRow,
  markWaSent,
  markPaid,
  getGuestsByDate,
  getAllGuests,
  getMeetingDates,
  getGuestById,
  findGuestByPhone,
  getTotalCount,
  normalizePhone,
};
