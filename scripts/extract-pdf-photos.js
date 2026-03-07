#!/usr/bin/env node
'use strict';

/**
 * Extract member photos from a BNI PDF member directory.
 *
 * Prerequisites (install on the server):
 *   apt-get install poppler-utils    # for pdfimages
 *   npm install pdf-parse            # for per-page text extraction
 *
 * Usage:
 *   node scripts/extract-pdf-photos.js [pdf_path] [--dry-run]
 *
 * The script:
 *   1. Extracts all embedded images from the PDF with pdfimages
 *   2. Reads per-page text to identify the member name on each page
 *   3. Matches names to DB members (fuzzy: strips extra spaces, case-insensitive)
 *   4. Renames/copies the largest image from each page to uploads/member_<id>.<ext>
 *   5. Updates the DB photo field
 */

const path          = require('path');
const fs            = require('fs');
const os            = require('os');
const { execSync }  = require('child_process');

// ── Config ──────────────────────────────────────────────────────────────────

const PDF_PATH   = process.argv.find(a => a.endsWith('.pdf')) ||
                   '/mnt/user-data/uploads/Члены_BNI.pdf';
const DRY_RUN    = process.argv.includes('--dry-run');
const UPLOADS    = path.join(__dirname, '..', 'public', 'uploads');
const TEMP_DIR   = fs.mkdtempSync(path.join(os.tmpdir(), 'bni-photos-'));

// Minimal DB usage — require after confirming file exists
let db;

// ── Helpers ─────────────────────────────────────────────────────────────────

function checkCommand(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function normalise(str) {
  return (str || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Levenshtein distance for fuzzy name matching */
function editDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

/** Best match from members list; returns null if confidence too low */
function bestMatch(pageText, members) {
  const lines = pageText.split('\n').map(l => l.trim()).filter(Boolean);
  let best = null, bestScore = Infinity;

  for (const m of members) {
    const normName = normalise(m.name);
    // Check all lines against this member name
    for (const line of lines) {
      const normLine = normalise(line);
      const dist = editDistance(normLine, normName);
      const threshold = Math.floor(normName.length * 0.3); // ≤ 30 % error
      if (dist < bestScore && dist <= threshold) {
        bestScore = dist;
        best = m;
      }
    }
  }
  return best;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(PDF_PATH)) {
    console.error(`❌ PDF not found: ${PDF_PATH}`);
    process.exit(1);
  }

  if (!checkCommand('pdfimages')) {
    console.error('❌ pdfimages not found. Install with: apt-get install poppler-utils');
    process.exit(1);
  }

  // Require pdf-parse lazily so missing package gives a clear message
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
  } catch {
    console.error('❌ pdf-parse not found. Install with: npm install pdf-parse');
    process.exit(1);
  }

  db = require('../services/db');
  const members = db.getAllMembers();
  console.log(`📋 Loaded ${members.length} members from DB`);

  if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

  // ── 1. Get page count ────────────────────────────────────────────────────

  const pdfInfo = execSync(`pdfinfo "${PDF_PATH}" 2>/dev/null || echo "Pages: 0"`)
    .toString();
  const pageCountMatch = pdfInfo.match(/Pages:\s*(\d+)/);
  const pageCount = pageCountMatch ? parseInt(pageCountMatch[1], 10) : 0;

  if (!pageCount) {
    console.error('❌ Could not determine page count. Is the PDF valid?');
    process.exit(1);
  }

  console.log(`📄 PDF has ${pageCount} pages`);

  // ── 2. Get per-page text via pdf-parse ───────────────────────────────────

  const pdfBuffer  = fs.readFileSync(PDF_PATH);
  const pageTexts  = [];   // pageTexts[i] = text of page i+1

  await pdfParse(pdfBuffer, {
    pagerender(pageData) {
      return pageData.getTextContent().then(tc => {
        const text = tc.items.map(i => i.str).join('\n');
        pageTexts.push(text);
        return text;
      });
    },
  });

  console.log(`📝 Extracted text from ${pageTexts.length} pages`);

  // ── 3. Extract images page-by-page ──────────────────────────────────────

  const results = [];

  for (let p = 1; p <= pageCount; p++) {
    const pageText = pageTexts[p - 1] || '';
    const member   = bestMatch(pageText, members);

    if (!member) {
      console.warn(`⚠️  Page ${p}: no member matched`);
      continue;
    }

    // Extract images from this page only
    const pagePrefix = path.join(TEMP_DIR, `p${p}`);
    try {
      execSync(
        `pdfimages -j -f ${p} -l ${p} "${PDF_PATH}" "${pagePrefix}"`,
        { stdio: 'ignore' },
      );
    } catch (err) {
      console.warn(`⚠️  Page ${p}: pdfimages failed — ${err.message}`);
      continue;
    }

    // Find all extracted images for this page (prefix p{n}-*)
    const imgs = fs.readdirSync(TEMP_DIR)
      .filter(f => f.startsWith(`p${p}-`) && /\.(jpg|ppm|png)$/i.test(f))
      .map(f => {
        const full = path.join(TEMP_DIR, f);
        const stat = fs.statSync(full);
        return { file: full, size: stat.size };
      })
      .sort((a, b) => b.size - a.size); // largest first (most likely the photo)

    if (!imgs.length) {
      console.warn(`⚠️  Page ${p} (${member.name}): no images found`);
      continue;
    }

    const srcFile = imgs[0].file;
    const ext     = srcFile.endsWith('.ppm') ? '.jpg' : path.extname(srcFile);
    const dest    = path.join(UPLOADS, `member_${member.id}${ext}`);

    results.push({ page: p, member, srcFile, dest, ext });
    console.log(`✅ Page ${p}: ${member.name} → ${path.basename(dest)}`);
  }

  // ── 4. Apply (copy files + update DB) ────────────────────────────────────

  if (DRY_RUN) {
    console.log('\n🔍 DRY RUN — no files written, no DB changes');
  } else {
    for (const r of results) {
      // If pdfimages produced a .ppm (raw bitmap) convert to JPEG if ImageMagick present
      let srcToCopy = r.srcFile;
      if (r.srcFile.endsWith('.ppm') && checkCommand('convert')) {
        const converted = r.srcFile.replace('.ppm', '_conv.jpg');
        try {
          execSync(`convert "${r.srcFile}" "${converted}"`, { stdio: 'ignore' });
          srcToCopy = converted;
        } catch { /* keep the ppm if convert fails */ }
      }

      fs.copyFileSync(srcToCopy, r.dest);
      db.updateMemberPhoto(r.member.id, path.basename(r.dest));
    }
    console.log(`\n✅ Updated ${results.length} member photos`);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  console.log('🗑  Temp files cleaned up');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
