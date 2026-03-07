'use strict';

/**
 * One-time import script: extract photos, Hebrew text, and social links
 * from /Users/danielyu/Downloads/Члены BNI.pdf and store in SQLite DB.
 *
 * Usage:
 *   node scripts/import-pdf-data.js --dry-run   # preview only
 *   node scripts/import-pdf-data.js              # save to DB
 */

const pdfjsLib   = require('pdfjs-dist/legacy/build/pdf.js');
const { PDFDocument, PDFName } = require('pdf-lib');
const sharp      = require('sharp');
const zlib       = require('zlib');
const path       = require('path');
const fs         = require('fs');
const Database   = require('better-sqlite3');
const { randomUUID } = require('crypto');

const DRY_RUN     = process.argv.includes('--dry-run');
const PDF_PATH    = '/Users/danielyu/Downloads/Члены BNI.pdf';
const DB_PATH     = path.join(__dirname, '..', 'data', 'guests.db');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

pdfjsLib.GlobalWorkerOptions.workerSrc = '';

// ── Hardcoded phone → PDF image ref number (from prior analysis session) ──────
// Traversal order per page determines which photo belongs to which member.
// Ref numbers were verified against the actual PDF object graph.
const PHONE_TO_REF = {
  '0526331457': 3228,  // Tatiana Lev        (page 1)
  '0544744053': 3233,  // Elena Smolkin       (page 1)
  '0545919330': 3238,  // Dr.Darien Roytman   (page 1)
  '0587060973': 3257,  // Darya Maris         (page 2)
  '0525681177': 3262,  // Viktoria Fogel      (page 2)
  '0503399829': 3267,  // Diana Sharivker     (page 2)
  '0545809092': 3284,  // Rita Hazanovich     (page 3)
  '0505812236': 3289,  // Lupinskiy Igor      (page 3)
  '0528966740': 3294,  // Alexander Kosko     (page 3)
  '0546554221': 3309,  // Evgeniy Sidelskiy   (page 4)
  '0503204861': 3314,  // Evgenia Pisman      (page 4)
  '0535390080': 3319,  // Olga Granovskaya    (page 4)
  // Sabina Erenshtein: no DB phone → DB_NAME_TO_REF
  '0539290639': 3339,  // Dmitri Melgorski    (page 5)
  '0528191040': 2803,  // Olga Gaspert        (page 5) — lower ref, different position
  '0585040567': 3354,  // Irena Zamansky      (page 6)
  '0502714814': 3359,  // Sergey Fishbakh     (page 6)
  '0526765562': 3364,  // Ludmila Rasskazov   (page 6)
  '0544956734': 3377,  // Dr.Leonid Lurya     (page 7)
  '0522751187': 3382,  // Aleksei Popovskikh  (page 7)
  '0546960404': 3388,  // Tatyana Wyss        (page 7)
  '0534453912': 3402,  // Tanzilya Korenberg  (page 8)
  '0549019324': 3407,  // Aleksandr Kudinov   (page 8)
  '0523986032': 3412,  // Irina Krol          (page 8)
  '0526074257': 3429,  // Marta Shteinberg    (page 9)
  '0546444999': 3434,  // Daniel Bilinson     (page 9)
  '0587958060': 3439,  // Nataliya Zhuk       (page 9)
  '0534882340': 3454,  // Liudmila Gubarev    (page 10)
  '0545619163': 3459,  // Michael Tkach       (page 10)
  '0544757547': 3464,  // Julia Tronza        (page 10)
  '0546815561': 3479,  // Vika Koltun         (page 11)
  '0546690524': 3484,  // Oleg Volokh         (page 11)
  '0548041987': 3490,  // Lora Blanter        (page 11)
  '0509887199': 3506,  // Marina Kondratiev   (page 12)
  '0547602162': 3511,  // Andrew Skiba        (page 12)
  // Arthur Blaer: no DB phone → DB_NAME_TO_REF
  // Yuri Gold: wrong DB phone → DB_NAME_TO_REF
  // Sharon Sokolovsky: no DB phone → DB_NAME_TO_REF
  // Igor Butin: no DB phone → DB_NAME_TO_REF
  // Anton Mikheev: wrong DB phone → DB_NAME_TO_REF
};

// DB Russian name → PDF image ref (for members whose DB phone is missing/wrong)
const DB_NAME_TO_REF = {
  'Сабина Эренштейн': 3334,
  'Михаил Ткач':      3459,  // name not detected by pdfjs on page 10
  'Артур Блаер':      3516,
  'Юрий Голд':        3533,
  'Шарон Соколовски': 3538,
  'Игорь Бутин':      3543,
  'Антон Михеев':     3558,
};

// PDF English name → DB Russian name (for phone-lookup failures)
const NAME_MAP = {
  'Sabina Erenshtein':  'Сабина Эренштейн',
  'Arthur Blaer':       'Артур Блаер',
  'Sharon Sokolovsky':  'Шарон Соколовски',
  'Igor Butin':         'Игорь Бутин',
  'Yuri Gold':          'Юрий Голд',
  'Anton Mikheev':      'Антон Михеев',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normPhone(p) {
  let d = String(p).replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return d;
}

function hasHebrew(str) {
  for (const ch of str) {
    if (ch >= '\u0590' && ch <= '\u05FF') return true;
  }
  return false;
}

// ── Social platform classifier ─────────────────────────────────────────────────
function classifySocials(rawItems) {
  const socials = [];
  let atCount = 0;

  for (const raw of rawItems) {
    const s = raw.trim();
    if (!s || s === '@') continue;

    // Skip email addresses (user@domain.tld) that are not handles
    if (/^[^@\s]{2,}@[^@\s]+\.[a-z]{2,}$/i.test(s)) continue;

    if (s.startsWith('@')) {
      const handle = s.slice(1);
      if (handle.length < 2) continue;
      if (handle.includes('-')) {
        // LinkedIn allows hyphens; Instagram/TikTok/Telegram do not
        socials.push({ platform: 'linkedin', url: `https://www.linkedin.com/in/${handle}`, label: s });
      } else {
        atCount++;
        if (atCount === 1) socials.push({ platform: 'instagram', url: `https://instagram.com/${handle}`, label: s });
        else if (atCount === 2) socials.push({ platform: 'telegram', url: `https://t.me/${handle}`, label: s });
        else socials.push({ platform: 'tiktok', url: `https://tiktok.com/@${handle}`, label: s });
      }
    } else if (/https?:\/\//i.test(s)) {
      socials.push({ platform: 'website', url: s, label: s });
    } else if (/[a-z0-9-]+\.(com|co\.il|il|net|org|io|info)/i.test(s)) {
      socials.push({ platform: 'website', url: `https://${s}`, label: s });
    } else if (/^[a-zA-Z][a-zA-Z0-9._-]{4,}$/.test(s)) {
      // Plain word ≥5 chars with no spaces → Facebook username
      socials.push({ platform: 'facebook', url: `https://facebook.com/${s}`, label: s });
    }
  }
  return socials;
}

// ── Build refNum → PDFRawStream map from pdf-lib ──────────────────────────────
async function buildImageRefMap(buf) {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const map = new Map(); // refNum → PDFRawStream
  for (const [ref, obj] of doc.context.indirectObjects) {
    if (!obj || obj.constructor.name !== 'PDFRawStream') continue;
    let subtype;
    try { subtype = obj.dict.get(PDFName.of('Subtype')); } catch { continue; }
    if (!subtype || subtype.encodedName !== '/Image') continue;
    map.set(parseInt(String(ref)), obj);
  }
  return map;
}

// ── Convert image object → JPEG Buffer ────────────────────────────────────────
async function imageToJpeg(obj) {
  const filter   = obj.dict.get(PDFName.of('Filter'))?.encodedName;
  const w        = obj.dict.get(PDFName.of('Width'))?.numberValue;
  const h        = obj.dict.get(PDFName.of('Height'))?.numberValue;

  if (filter === '/DCTDecode') {
    return Buffer.from(obj.contents);
  }
  if (filter === '/FlateDecode') {
    let channels = 3;
    try {
      const cs = obj.dict.get(PDFName.of('ColorSpace'));
      if (cs && cs.encodedName === '/DeviceGray') channels = 1;
    } catch {}
    const raw = zlib.inflateSync(Buffer.from(obj.contents));
    return await sharp(raw, { raw: { width: w, height: h, channels } })
      .jpeg({ quality: 90 })
      .toBuffer();
  }
  return null;
}

// ── Extract text items from a page (pdfjs) ────────────────────────────────────
async function getPageItems(pdfDoc, pageNum) {
  const page    = await pdfDoc.getPage(pageNum);
  const content = await page.getTextContent();
  return content.items.map(item => ({
    str: item.str,
    x:   item.transform[4],
    y:   item.transform[5],
    h:   Math.abs(item.transform[3]),
    w:   item.width || 0,
  }));
}

// ── Parse one page's items into member blocks ─────────────────────────────────
function parsePageMembers(items) {
  // Step 1: collect large Latin items (potential name fragments)
  const latCandidates = items
    .filter(it => {
      if (it.h < 12) return false;
      if (hasHebrew(it.str)) return false;
      const latin = (it.str.match(/[a-zA-Z]/g) || []).length;
      return latin >= 2;
    })
    .sort((a, b) => (b.y - a.y) || (a.x - b.x)); // top first, left first

  // Step 2: merge items at the same Y line (within 3px) into name line objects
  const nameLines = [];
  for (const item of latCandidates) {
    const last = nameLines[nameLines.length - 1];
    if (last && Math.abs(item.y - last.y) <= 3) {
      last.str += ' ' + item.str.trim();
      last.h    = Math.max(last.h, item.h);
    } else {
      nameLines.push({ str: item.str.trim(), y: item.y, h: item.h, x: item.x });
    }
  }

  // Step 3: filter to actual member names (two-word, starts Capital, h ≥ 14)
  const memberNameLines = nameLines.filter(l => {
    const s = l.str.trim();
    if (l.h < 14) return false;
    if (!s || hasHebrew(s)) return false;
    const latin = (s.match(/[a-zA-Z]/g) || []).length;
    if (latin < 4) return false;
    if (!/^(Dr\.)?[A-Z]/.test(s)) return false;
    // Must have at least one space (two words) or start with "Dr."
    if (!s.includes(' ') && !s.startsWith('Dr.')) return false;
    return true;
  }).sort((a, b) => b.y - a.y); // top of page first

  if (memberNameLines.length === 0) return [];

  const members = [];
  for (let i = 0; i < memberNameLines.length; i++) {
    const nameLine = memberNameLines[i];
    const yTop = nameLine.y + nameLine.h + 5;
    const yBot = (i + 1 < memberNameLines.length) ? memberNameLines[i + 1].y : 0;

    const blockItems = items.filter(it => it.y >= yBot && it.y <= yTop);

    // Phone: Israeli mobile 05xxxxxxxx
    const phones = blockItems
      .map(it => (it.str.match(/\b0[0-9]{9}\b/) || [])[0])
      .filter(Boolean);
    const phone = phones[0] || '';

    // Social raw items
    const nameStr = nameLine.str.trim();
    const socialRaw = blockItems
      .filter(it => {
        const s = it.str.trim();
        if (!s || s === nameStr) return false;
        if (phones.includes(s)) return false;
        if (hasHebrew(s)) return false;
        return (
          s.startsWith('@') ||
          /https?:\/\//i.test(s) ||
          /[a-z0-9-]+\.(com|co\.il|il|net|org|io|info)/i.test(s) ||
          /^[a-zA-Z][a-zA-Z0-9._-]{4,}$/.test(s)
        );
      })
      .map(it => it.str.trim())
      .filter((s, idx, arr) => arr.indexOf(s) === idx); // dedup

    // Hebrew text items
    const hebrewItems = blockItems
      .filter(it => hasHebrew(it.str) && it.str.trim().length > 1);

    members.push({ name: nameStr, phone, socialRaw, hebrewItems });
  }

  return members;
}

// ── Build profession_he from Hebrew items ─────────────────────────────────────
function buildHebrewText(hebrewItems) {
  if (hebrewItems.length === 0) return '';

  const sorted = [...hebrewItems].sort((a, b) => b.y - a.y);
  const lines = [];
  let cur = null;
  for (const item of sorted) {
    if (!cur || Math.abs(item.y - cur.y) > 3) {
      cur = { y: item.y, items: [item] };
      lines.push(cur);
    } else {
      cur.items.push(item);
    }
  }
  return lines
    .map(line => line.items.sort((a, b) => b.x - a.x).map(it => it.str).join(''))
    .join(' ')
    .trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'IMPORT (will write to DB)'}\n`);

  if (!fs.existsSync(PDF_PATH)) {
    console.error(`PDF not found: ${PDF_PATH}`); process.exit(1);
  }

  console.log('Loading PDF...');
  const buf = fs.readFileSync(PDF_PATH);

  // ── Build image ref map (pdf-lib) ─────────────────────────────────────────────
  console.log('Building image ref map...');
  const imageRefMap = await buildImageRefMap(buf);
  console.log(`  ${imageRefMap.size} image objects indexed`);

  // Verify all known refs exist
  const allKnownRefs = [...Object.values(PHONE_TO_REF), ...Object.values(DB_NAME_TO_REF)];
  const missingRefs  = allKnownRefs.filter(r => !imageRefMap.has(r));
  if (missingRefs.length) console.warn(`  WARNING: refs not found in PDF: ${missingRefs.join(', ')}`);

  // ── Extract text per page (pdfjs) ─────────────────────────────────────────────
  console.log('\nExtracting text per page...');
  const loadTask = pdfjsLib.getDocument({ data: new Uint8Array(buf) });
  const pdfDoc   = await loadTask.promise;
  const numPages = pdfDoc.numPages;
  console.log(`  ${numPages} pages`);

  const pdfMembers = [];
  for (let p = 1; p <= numPages; p++) {
    const items      = await getPageItems(pdfDoc, p);
    const pageMembers = parsePageMembers(items);
    for (const m of pageMembers) pdfMembers.push({ ...m, pageNum: p });
    process.stdout.write(`  page ${p}: ${pageMembers.map(m => m.name).join(', ') || '(none)'}\n`);
  }
  console.log(`\n  Total member blocks: ${pdfMembers.length}`);

  // ── Load DB + migrate ─────────────────────────────────────────────────────────
  console.log('\nLoading DB...');
  const db = new Database(DB_PATH);
  try { db.exec('ALTER TABLE members ADD COLUMN photo TEXT'); } catch {}
  try { db.exec('ALTER TABLE members ADD COLUMN name_he TEXT'); } catch {}
  try { db.exec('ALTER TABLE members ADD COLUMN profession_he TEXT'); } catch {}
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

  const dbMembers = db.prepare('SELECT * FROM members WHERE active = 1').all();
  console.log(`  ${dbMembers.length} active DB members`);

  const phoneMap  = new Map(dbMembers.filter(m => m.phone).map(m => [normPhone(m.phone), m]));
  const nameRuMap = new Map(dbMembers.map(m => [m.name, m]));

  // ── Match PDF members to DB + resolve image refs ───────────────────────────────
  const usedDbIds = new Set();
  const results   = [];

  for (const pm of pdfMembers) {
    let dbMember = null, matchMethod = '';

    // Primary: phone match
    if (pm.phone) {
      const c = phoneMap.get(normPhone(pm.phone));
      if (c && !usedDbIds.has(c.id)) { dbMember = c; matchMethod = `phone(${normPhone(pm.phone)})`; }
    }

    // Secondary: NAME_MAP
    if (!dbMember && NAME_MAP[pm.name]) {
      const c = nameRuMap.get(NAME_MAP[pm.name]);
      if (c && !usedDbIds.has(c.id)) { dbMember = c; matchMethod = `name_map`; }
    }

    if (dbMember) usedDbIds.add(dbMember.id);

    // Resolve image: phone → ref → PDFRawStream
    let imageObj = null, imageRef = null;
    if (pm.phone) imageRef = PHONE_TO_REF[normPhone(pm.phone)];
    if (!imageRef && dbMember) imageRef = DB_NAME_TO_REF[dbMember.name];
    if (imageRef) imageObj = imageRefMap.get(imageRef) || null;

    const hebrewText = buildHebrewText(pm.hebrewItems);
    const socials    = classifySocials(pm.socialRaw);

    results.push({ pdfName: pm.name, pageNum: pm.pageNum, phone: pm.phone,
                   hebrewText, socialRaw: pm.socialRaw, socials,
                   imageRef, imageObj, dbMember, matchMethod });
  }

  // ── Also add DB-only members (photo/Hebrew only, no text extraction needed) ────
  // Members not found in pdfjs text but have a known image ref via DB_NAME_TO_REF
  for (const [ruName, ref] of Object.entries(DB_NAME_TO_REF)) {
    if ([...results].some(r => r.dbMember?.name === ruName)) continue; // already matched
    const dbMember = nameRuMap.get(ruName);
    if (!dbMember || usedDbIds.has(dbMember.id)) continue;
    const imageObj = imageRefMap.get(ref) || null;
    results.push({ pdfName: `(no text found — ${ruName})`, pageNum: 0, phone: '',
                   hebrewText: '', socialRaw: [], socials: [],
                   imageRef: ref, imageObj, dbMember, matchMethod: 'db_name_ref_only' });
  }

  // ── Print report ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(90));
  console.log(DRY_RUN ? '  DRY RUN — no writes' : '  IMPORT — writing to DB');
  console.log('═'.repeat(90));

  let matched = 0, unmatched = 0;
  for (const r of results) {
    if (r.dbMember) matched++; else unmatched++;
    const status = r.dbMember
      ? `✅  id=${r.dbMember.id}  ${r.dbMember.name}  [${r.matchMethod}]`
      : '❌  NO MATCH';

    console.log(`\nPage ${r.pageNum}: ${r.pdfName}`);
    console.log(`  Match  : ${status}`);
    console.log(`  Phone  : ${r.phone || '(none)'}`);
    console.log(`  Hebrew : ${r.hebrewText || '(none)'}`);
    if (r.socialRaw.length)
      console.log(`  Raw    : ${r.socialRaw.join('  |  ')}`);
    if (r.socials.length) {
      console.log('  Socials:');
      for (const s of r.socials)
        console.log(`    [${s.platform.padEnd(9)}] ${s.label}  →  ${s.url}`);
    }
    if (r.imageObj) {
      const w = r.imageObj.dict.get(PDFName.of('Width'))?.numberValue;
      const h = r.imageObj.dict.get(PDFName.of('Height'))?.numberValue;
      const f = r.imageObj.dict.get(PDFName.of('Filter'))?.encodedName;
      console.log(`  Photo  : ref=${r.imageRef} ${w}x${h} ${f} ${r.imageObj.contents.length}b`);
    } else {
      console.log(`  Photo  : (none — ref=${r.imageRef || '?'})`);
    }
  }

  console.log('\n' + '─'.repeat(90));
  console.log(`Matched: ${matched}/${results.length}  |  Unmatched: ${unmatched}`);

  const unmatchedDb = dbMembers.filter(m => !usedDbIds.has(m.id));
  if (unmatchedDb.length) {
    console.log(`\nDB members with no PDF data (${unmatchedDb.length}):`);
    for (const m of unmatchedDb) console.log(`  id=${m.id}  ${m.name}  phone=${m.phone}`);
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes saved. Re-run without --dry-run to import.');
    process.exit(0);
  }

  // ── Save to DB ────────────────────────────────────────────────────────────────
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const stmtUpdateHe    = db.prepare('UPDATE members SET profession_he = ? WHERE id = ?');
  const stmtUpdatePhoto = db.prepare('UPDATE members SET photo = ? WHERE id = ?');
  const stmtCountSocials = db.prepare('SELECT COUNT(*) as c FROM member_socials WHERE member_id = ?');
  const stmtInsSocial   = db.prepare(
    'INSERT INTO member_socials (id, member_id, platform, url, label, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  );

  let savedPhotos = 0, savedHe = 0, savedSocials = 0;

  for (const r of results) {
    if (!r.dbMember) continue;
    const mid = r.dbMember.id;

    // Photo
    if (r.imageObj) {
      try {
        const jpegBuf = await imageToJpeg(r.imageObj);
        if (jpegBuf) {
          const filename = `member_${mid}.jpg`;
          fs.writeFileSync(path.join(UPLOADS_DIR, filename), jpegBuf);
          stmtUpdatePhoto.run(filename, mid);
          savedPhotos++;
          console.log(`  Photo saved: ${filename} (${jpegBuf.length}b) ← ${r.pdfName}`);
        }
      } catch (e) {
        console.warn(`  Photo failed [${r.pdfName}]: ${e.message}`);
      }
    }

    // Hebrew profession
    if (r.hebrewText) {
      stmtUpdateHe.run(r.hebrewText, mid);
      savedHe++;
    }

    // Socials (only if member has none yet)
    if (r.socials.length > 0 && stmtCountSocials.get(mid).c === 0) {
      db.transaction(() => {
        for (const [i, s] of r.socials.entries()) {
          stmtInsSocial.run(randomUUID(), mid, s.platform, s.url, s.label, i);
        }
      })();
      savedSocials += r.socials.length;
    }
  }

  console.log(`\n✅ Done — photos: ${savedPhotos}, Hebrew texts: ${savedHe}, social links: ${savedSocials}`);
  process.exit(0);
})().catch(e => {
  console.error('\nERROR:', e.message);
  console.error(e.stack);
  process.exit(1);
});
