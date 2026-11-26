#!/usr/bin/env node
'use strict';

// Lists the inviter spellings that were NOT matched to a member (guests.invited_by_member_id IS NULL),
// how many guests have each, and the closest member names as a HINT. Read-only: nothing is written,
// nothing is matched automatically.
//   node scripts/list-unmatched-inviters.js [group_id]      (DB path from DB_PATH, default data/guests.db)

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'guests.db');
const groupId = Number(process.argv[2] || 1);
const db = new Database(DB_PATH, { readonly: true });

const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['гость', 'гостья', 'замена', 'зам', 'заместитель', 'вместо', 'кандидат', 'bni', 'д-р', 'др']);

function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

// Similarity of a free-text spelling to a member name: best of whole-string similarity and the
// best match between significant words (surnames are often written in another case: "Заманской" ~ "Заманская").
function score(text, member) {
  const a = norm(text), b = norm(member);
  const whole = 1 - lev(a, b) / Math.max(a.length, b.length, 1);
  const aw = a.split(' ').filter(w => w.length >= 3 && !STOP.has(w));
  const bw = b.split(' ').filter(w => w.length >= 3);
  let words = 0;
  for (const x of aw) for (const y of bw) {
    const stem = Math.min(x.length, y.length, 6);
    const s = x.slice(0, stem) === y.slice(0, stem) ? 0.9 : 1 - lev(x, y) / Math.max(x.length, y.length);
    if (s > words) words = s;
  }
  return Math.max(whole, words * 0.95);
}

const members = db.prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY name').all(groupId);
const rows = db.prepare(`SELECT TRIM(invitedBy) AS name, COUNT(*) AS guests FROM guests
  WHERE group_id = ? AND invited_by_member_id IS NULL AND TRIM(invitedBy) != ''
  GROUP BY TRIM(invitedBy) ORDER BY guests DESC, name`).all(groupId);

const totals = db.prepare(`SELECT
  COUNT(*) AS all_guests,
  SUM(CASE WHEN invited_by_member_id IS NOT NULL THEN 1 ELSE 0 END) AS with_id,
  SUM(CASE WHEN invited_by_member_id IS NULL AND TRIM(invitedBy) != '' THEN 1 ELSE 0 END) AS text_only,
  SUM(CASE WHEN invited_by_member_id IS NULL AND TRIM(invitedBy) = '' THEN 1 ELSE 0 END) AS empty
  FROM guests WHERE group_id = ?`).get(groupId);

console.log(`Group ${groupId}: guests ${totals.all_guests}; inviter matched by ID ${totals.with_id}; ` +
  `written as text only ${totals.text_only} (${rows.length} distinct spellings); no inviter written ${totals.empty}\n`);

for (const r of rows) {
  const best = members.map(m => ({ m, s: score(r.name, m.name) })).filter(x => x.s >= 0.55).sort((x, y) => y.s - x.s).slice(0, 3);
  const hint = best.length ? best.map(x => `${x.m.name} (#${x.m.id}, ${Math.round(x.s * 100)}%)`).join('; ') : '—';
  console.log(`${String(r.guests).padStart(4)}  ${r.name}\n        closest: ${hint}`);
}
console.log('\nHints only: nothing was written. Match by hand in the admin.');
