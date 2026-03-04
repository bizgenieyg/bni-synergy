'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');

const db       = require('./services/db');
const sheets   = require('./services/sheets');
const whatsapp = require('./services/whatsapp');
const pdf      = require('./services/pdf');

const app  = express();
const PORT = process.env.PORT || 3000;

const NEXT_MEETING_DATE = process.env.NEXT_MEETING_DATE || '';
const PAYBOX_LINK       = 'https://links.payboxapp.com/2vFKGJA1VVb';
const WAZE_LINK         = 'https://waze.com/ul/hsv8tzcptn';
const WAZE_ADDRESS      = 'סמילנסקי 43 ראשון לציון';

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // PayBox sends form-encoded

// ─── HTML pages ───────────────────────────────────────────────────────────────

app.get('/guest', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'guest.html')));

app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// Static assets (CSS, JS, images)
app.use(express.static(path.join(__dirname, 'public')));

// ─── Health / test ────────────────────────────────────────────────────────────

app.get('/api/test', (req, res) => {
  res.json({
    status:      'ok',
    nextMeeting: NEXT_MEETING_DATE,
    totalGuests: db.getTotalCount(),
  });
});

// ─── Guest registration ───────────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  const { firstName, lastName, phone, specialty, invitedBy } = req.body;

  if (!firstName || !lastName || !phone) {
    return res.status(400).json({ error: 'Имя, фамилия и телефон обязательны' });
  }
  if (specialty && specialty.length > 50) {
    return res.status(400).json({ error: 'Профессия не может быть длиннее 50 символов' });
  }

  const meetingDate = NEXT_MEETING_DATE;

  // 1. Save to SQLite
  const id = db.insertGuest({ firstName, lastName, phone, specialty, invitedBy, meetingDate });

  // 2. Google Sheets — non-blocking, store row for later paid update
  sheets.appendGuest({ firstName, lastName, phone, specialty, invitedBy, meetingDate })
    .then(sheetRow => {
      if (sheetRow) db.updateSheetRow(id, sheetRow);
    })
    .catch(err => console.error('[Sheets] appendGuest failed:', err.message));

  // 3. WhatsApp confirmation
  const waText =
    `Шалом, ${firstName}! 👋\n\n` +
    `Вы зарегистрированы на встречу BNI SYNERGY 🤝\n` +
    `📅 ${meetingDate} в 7:30\n` +
    `📍 ${WAZE_ADDRESS}\n\n` +
    `💳 Оплата участия (80₪):\n${PAYBOX_LINK}\n\n` +
    `🗺️ Навигатор:\n${WAZE_LINK}\n\n` +
    `До встречи! 🙌`;

  whatsapp.sendMessage(phone, waText)
    .then(() => db.markWaSent(id))
    .catch(err => console.error('[WhatsApp] sendMessage failed:', err.message));

  // 4. Return success immediately
  return res.json({ success: true, id, firstName });
});

// ─── PayBox webhook ───────────────────────────────────────────────────────────

app.post('/api/paybox-webhook', async (req, res) => {
  // PayBox may send GET params and/or POST body (form-encoded or JSON)
  const data   = { ...req.query, ...req.body };
  console.log('[PayBox] Webhook:', JSON.stringify(data));

  const rawPhone = data.pg_user_phone || data.phone || data.user_phone || '';
  const result   = String(data.pg_result ?? data.result ?? '');
  const isPaid   = result === '1' || result.toLowerCase() === 'success';

  if (isPaid && rawPhone) {
    const guest = db.findGuestByPhone(rawPhone);
    if (guest && !guest.paid) {
      db.markPaid(guest.id);
      console.log(`[PayBox] Marked paid: ${guest.firstName} ${guest.lastName} (${guest.phone})`);

      // Update Google Sheets column B
      if (guest.sheetRow) {
        sheets.markPaid(guest.meetingDate, guest.sheetRow)
          .catch(err => console.error('[Sheets] markPaid failed:', err.message));
      }
    } else if (!guest) {
      console.warn(`[PayBox] No guest found for phone "${rawPhone}"`);
    }
  }

  // PayBox expects XML
  res.set('Content-Type', 'text/xml; charset=utf-8');
  res.send('<?xml version="1.0" encoding="utf-8"?><response><result>ok</result></response>');
});

// PayBox sometimes sends GET callbacks too
app.get('/api/paybox-webhook', (req, res) => {
  res.set('Content-Type', 'text/xml; charset=utf-8');
  res.send('<?xml version="1.0" encoding="utf-8"?><response><result>ok</result></response>');
});

// ─── Admin API ────────────────────────────────────────────────────────────────

app.get('/api/guests', (req, res) => {
  const { date } = req.query;
  const guests = date ? db.getGuestsByDate(date) : db.getAllGuests();
  res.json(guests);
});

app.get('/api/meetings', (req, res) => {
  res.json(db.getMeetingDates());
});

app.put('/api/guests/:id/paid', async (req, res) => {
  const guest = db.getGuestById(req.params.id);
  if (!guest) return res.status(404).json({ error: 'Гость не найден' });

  db.markPaid(guest.id);

  if (guest.sheetRow) {
    sheets.markPaid(guest.meetingDate, guest.sheetRow)
      .catch(err => console.error('[Sheets] markPaid failed:', err.message));
  }

  res.json({ success: true });
});

// ─── PDF endpoints ────────────────────────────────────────────────────────────

app.get('/api/pdf/list', (req, res) => {
  const date   = req.query.date || NEXT_MEETING_DATE;
  const guests = db.getGuestsByDate(date);
  pdf.generateGuestList(res, guests, date);
});

app.get('/api/pdf/badges', (req, res) => {
  const date   = req.query.date || NEXT_MEETING_DATE;
  const guests = db.getGuestsByDate(date);
  pdf.generateBadges(res, guests, date);
});

// ─── Broadcasts ───────────────────────────────────────────────────────────────

app.post('/api/send-voting', async (req, res) => {
  const { date, votingLink } = req.body;
  if (!date || !votingLink) {
    return res.status(400).json({ error: 'date и votingLink обязательны' });
  }

  const guests = db.getGuestsByDate(date);
  if (!guests.length) {
    return res.json({ success: true, total: 0, message: 'Нет гостей для рассылки' });
  }

  // Respond immediately, send in background
  res.json({ success: true, total: guests.length, message: 'Рассылка запущена' });

  whatsapp.broadcast(guests, g =>
    `${g.firstName}, спасибо что пришли на встречу BNI SYNERGY! 🙏\n` +
    `Проголосуйте пожалуйста:\n${votingLink}`
  ).catch(err => console.error('[Broadcast] send-voting error:', err.message));
});

app.post('/api/send-contacts', async (req, res) => {
  const { date, contactsText } = req.body;
  if (!date || !contactsText) {
    return res.status(400).json({ error: 'date и contactsText обязательны' });
  }

  const guests = db.getGuestsByDate(date);
  if (!guests.length) {
    return res.json({ success: true, total: 0, message: 'Нет гостей для рассылки' });
  }

  res.json({ success: true, total: guests.length, message: 'Рассылка запущена' });

  whatsapp.broadcast(guests, g =>
    `${g.firstName}, вот контакты членов группы BNI SYNERGY:\n\n` +
    `${contactsText}\n\n` +
    `Будем рады видеть вас снова! 🤝`
  ).catch(err => console.error('[Broadcast] send-contacts error:', err.message));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🟢 BNI SYNERGY server running on http://localhost:${PORT}`);
  console.log(`   Guest form  : http://localhost:${PORT}/guest`);
  console.log(`   Admin panel : http://localhost:${PORT}/admin`);
  console.log(`   Test API    : http://localhost:${PORT}/api/test`);
  console.log(`   Next meeting: ${NEXT_MEETING_DATE || '(not set)'}\n`);
});
