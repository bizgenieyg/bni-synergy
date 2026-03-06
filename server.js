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

// NEXT_MEETING_DATE: DB value takes priority over .env
// If DB has nothing yet, seed it from .env so future edits persist in DB.
const _envDate = process.env.NEXT_MEETING_DATE || '';
if (db.getSetting('next_meeting_date') === null && _envDate) {
  db.setSetting('next_meeting_date', _envDate);
}
let NEXT_MEETING_DATE = db.getSetting('next_meeting_date') ?? _envDate;

const PAYBOX_LINK       = 'https://links.payboxapp.com/2vFKGJA1VVb';
const WAZE_LINK         = 'https://waze.com/ul/hsv8tzcptn';
const WAZE_ADDRESS      = 'סמילנסקי 43 ראשון לציון';

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── HTML pages ───────────────────────────────────────────────────────────────

app.get('/guest',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'guest.html')));
app.get('/admin',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/member', (req, res) => res.sendFile(path.join(__dirname, 'public', 'member.html')));
app.get('/voting', (req, res) => res.sendFile(path.join(__dirname, 'public', 'voting.html')));

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
  const { firstName, lastName, phone, specialty, invitedBy, type } = req.body;

  if (!firstName || !lastName || !phone) {
    return res.status(400).json({ error: 'Имя, фамилия и телефон обязательны' });
  }
  if (specialty && specialty.length > 50) {
    return res.status(400).json({ error: 'Профессия не может быть длиннее 50 символов' });
  }

  const meetingDate = NEXT_MEETING_DATE;
  const isSub       = type === 'sub';

  // 1. Save to SQLite — substitutions are pre-marked as paid
  const id = db.insertGuest({
    firstName, lastName, phone, specialty, invitedBy, meetingDate,
    paid:   isSub ? 1 : 0,
    paidAt: isSub ? new Date().toISOString() : null,
  });

  // 2. Google Sheets — non-blocking
  const paymentMethod = isSub ? `замена за ${invitedBy || '—'}` : 'онлайн';
  sheets.appendGuest({ firstName, lastName, phone, specialty, invitedBy, meetingDate, paymentMethod })
    .then(sheetRow => { if (sheetRow) db.updateSheetRow(id, sheetRow); })
    .catch(err => console.error('[Sheets] appendGuest failed:', err.message));

  // 3. WhatsApp — different message for substitutions
  let waText;
  if (isSub) {
    waText =
      `Шалом, ${firstName}! 👋\n\n` +
      `Вы зарегистрированы как замена на встречу BNI SYNERGY 🤝\n` +
      `📅 ${meetingDate} в 7:30\n` +
      `📍 ${WAZE_ADDRESS}\n\n` +
      `🗺️ Навигатор:\n${WAZE_LINK}\n\n` +
      `Спасибо, что поддерживаете группу! 🙌`;
  } else {
    waText =
      `Шалом, ${firstName}! 👋\n\n` +
      `Вы зарегистрированы на встречу BNI SYNERGY 🤝\n` +
      `📅 ${meetingDate} в 7:30\n` +
      `📍 ${WAZE_ADDRESS}\n\n` +
      `💳 Оплата участия (80₪):\n${PAYBOX_LINK}\n\n` +
      `🗺️ Навигатор:\n${WAZE_LINK}\n\n` +
      `До встречи! 🙌`;
  }

  whatsapp.sendMessage(phone, waText)
    .then(() => db.markWaSent(id))
    .catch(err => console.error('[WhatsApp] sendMessage failed:', err.message));

  return res.json({ success: true, id, firstName, isSub });
});

// ─── PayBox webhook ───────────────────────────────────────────────────────────

app.post('/api/paybox-webhook', async (req, res) => {
  const data = { ...req.query, ...req.body };
  console.log('[PayBox] Webhook:', JSON.stringify(data));

  const rawPhone = data.pg_user_phone || data.phone || data.user_phone || '';
  const result   = String(data.pg_result ?? data.result ?? '');
  const isPaid   = result === '1' || result.toLowerCase() === 'success';

  if (isPaid && rawPhone) {
    const guest = db.findGuestByPhone(rawPhone);
    if (guest && !guest.paid) {
      db.markPaid(guest.id);
      console.log(`[PayBox] Marked paid: ${guest.firstName} ${guest.lastName}`);
      if (guest.sheetRow) {
        sheets.markPaid(guest.meetingDate, guest.sheetRow)
          .catch(err => console.error('[Sheets] markPaid failed:', err.message));
      }
    } else if (!guest) {
      console.warn(`[PayBox] No guest found for phone "${rawPhone}"`);
    }
  }

  res.set('Content-Type', 'text/xml; charset=utf-8');
  res.send('<?xml version="1.0" encoding="utf-8"?><response><result>ok</result></response>');
});

app.get('/api/paybox-webhook', (req, res) => {
  res.set('Content-Type', 'text/xml; charset=utf-8');
  res.send('<?xml version="1.0" encoding="utf-8"?><response><result>ok</result></response>');
});

// ─── Guests API ───────────────────────────────────────────────────────────────

app.get('/api/guests', (req, res) => {
  const { date } = req.query;
  res.json(date ? db.getGuestsByDate(date) : db.getAllGuests());
});

app.get('/api/meetings', (req, res) => {
  const dates = db.getMeetingDates().filter(d => d !== NEXT_MEETING_DATE);
  const all   = NEXT_MEETING_DATE ? [NEXT_MEETING_DATE, ...dates] : dates;
  res.json(all);
});

app.put('/api/guests/:id/paid', (req, res) => {
  const guest = db.getGuestById(req.params.id);
  if (!guest) return res.status(404).json({ error: 'Гость не найден' });

  db.markPaid(guest.id);

  if (guest.sheetRow) {
    sheets.markPaid(guest.meetingDate, guest.sheetRow)
      .catch(err => console.error('[Sheets] markPaid failed:', err.message));
  }

  res.json({ success: true });
});

app.patch('/api/guests/:id/wa-toggle', (req, res) => {
  const next = db.toggleWaEnabled(req.params.id);
  if (next === null) return res.status(404).json({ error: 'Гость не найден' });
  res.json({ success: true, wa_enabled: next });
});

// ─── Members API ──────────────────────────────────────────────────────────────

app.get('/api/members', (req, res) => {
  const { active } = req.query;
  const members = active === 'true'
    ? db.getActiveMembers()
    : db.getAllMembers();
  res.json(members);
});

app.post('/api/members', (req, res) => {
  const { name, profession, phone, birthday } = req.body;
  if (!name) return res.status(400).json({ error: 'name обязателен' });
  try {
    const id = db.insertMember({ name, profession, phone, birthday });
    res.json({ success: true, id });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Член с таким именем уже существует' });
    }
    throw err;
  }
});

app.put('/api/members/:id', (req, res) => {
  const member = db.updateMember(Number(req.params.id), req.body);
  if (!member) return res.status(404).json({ error: 'Член не найден' });
  res.json({ success: true, member });
});

app.delete('/api/members/:id', (req, res) => {
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Член не найден' });
  db.setMemberActive(member.id, 0);
  res.json({ success: true });
});

app.patch('/api/members/:id/activate', (req, res) => {
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Член не найден' });
  db.setMemberActive(member.id, 1);
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

// ─── Settings ─────────────────────────────────────────────────────────────────

app.get('/api/settings/next-meeting', (req, res) => {
  res.json({ date: NEXT_MEETING_DATE });
});

app.patch('/api/settings/next-meeting', (req, res) => {
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date обязателен' });
  const trimmed = String(date).trim();
  db.setSetting('next_meeting_date', trimmed);
  NEXT_MEETING_DATE = trimmed;
  res.json({ success: true, date: NEXT_MEETING_DATE });
});

// ─── Birthdays ────────────────────────────────────────────────────────────────

app.get('/api/birthdays/upcoming', (req, res) => {
  const days    = Math.min(parseInt(req.query.days || '14', 10), 365);
  const today   = new Date();
  today.setHours(0, 0, 0, 0);

  const members = db.getActiveMembers();
  const result  = [];

  for (const member of members) {
    if (!member.birthday) continue;
    const parts = member.birthday.split('/');
    if (parts.length < 2) continue;
    const day   = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (isNaN(day) || isNaN(month)) continue;

    // Check this year, then next year (handles year-end wrap)
    for (const yearOffset of [0, 1]) {
      const bday = new Date(today.getFullYear() + yearOffset, month - 1, day);
      bday.setHours(0, 0, 0, 0);
      const diffDays = Math.round((bday - today) / 86_400_000);
      if (diffDays >= 0 && diffDays <= days) {
        result.push({ ...member, daysUntil: diffDays });
        break;
      }
    }
  }

  result.sort((a, b) => a.daysUntil - b.daysUntil);
  res.json(result);
});

app.post('/api/members/:id/wish-birthday', async (req, res) => {
  const member = db.getMemberById(Number(req.params.id));
  if (!member)        return res.status(404).json({ error: 'Член не найден' });
  if (!member.phone)  return res.status(400).json({ error: 'Нет номера телефона' });

  const msg =
    `🎂 С Днём рождения, ${member.name.split(' ')[0]}!\n\n` +
    `Вся группа BNI SYNERGY поздравляет вас с праздником! 🎉\n` +
    `Желаем процветания бизнесу и здоровья! 🥂`;

  try {
    await whatsapp.sendMessage(member.phone, msg);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Voting ───────────────────────────────────────────────────────────────────

app.post('/api/voting', (req, res) => {
  const { voterPhone, voterName, candidateId, candidateName } = req.body;
  if (!voterPhone || !voterName || !candidateId || !candidateName) {
    return res.status(400).json({ error: 'Все поля обязательны' });
  }

  const meetingDate = NEXT_MEETING_DATE;

  if (db.hasVoted(meetingDate, voterPhone)) {
    return res.json({ error: 'already_voted' });
  }

  db.insertVote({ meetingDate, voterPhone, voterName, candidateId: Number(candidateId), candidateName });
  res.json({ success: true });
});

app.get('/api/voting/results', (req, res) => {
  const date = req.query.date || NEXT_MEETING_DATE;
  res.json(db.getVoteResults(date));
});

// ─── Broadcasts ───────────────────────────────────────────────────────────────

app.post('/api/send-voting', async (req, res) => {
  const { date, votingLink } = req.body;
  if (!date || !votingLink) {
    return res.status(400).json({ error: 'date и votingLink обязательны' });
  }

  const guests  = db.getGuestsByDate(date).filter(g => g.wa_enabled !== 0);
  const members = db.getActiveMembers().filter(m => m.phone);

  // Deduplicate: skip members whose phone matches a guest already in the list
  const guestPhones = new Set(guests.map(g => db.normalizePhone(g.phone)));
  const uniqueMembers = members.filter(m => !guestPhones.has(db.normalizePhone(m.phone)));

  const total = guests.length + uniqueMembers.length;
  res.json({ success: true, total, message: 'Рассылка запущена' });

  const buildText = (r) =>
    `${r.firstName || r.name}, спасибо что пришли на встречу BNI SYNERGY! 🙏\n` +
    `Проголосуйте пожалуйста:\n${votingLink}`;

  Promise.all([
    whatsapp.broadcast(guests, buildText),
    whatsapp.broadcast(uniqueMembers.map(m => ({ ...m, firstName: m.name })), buildText),
  ]).catch(err => console.error('[Broadcast] send-voting error:', err.message));
});

app.post('/api/send-contacts', async (req, res) => {
  const { date, contactsText } = req.body;
  if (!date || !contactsText) {
    return res.status(400).json({ error: 'date и contactsText обязательны' });
  }

  const guests = db.getGuestsByDate(date).filter(g => g.wa_enabled !== 0);
  res.json({ success: true, total: guests.length, message: 'Рассылка запущена' });

  whatsapp.broadcast(guests, g =>
    `${g.firstName}, вот контакты членов группы BNI SYNERGY:\n\n` +
    `${contactsText}\n\n` +
    `Будем рады видеть вас снова! 🤝`
  ).catch(err => console.error('[Broadcast] send-contacts error:', err.message));
});

// ─── Birthday auto-congratulations ───────────────────────────────────────────

function checkBirthdays() {
  const today    = new Date();
  const todayStr = String(today.getDate()).padStart(2, '0') + '/' +
                   String(today.getMonth() + 1).padStart(2, '0');

  const members = db.getMembersBirthday(todayStr);

  for (const member of members) {
    if (!member.phone) continue;

    const yearPart = member.birthday.split('/')[2];
    // eslint-disable-next-line no-unused-vars
    const age = yearPart
      ? new Date().getFullYear() - parseInt('19' + yearPart.slice(-2), 10)
      : '';

    const msg =
      `🎂 С Днём рождения, ${member.name.split(' ')[0]}!\n\n` +
      `Вся группа BNI SYNERGY поздравляет вас с праздником! 🎉\n` +
      `Желаем процветания бизнесу и здоровья! 🥂`;

    whatsapp.sendMessage(member.phone, msg)
      .then(() => console.log(`[Birthday] Sent to ${member.name}`))
      .catch(err => console.error(`[Birthday] Failed for ${member.name}:`, err.message));
  }

  if (members.length) {
    console.log(`[Birthday] Checked ${todayStr}: ${members.length} birthday(s)`);
  }
}

setInterval(checkBirthdays, 24 * 60 * 60 * 1000);
checkBirthdays();

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🟢 BNI SYNERGY server running on http://localhost:${PORT}`);
  console.log(`   Guest form   : http://localhost:${PORT}/guest`);
  console.log(`   Member form  : http://localhost:${PORT}/member`);
  console.log(`   Voting       : http://localhost:${PORT}/voting`);
  console.log(`   Admin panel  : http://localhost:${PORT}/admin`);
  console.log(`   Test API     : http://localhost:${PORT}/api/test`);
  console.log(`   Next meeting : ${NEXT_MEETING_DATE || '(not set)'}\n`);
});
