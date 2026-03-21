'use strict';

const Database   = require('better-sqlite3');
const path       = require('path');
const { randomUUID } = require('crypto');
const data       = require('./member_socials.json');

const db = new Database(path.join(__dirname, '../data/guests.db'));

// Ensure profession_he column exists
try { db.exec("ALTER TABLE members ADD COLUMN profession_he TEXT NOT NULL DEFAULT ''"); } catch {}

let updated = 0;
let notFound = 0;

const del = db.prepare('DELETE FROM member_socials WHERE member_id=?');
const ins = db.prepare(
  'INSERT INTO member_socials (id, member_id, platform, url, label, sort_order) VALUES (?,?,?,?,?,?)'
);

const doImport = db.transaction(() => {
  for (const member of data) {
    // Try exact match → first-word → last-word (handles "Лена" vs "Елена" etc.)
    const parts     = member.name.split(' ');
    const firstName = parts[0];
    const lastName  = parts[parts.length - 1];
    const found =
      db.prepare('SELECT id FROM members WHERE name=?').get(member.name) ||
      db.prepare('SELECT id FROM members WHERE name LIKE ?').get(`%${firstName}%`) ||
      db.prepare('SELECT id FROM members WHERE name LIKE ?').get(`%${lastName}%`);

    if (!found) {
      console.log(`[NOT FOUND] ${member.name}`);
      notFound++;
      continue;
    }

    // Update profession_he
    if (member.profession_he) {
      db.prepare('UPDATE members SET profession_he=? WHERE id=?')
        .run(member.profession_he, found.id);
    }

    // Replace socials
    del.run(found.id);
    member.socials.forEach((s, i) => {
      ins.run(
        randomUUID(),
        found.id,
        s.platform.toLowerCase(), // JSON has capitalized platforms → normalise
        s.url,
        s.label || '',
        i,
      );
    });

    console.log(`[OK] ${member.name} — ${member.socials.length} соцсетей`);
    updated++;
  }
});

console.log('\n=== Import member socials ===\n');
doImport();
console.log(`\nГотово: обновлено ${updated}, не найдено ${notFound}`);

db.close();
