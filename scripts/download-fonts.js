#!/usr/bin/env node
/**
 * Downloads NotoSans TTF fonts for Cyrillic PDF support.
 * Runs automatically after `npm install` via postinstall hook.
 */

'use strict';

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const FONTS_DIR = path.join(__dirname, '..', 'fonts');

const BASE_NS  = 'https://github.com/notofonts/noto-fonts/raw/main/hinted/ttf/NotoSans';
const BASE_HEB = 'https://github.com/notofonts/noto-fonts/raw/main/hinted/ttf/NotoSansHebrew';

const FONTS = [
  { name: 'NotoSans-Regular.ttf',         url: `${BASE_NS}/NotoSans-Regular.ttf` },
  { name: 'NotoSans-Bold.ttf',             url: `${BASE_NS}/NotoSans-Bold.ttf` },
  { name: 'NotoSansHebrew-Regular.ttf',    url: `${BASE_HEB}/NotoSansHebrew-Regular.ttf` },
  { name: 'NotoSansHebrew-Bold.ttf',       url: `${BASE_HEB}/NotoSansHebrew-Bold.ttf` },
];

function download(url, dest, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));

    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'node/bni-synergy' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location, dest, redirectCount + 1)
          .then(resolve)
          .catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', err => { fs.unlink(dest, () => {}); reject(err); });
    });
    req.on('error', reject);
  });
}

async function main() {
  if (!fs.existsSync(FONTS_DIR)) {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
  }

  for (const font of FONTS) {
    const dest = path.join(FONTS_DIR, font.name);
    if (fs.existsSync(dest)) {
      console.log(`[fonts] Already exists: ${font.name}`);
      continue;
    }
    process.stdout.write(`[fonts] Downloading ${font.name} … `);
    try {
      await download(font.url, dest);
      console.log('done');
    } catch (err) {
      console.log(`FAILED (${err.message})`);
      console.log('[fonts] PDFs will fall back to Latin-only Helvetica.');
    }
  }
}

main();
