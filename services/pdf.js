'use strict';

const path = require('path');
const fs   = require('fs');
const PDFDocument = require('pdfkit');

const FONTS_DIR    = path.join(__dirname, '..', 'fonts');
const FONT_REGULAR = path.join(FONTS_DIR, 'NotoSans-Regular.ttf');
const FONT_BOLD    = path.join(FONTS_DIR, 'NotoSans-Bold.ttf');

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

  if (hasRegular) doc.registerFont('Regular', FONT_REGULAR);
  if (hasBold)    doc.registerFont('Bold',    FONT_BOLD);

  return {
    regular: hasRegular ? 'Regular' : 'Helvetica',
    bold:    hasBold    ? 'Bold'    : 'Helvetica-Bold',
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
  const paid  = guests.filter(g => g.paid).length;
  const label = `Встреча: ${date} | Всего: ${guests.length} | Оплатили: ${paid}`;

  const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="guests-${date.replace('/', '-')}.pdf"`);
  doc.pipe(res);

  const F = setupFonts(doc);

  // ── Header ──
  doc.font(F.bold).fontSize(18).fillColor('#C41230')
     .text('BNI SYNERGY', { align: 'center' });
  doc.font(F.regular).fontSize(11).fillColor('#333333')
     .text(label, { align: 'center' });
  doc.moveDown(0.8);

  // ── Table ──
  const LEFT  = 40;
  const WIDTHS = { num: 28, name: 170, prof: 140, phone: 105, paid: 50 };

  function drawRow(num, name, prof, phone, paidMark, isHeader) {
    const font = isHeader ? F.bold : F.regular;
    const size = 9;
    const y    = doc.y;

    doc.font(font).fontSize(size).fillColor('#111111');
    doc.text(String(num),  LEFT,                                                    y, { width: WIDTHS.num,   lineBreak: false });
    doc.text(name,         LEFT + WIDTHS.num,                                       y, { width: WIDTHS.name,  lineBreak: false });
    doc.text(prof,         LEFT + WIDTHS.num + WIDTHS.name,                         y, { width: WIDTHS.prof,  lineBreak: false });
    doc.text(phone,        LEFT + WIDTHS.num + WIDTHS.name + WIDTHS.prof,           y, { width: WIDTHS.phone, lineBreak: false });
    doc.text(paidMark,     LEFT + WIDTHS.num + WIDTHS.name + WIDTHS.prof + WIDTHS.phone, y, { width: WIDTHS.paid,  lineBreak: false });

    doc.moveDown(0.15);

    if (!isHeader) {
      const lineY = doc.y;
      doc.moveTo(LEFT, lineY).lineTo(LEFT + 513, lineY)
         .strokeColor('#e5e7eb').lineWidth(0.4).stroke();
    }
  }

  // Header row
  drawRow('#', 'Имя и Фамилия', 'Профессия', 'Телефон', 'Оплата', true);
  const headerBottom = doc.y;
  doc.moveTo(LEFT, headerBottom).lineTo(LEFT + 513, headerBottom)
     .strokeColor('#333').lineWidth(0.8).stroke();
  doc.moveDown(0.3);

  // Data rows
  guests.forEach((g, i) => {
    // New page if close to bottom
    if (doc.y > PAGE_H - 60) {
      doc.addPage();
    }
    drawRow(i + 1, `${g.firstName} ${g.lastName}`, g.specialty || '—', g.phone, g.paid ? '✓' : '✗', false);
  });

  // ── Footer ──
  const pageCount = doc.bufferedPageRange().count;
  for (let p = 0; p < pageCount; p++) {
    doc.switchToPage(p);
    const footerY = PAGE_H - 25;
    doc.font(F.regular).fontSize(8).fillColor('#999999')
       .text(
         `Распечатано: ${new Date().toLocaleString('ru-RU')} | Стр. ${p + 1} из ${pageCount}`,
         LEFT, footerY, { align: 'left', width: 515 },
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
    const fullName = `${g.firstName} ${g.lastName}`;
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

module.exports = { generateGuestList, generateBadges };
