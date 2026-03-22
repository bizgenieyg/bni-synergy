'use strict';

const path = require('path');
const fs   = require('fs');
const PDFDocument = require('pdfkit');

const FONTS_DIR        = path.join(__dirname, '..', 'fonts');
const FONT_REGULAR     = path.join(FONTS_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD        = path.join(FONTS_DIR, 'NotoSans-Bold.ttf');
const FONT_HEB_REGULAR = path.join(FONTS_DIR, 'NotoSansHebrew-Regular.ttf');
const FONT_HEB_BOLD    = path.join(FONTS_DIR, 'NotoSansHebrew-Bold.ttf');

// Badge dimensions: 90mm × 50mm ≈ 255pt × 142pt
const BADGE_W = 255;
const BADGE_H = 142;

// A4 portrait: 595 × 842 pt
// Layout: 2 cols, 5 rows, computed margins
const COLS      = 2;
const ROWS      = 5;
const PAGE_W    = 595;
const PAGE_H    = 842;
const MARGIN_H  = 20;   // left/right page margin
const MARGIN_V  = 21;   // top/bottom page margin
const GAP_H     = PAGE_W - 2 * MARGIN_H - COLS * BADGE_W; // 85pt gap between cols (no center gap used, split evenly)
const GAP_V     = (PAGE_H - 2 * MARGIN_V - ROWS * BADGE_H) / (ROWS - 1); // ~22pt

// ─── Font registration ────────────────────────────────────────────────────────

/**
 * Register NotoSans fonts if available, otherwise return Helvetica names.
 */
function setupFonts(doc) {
  const hasRegular = fs.existsSync(FONT_REGULAR);
  const hasBold    = fs.existsSync(FONT_BOLD);
  const hasHebReg  = fs.existsSync(FONT_HEB_REGULAR);
  const hasHebBold = fs.existsSync(FONT_HEB_BOLD);

  if (hasRegular) doc.registerFont('Regular',     FONT_REGULAR);
  if (hasBold)    doc.registerFont('Bold',        FONT_BOLD);
  if (hasHebReg)  doc.registerFont('HebrewReg',   FONT_HEB_REGULAR);
  if (hasHebBold) doc.registerFont('HebrewBold',  FONT_HEB_BOLD);

  return {
    regular:  hasRegular ? 'Regular'    : 'Helvetica',
    bold:     hasBold    ? 'Bold'       : 'Helvetica-Bold',
    hebReg:   hasHebReg  ? 'HebrewReg'  : (hasRegular ? 'Regular' : 'Helvetica'),
    hebBold:  hasHebBold ? 'HebrewBold' : (hasBold    ? 'Bold'    : 'Helvetica-Bold'),
  };
}

// ─── Guest List PDF ───────────────────────────────────────────────────────────

/**
 * Write guest list PDF to the response stream.
 * @param {import('express').Response} res
 * @param {Array} guests
 * @param {string} date  - DD/MM format
 */
function generateGuestList(res, guests, date) {
  const paidCount = guests.filter(g => g.paid).length;
  const label = `Встреча: ${date} | Всего: ${guests.length} | Оплатили: ${paidCount}`;

  // A4 landscape: 841 × 595 pt
  const LS_W = 841;
  const LS_H = 595;
  const MARGIN = 30;

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="guests-${date.replace('/', '-')}.pdf"`);
  doc.pipe(res);

  const F = setupFonts(doc);

  const ROW_HEIGHT = 22;

  const COLS = [
    { key: 'num',       label: '#',         x: 30,  w: 20  },
    { key: 'name',      label: 'Имя',       x: 50,  w: 170 },
    { key: 'prof',      label: 'Профессия', x: 220, w: 210 },
    { key: 'phone',     label: 'Телефон',   x: 430, w: 110 },
    { key: 'invitedBy', label: 'Пригласил', x: 540, w: 130 },
    { key: 'paid',      label: '₪',         x: 670, w: 50  },
  ];
  const TL = COLS[0].x;
  const lastCol = COLS[COLS.length - 1];
  const TR = lastCol.x + lastCol.w;
  const TW = TR - TL;

  function isHebrew(text) {
    return /[\u0590-\u05FF]/.test(text || '');
  }

  function pickFont(str, bold) {
    return isHebrew(str)
      ? (bold ? F.hebBold : F.hebReg)
      : (bold ? F.bold    : F.regular);
  }

  function cell(text, col, y, bold, forceAlign) {
    const str = String(text || '');
    const align = forceAlign || (isHebrew(str) ? 'right' : 'left');
    doc.font(pickFont(str, bold)).fontSize(9).fillColor('#111111')
       .text(str, col.x, y, { width: col.w, height: ROW_HEIGHT, lineBreak: false, ellipsis: true, align });
  }

  // ── Page header ──
  doc.font(F.bold).fontSize(18).fillColor('#C41230')
     .text('BNI SYNERGY', TL, 22, { width: TW, align: 'center', lineBreak: false });
  doc.font(F.regular).fontSize(11).fillColor('#333333')
     .text(label, TL, 46, { width: TW, align: 'center', lineBreak: false });

  // ── Column headers ──
  const HDR_Y = 70;
  doc.font(F.bold).fontSize(9).fillColor('#333333');
  COLS.forEach(col => {
    const align = col.key === 'paid' ? 'center' : 'left';
    doc.text(col.label, col.x, HDR_Y, { width: col.w, lineBreak: false, align });
  });

  const HDR_LINE = HDR_Y + 14;
  doc.moveTo(TL, HDR_LINE).lineTo(TR, HDR_LINE).strokeColor('#333333').lineWidth(0.8).stroke();

  // ── Data rows ──
  let ry = HDR_LINE + 4;

  guests.forEach((g, i) => {
    if (ry + ROW_HEIGHT > LS_H - MARGIN) {
      doc.addPage();
      ry = MARGIN;
    }

    cell(i + 1,               COLS[0], ry, false);
    cell(g.name,              COLS[1], ry, false);
    cell(g.specialty || '—',  COLS[2], ry, false);
    cell(g.phone,             COLS[3], ry, false);
    cell(g.invitedBy || '—',  COLS[4], ry, false);
    cell(g.paid ? '✓' : '✗', COLS[5], ry, false, 'center');

    ry += ROW_HEIGHT;
    doc.moveTo(TL, ry - 2).lineTo(TR, ry - 2).strokeColor('#e5e7eb').lineWidth(0.4).stroke();
  });

  // ── Footer on every page ──
  const pageCount = doc.bufferedPageRange().count;
  for (let p = 0; p < pageCount; p++) {
    doc.switchToPage(p);
    doc.font(F.regular).fontSize(8).fillColor('#999999')
       .text(
         `Распечатано: ${new Date().toLocaleString('ru-RU')} | Стр. ${p + 1} из ${pageCount}`,
         TL, LS_H - MARGIN + 8, { width: TW, align: 'left' },
       );
  }

  doc.end();
}

// ─── Badges PDF ───────────────────────────────────────────────────────────────

/**
 * Write badges PDF (2 cols × 5 rows per A4 page) to the response stream.
 */
function generateBadges(res, guests, date) {
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="badges-${date.replace('/', '-')}.pdf"`);
  doc.pipe(res);

  const F = setupFonts(doc);

  // Column x positions: two columns, gap fills the remaining space
  const colX = [
    MARGIN_H,
    MARGIN_H + BADGE_W + (PAGE_W - 2 * MARGIN_H - 2 * BADGE_W),
  ];
  const rowY = Array.from({ length: ROWS }, (_, i) => MARGIN_V + i * (BADGE_H + GAP_V));
  const perPage = COLS * ROWS; // 10

  guests.forEach((g, idx) => {
    if (idx > 0 && idx % perPage === 0) doc.addPage();

    const pos  = idx % perPage;
    const col  = pos % COLS;
    const row  = Math.floor(pos / COLS);
    const x    = colX[col];
    const y    = rowY[row];

    // ── Border ──
    doc.rect(x, y, BADGE_W, BADGE_H)
       .strokeColor('#cccccc').lineWidth(0.5).stroke();

    // ── BNI red header bar ──
    const BAR_H = 22;
    doc.rect(x, y, BADGE_W, BAR_H).fillColor('#C41230').fill();

    doc.font(F.bold).fontSize(8).fillColor('#FFFFFF')
       .text('BNI SYNERGY', x, y + 8, { width: BADGE_W, align: 'center', lineBreak: false });

    // ── Full name (large, centred) ──
    const fullName = g.name || '';
    doc.font(F.bold).fontSize(18).fillColor('#000000')
       .text(fullName, x + 8, y + 36, { width: BADGE_W - 16, align: 'center', lineBreak: false });

    // ── Profession ──
    doc.font(F.regular).fontSize(11).fillColor('#333333')
       .text(g.specialty || '', x + 8, y + 72, { width: BADGE_W - 16, align: 'center', lineBreak: false });

    // ── Invited by (bottom, small) ──
    if (g.invitedBy) {
      doc.font(F.regular).fontSize(7).fillColor('#888888')
         .text(`Приглашён: ${g.invitedBy}`, x + 8, y + BADGE_H - 18, {
           width: BADGE_W - 16, align: 'center', lineBreak: false,
         });
    }

    // ── Meeting date (bottom-right) ──
    doc.font(F.regular).fontSize(7).fillColor('#888888')
       .text(date, x + BADGE_W - 38, y + BADGE_H - 18, {
         width: 30, align: 'right', lineBreak: false,
       });
  });

  doc.end();
}

// ─── Members Catalog PDF ──────────────────────────────────────────────────────

const PLATFORM_ABBR = {
  whatsapp:  'WA',
  instagram: 'IG',
  facebook:  'FB',
  tiktok:    'TK',
  telegram:  'TG',
  linkedin:  'LI',
  youtube:   'YT',
  website:   'WEB',
  other:     'LNK',
};

const PLATFORM_COLOR = {
  whatsapp:  '#25D366',
  instagram: '#e1306c',
  facebook:  '#1877f2',
  tiktok:    '#010101',
  telegram:  '#0088cc',
  linkedin:  '#0077b5',
  youtube:   '#ff0000',
  website:   '#16a34a',
  other:     '#6b7280',
};

function memberInitials(name) {
  const parts = (name || '').trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : (parts[0]?.[0] || '?').toUpperCase();
}

/**
 * Generate members catalog PDF matching the reference design (Члены BNI.pdf).
 * Layout: 1 card per row × 3 per page.
 * Card top  (red, ~58%): circular photo left + name centered + divider + professions RU/HE
 * Card bottom (white, ~42%): social items — colored circle icon + label text
 */
function generateMembersCatalog(res, members, uploadsDir) {
  const RED    = '#C41230';
  const PW     = 595;
  const PH     = 842;
  const MX     = 28;   // left/right margin
  const MY     = 20;   // top margin
  const HDR_H  = 32;   // page header height (larger, more prominent)
  const HDR_G  = 6;    // gap header → first card
  const PER_PG = 3;    // cards per page
  const CGAP   = 10;   // vertical gap between cards
  const CARD_W = PW - 2 * MX;              // 539
  const CARD_H = 240;
  const RED_H  = Math.round(CARD_H * 0.58);// 139 — red section height
  const PHR    = 55;   // photo radius (bigger, nearly fills red section height)
  const PHCX   = 68;   // photo center x from card left
  const PHCY   = RED_H / 2 + 2; // photo center y (slightly below center)
  const TX     = 132;  // text area start x (right of photo + gap)
  const TW     = CARD_W - TX - 14; // text area width (393)

  const doc = new PDFDocument({ margin: 0, size: 'A4', bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="members-catalog.pdf"');
  doc.pipe(res);

  const F = setupFonts(doc);

  // ─── Page header: "Члены группы"  |  BNI SYNERGY ─────────────────────────
  function drawPageHeader() {
    const hy = MY + 4;
    doc.font(F.bold).fontSize(22).fillColor('#111111')
       .text('Члены группы', MX, hy, { lineBreak: false });
    doc.font(F.bold).fontSize(22).fillColor(RED)
       .text('BNI SYNERGY', MX, hy, { width: CARD_W, align: 'right', lineBreak: false });
    // Thin underline
    doc.moveTo(MX, MY + 30).lineTo(MX + CARD_W, MY + 30)
       .strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  }

  // Display text for a social entry: stored label or URL-extracted handle
  function socialText(s) {
    if (s.label) return s.label;
    try {
      const u = new URL(s.url);
      const parts = u.pathname.split('/').filter(Boolean);
      return parts.length ? '@' + parts[parts.length - 1] : u.hostname.replace('www.', '');
    } catch { return s.url.slice(0, 26); }
  }

  drawPageHeader();

  members.forEach((m, idx) => {
    const pos = idx % PER_PG;
    if (idx > 0 && pos === 0) {
      doc.addPage();
      drawPageHeader();
    }

    const cardX = MX;
    const cardY = MY + HDR_H + HDR_G + pos * (CARD_H + CGAP);

    // ── Card background + subtle border ──
    doc.roundedRect(cardX, cardY, CARD_W, CARD_H, 10)
       .fillAndStroke('#ffffff', '#d1d5db');

    // ── Red top section (clip to rounded top) ──
    doc.save()
       .roundedRect(cardX, cardY, CARD_W, RED_H + 10, 10).clip()
       .rect(cardX, cardY, CARD_W, RED_H).fill(RED)
       .restore();

    // ── Photo: white ring + clipped photo circle ──
    const photoCx = cardX + PHCX;
    const photoCy = cardY + PHCY;
    doc.circle(photoCx, photoCy, PHR + 4).fill('#ffffff');

    const photoFile = m.photo ? path.join(uploadsDir, m.photo) : null;
    const hasPhoto  = photoFile && fs.existsSync(photoFile);
    doc.save().circle(photoCx, photoCy, PHR).clip();
    if (hasPhoto) {
      try {
        doc.image(photoFile, photoCx - PHR, photoCy - PHR, {
          width: PHR * 2, height: PHR * 2, cover: [PHR * 2, PHR * 2],
        });
      } catch { drawInitialsCircle(doc, F, photoCx, photoCy, PHR, m.name); }
    } else {
      drawInitialsCircle(doc, F, photoCx, photoCy, PHR, m.name);
    }
    doc.restore();

    // ── Text in red section ──
    const tx = cardX + TX;
    let   ty = cardY + 14;

    // Name — centered in text area
    doc.font(F.bold).fontSize(18).fillColor('#ffffff')
       .text(m.name || '', tx, ty, { width: TW, align: 'center', lineBreak: false, ellipsis: true });
    ty += 24;

    // Thin white divider line
    doc.moveTo(tx + 20, ty).lineTo(tx + TW - 20, ty)
       .strokeColor('#ffffff').lineWidth(0.6).stroke();
    ty += 8;

    // Professions: RU left-aligned, HE right-aligned
    // Blended white on red: 85% ≈ #f5d8de
    const profRu = (m.profession    || '').trim();
    const profHe = (m.profession_he || '').trim();
    if (profRu || profHe) {
      if (profRu && profHe) {
        const hw = Math.floor(TW / 2) - 4;
        doc.font(F.bold).fontSize(10).fillColor('#f5d8de')
           .text(profRu, tx, ty, { width: hw, lineBreak: false, ellipsis: true });
        doc.font(F.hebBold).fontSize(10).fillColor('#f5d8de')
           .text(profHe, tx + hw + 8, ty, { width: hw, align: 'right', lineBreak: false, ellipsis: true });
      } else if (profHe) {
        doc.font(F.hebBold).fontSize(10).fillColor('#f5d8de')
           .text(profHe, tx, ty, { width: TW, align: 'right', lineBreak: false, ellipsis: true });
      } else {
        doc.font(F.bold).fontSize(10).fillColor('#f5d8de')
           .text(profRu, tx, ty, { width: TW, align: 'center', lineBreak: false, ellipsis: true });
      }
    }

    // ── White section: social items (circle icon + label text) ──
    if (m.socials && m.socials.length) {
      const wsX   = cardX + 14;
      const wEnd  = cardX + CARD_W - 14;
      let   bx    = wsX;
      let   by    = cardY + RED_H + 7;
      const CD    = 22;   // circle icon diameter
      const SGAP  = 8;    // gap between items
      const ROW_H = CD + 6;
      const MAX_Y = cardY + CARD_H - 5;

      for (const s of m.socials) {
        const abbr  = (PLATFORM_ABBR[s.platform] || s.platform.slice(0, 3).toUpperCase()).replace('🔗', 'LNK');
        const color = PLATFORM_COLOR[s.platform] || '#6b7280';
        const label = socialText(s);

        // Estimate text width (9pt ≈ 5pt per char avg)
        const labelW = Math.min(label.length * 5.0 + 4, 130);
        const itemW  = CD + 5 + labelW;

        if (bx + itemW > wEnd) {
          bx  = wsX;
          by += ROW_H;
          if (by + CD > MAX_Y) break;
        }

        // Colored circle icon
        doc.circle(bx + CD / 2, by + CD / 2, CD / 2).fill(color);
        doc.font(F.bold).fontSize(6.5).fillColor('#ffffff')
           .text(abbr, bx, by + (CD - 8) / 2, { width: CD, align: 'center', lineBreak: false });

        // Label text
        doc.font(F.bold).fontSize(9).fillColor('#1f2937')
           .text(label, bx + CD + 5, by + (CD - 9) / 2, {
             width: labelW, lineBreak: false, ellipsis: true,
           });

        bx += itemW + SGAP;
      }
    }
  });

  // ── Footer on each page ──
  const pageCount = doc.bufferedPageRange().count;
  for (let p = 0; p < pageCount; p++) {
    doc.switchToPage(p);
    doc.font(F.regular).fontSize(7).fillColor('#9ca3af')
       .text(
         `BNI SYNERGY — Каталог участников | ${new Date().toLocaleDateString('ru-RU')} | Стр. ${p + 1} из ${pageCount}`,
         MX, PH - 16, { width: CARD_W, align: 'center' },
       );
  }

  doc.end();
}

function drawInitialsCircle(doc, F, cx, cy, r, name) {
  doc.circle(cx, cy, r).fill('#d1d5db');
  const initials = memberInitials(name);
  doc.font(F.bold).fontSize(Math.round(r * 0.55)).fillColor('#6b7280')
     .text(initials, cx - r, cy - r * 0.35, { width: r * 2, align: 'center', lineBreak: false });
}

module.exports = { generateGuestList, generateBadges, generateMembersCatalog };
