'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');

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

// ─── Multer (photo uploads) ───────────────────────────────────────────────────

const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename:    (req, file, cb) => {
      const ext = file.mimetype === 'image/png' ? '.png' : '.jpg';
      cb(null, `member_${req.params.id}${ext}`);
    },
  }),
  limits:     { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

// ─── Message variants (anti-spam) ─────────────────────────────────────────────

function pickVariant(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const VOTING_VARIANTS = [
  (name, link) => `${name}, спасибо что были на встрече BNI SYNERGY! 🙏\nПроголосуйте пожалуйста:\n${link}`,
  (name, link) => `Шалом, ${name}! 👋 Ваш голос важен — голосование BNI открыто:\n${link}`,
  (name, link) => `${name}, встреча прошла отлично! 🎯 Ваш голос решает:\n${link}`,
  (name, link) => `Привет, ${name}! Поддержите лучшего участника BNI SYNERGY 🏆\n${link}`,
  (name, link) => `${name}, один клик — ваш голос засчитан ✅\nГолосование:\n${link}`,
  (name, link) => `Дорогой(ая) ${name}, голосование BNI SYNERGY ждёт вас! 🗳️\n${link}`,
  (name, link) => `${name}, спасибо за визит! Выберите лучшего участника BNI 🌟\n${link}`,
];

const CONTACTS_VARIANTS = [
  (name, contacts) => `${name}, вот контакты членов группы BNI SYNERGY:\n\n${contacts}\n\nБудем рады видеть вас снова! 🤝`,
  (name, contacts) => `Шалом, ${name}! 👋 Контакты наших специалистов BNI:\n\n${contacts}`,
  (name, contacts) => `${name}, спасибо за визит в BNI SYNERGY! 🙌\nПолезные контакты:\n\n${contacts}`,
  (name, contacts) => `Привет, ${name}! Держите контакты группы BNI 📇\n\n${contacts}`,
  (name, contacts) => `${name}, рады были познакомиться! Контакты BNI:\n\n${contacts}`,
];

// ─── Middleware ───────────────────────────────────────────────────────────────

app.set('trust proxy', 1); // trust Nginx X-Forwarded-For
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Admin auth ───────────────────────────────────────────────────────────────

const crypto = require('crypto');
const ADMIN_TOKENS = new Set(); // in-memory token store

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bni2024';
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  ADMIN_TOKENS.add(token);
  res.json({ token });
});

function adminAuth(req, res, next) {
  // Allow unauthenticated access in dev / if no password set
  if (!process.env.ADMIN_PASSWORD) return next();
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!ADMIN_TOKENS.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ─── HTML pages ───────────────────────────────────────────────────────────────

app.get('/guest',           (req, res) => res.sendFile(path.join(__dirname, 'public', 'guest.html')));
app.get('/admin',           (req, res) => {
  // Serve React SPA if built, otherwise fall back to admin.html
  const spa = path.join(__dirname, 'public', 'dist', 'index.html');
  if (fs.existsSync(spa)) return res.sendFile(spa);
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/member',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'member.html')));
app.get('/voting',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'voting.html')));
app.get('/profile',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/members-catalog', (req, res) => res.sendFile(path.join(__dirname, 'public', 'members-catalog.html')));
app.get('/presentations',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'presentations.html')));

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

app.get('/api/members/count', (req, res) => {
  res.json({ count: db.getActiveMembers().length });
});

app.get('/api/members/:id', (req, res) => {
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Член не найден' });
  res.json(member);
});

app.get('/api/members/:id/photo', (req, res) => {
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Член не найден' });
  res.json({ url: member.photo ? `/uploads/${member.photo}` : null });
});

app.post('/api/members/:id/photo', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Член не найден' });

  // Delete old photo file if filename changed
  if (member.photo && member.photo !== req.file.filename) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, member.photo)); } catch {}
  }

  db.updateMemberPhoto(member.id, req.file.filename);
  res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

app.patch('/api/members/:id/profile', (req, res) => {
  const member = db.updateMemberProfile(Number(req.params.id), req.body);
  if (!member) return res.status(404).json({ error: 'Член не найден' });
  res.json({ success: true, member });
});

app.patch('/api/members/:id/activate', (req, res) => {
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Член не найден' });
  db.setMemberActive(member.id, 1);
  res.json({ success: true });
});

app.get('/api/members/:id/socials', (req, res) => {
  const socials = db.getMemberSocials(Number(req.params.id));
  res.json(socials);
});

app.put('/api/members/:id/socials', (req, res) => {
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Член не найден' });
  const { socials } = req.body;
  if (!Array.isArray(socials)) return res.status(400).json({ error: 'socials должен быть массивом' });
  db.setMemberSocials(member.id, socials.filter(s => s.platform && s.url));
  res.json({ success: true });
});

app.get('/api/guests/active-count', (req, res) => {
  const count = NEXT_MEETING_DATE ? db.getGuestsByDate(NEXT_MEETING_DATE).length : 0;
  res.json({ count, date: NEXT_MEETING_DATE });
});

app.get('/api/guests/stats', (req, res) => {
  const dates = db.getMeetingDates().slice(0, 8).reverse();
  const stats  = dates.map(d => {
    const guests = db.getGuestsByDate(d);
    return { date: d, total: guests.length, paid: guests.filter(g => g.paid).length };
  });
  res.json(stats);
});

// ─── Public catalog ───────────────────────────────────────────────────────────

app.get('/api/catalog', (req, res) => {
  const members = db.getActiveMembers();
  const result  = members.map(m => ({ ...m, socials: db.getMemberSocials(m.id) }));
  res.json(result);
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

app.get('/api/pdf/members', (req, res) => {
  const members = db.getActiveMembers().map(m => ({ ...m, socials: db.getMemberSocials(m.id) }));
  pdf.generateMembersCatalog(res, members, UPLOADS_DIR);
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
  const { candidateId, candidateName } = req.body;
  if (!candidateId || !candidateName) {
    return res.status(400).json({ error: 'Выберите участника' });
  }

  if (db.getSetting('voting_open') !== '1') {
    return res.status(403).json({ error: 'voting_closed' });
  }

  const meetingDate = NEXT_MEETING_DATE;
  db.insertAnonymousVote({ meetingDate, candidateId: Number(candidateId), candidateName });

  // Auto-close when all expected voters have voted
  const voteCount = db.getVoteCount(meetingDate);
  const expected  = db.getActiveMembers().length + db.getGuestsByDate(meetingDate).filter(g => g.wa_enabled !== 0).length;
  if (expected > 0 && voteCount >= expected) {
    db.setSetting('voting_open', '0');
  }

  res.json({ success: true });
});

app.get('/api/voting/results', (req, res) => {
  const date = req.query.date || NEXT_MEETING_DATE;
  res.json(db.getVoteResults(date));
});

app.get('/api/voting/status', (req, res) => {
  const meetingDate = NEXT_MEETING_DATE;
  const open        = db.getSetting('voting_open') === '1';
  const voteCount   = db.getVoteCount(meetingDate);
  const expected    = db.getActiveMembers().length + db.getGuestsByDate(meetingDate).filter(g => g.wa_enabled !== 0).length;
  res.json({ open, voteCount, expected, meetingDate });
});

app.post('/api/voting/open', (req, res) => {
  const meetingDate = NEXT_MEETING_DATE;
  db.setSetting('voting_open', '1');
  db.deleteVotesByDate(meetingDate);
  res.json({ success: true });

  const groupId = process.env.WAHA_GROUP_ID || '';
  if (groupId) {
    whatsapp.sendGroupMessage(groupId,
      `🗳 *Голосование открыто!*\nПроголосуйте за лучшего члена встречи:\nhttps://bnisynergy.biz/voting`
    ).catch(err => console.error('[Voting/open] group notify failed:', err.message));
  }
});

app.get('/api/voting/winners', (req, res) => {
  const dates = db.getMeetingDates();
  const all   = NEXT_MEETING_DATE
    ? [NEXT_MEETING_DATE, ...dates.filter(d => d !== NEXT_MEETING_DATE)]
    : dates;
  for (const d of all) {
    const results = db.getVoteResults(d);
    if (results.length > 0) return res.json({ date: d, winners: results.slice(0, 3) });
  }
  res.json({ date: null, winners: [] });
});

app.post('/api/voting/close', (req, res) => {
  db.setSetting('voting_open', '0');
  res.json({ success: true });
});

app.post('/api/voting/reset', (req, res) => {
  db.deleteVotesByDate(NEXT_MEETING_DATE);
  res.json({ success: true });
});

// ─── Broadcasts ───────────────────────────────────────────────────────────────

app.post('/api/send-voting', async (req, res) => {
  const { date, votingLink } = req.body;
  if (!date || !votingLink) {
    return res.status(400).json({ error: 'date и votingLink обязательны' });
  }

  const guests  = db.getGuestsByDate(date).filter(g => g.wa_enabled === 1);
  const groupId = process.env.WAHA_GROUP_ID || '';

  res.json({ success: true, total: guests.length, groupSent: !!groupId, message: 'Рассылка запущена' });

  // Individual messages to guests (random variant per message)
  whatsapp.broadcast(guests, g =>
    pickVariant(VOTING_VARIANTS)(g.firstName, votingLink)
  ).catch(err => console.error('[Broadcast] send-voting guests error:', err.message));
});

app.post('/api/send-contacts', async (req, res) => {
  const { date, contactsText } = req.body;
  if (!date || !contactsText) {
    return res.status(400).json({ error: 'date и contactsText обязательны' });
  }

  const guests = db.getGuestsByDate(date).filter(g => g.wa_enabled !== 0);
  res.json({ success: true, total: guests.length, message: 'Рассылка запущена' });

  whatsapp.broadcast(guests, g =>
    pickVariant(CONTACTS_VARIANTS)(g.firstName, contactsText)
  ).catch(err => console.error('[Broadcast] send-contacts error:', err.message));
});

// ─── Presentations ────────────────────────────────────────────────────────────

app.get('/api/presentations', (req, res) => {
  const { date } = req.query;
  res.json(db.getPresentations(date || null));
});

app.post('/api/presentations', (req, res) => {
  const { meeting_date, member_name, change_description, notes } = req.body;
  if (!meeting_date || !member_name || !change_description) {
    return res.status(400).json({ error: 'Заполните обязательные поля' });
  }
  const id = db.insertPresentation({ meeting_date, member_name, change_description, notes });
  res.json({ success: true, id });
});

app.put('/api/presentations/:id', (req, res) => {
  const item = db.updatePresentation(Number(req.params.id), req.body);
  if (!item) return res.status(404).json({ error: 'Запись не найдена' });
  res.json({ success: true, item });
});

app.patch('/api/presentations/:id/toggle', (req, res) => {
  const next = db.togglePresentationStatus(Number(req.params.id));
  if (next === null) return res.status(404).json({ error: 'Запись не найдена' });
  res.json({ success: true, status: next });
});

app.delete('/api/presentations/:id', (req, res) => {
  db.deletePresentation(Number(req.params.id));
  res.json({ success: true });
});

// ─── Group Value ──────────────────────────────────────────────────────────────

// Must come before /api/group-value/:id to avoid route conflicts
app.get('/api/group-value/totals', (req, res) => {
  const period = req.query.period || 'all';
  const periodDays = { week: 7, month: 30, quarter: 90 };
  const days = periodDays[period];
  const t = days ? db.getGroupValueTotalsByPeriod(days) : db.getGroupValueTotals();
  res.json(t || { total_1on1: 0, total_referrals: 0, total_deals: 0, total_amount: 0 });
});

app.get('/api/group-value/summary', (req, res) => {
  res.json(db.getGroupValueSummary());
});

app.get('/api/group-value', (req, res) => {
  const { date } = req.query;
  res.json(db.getGroupValue(date || null));
});

app.post('/api/group-value', (req, res) => {
  const { meeting_date, member_id, member_name, meetings_1on1, referrals, closed_deals, deal_amount } = req.body;
  if (!meeting_date || !member_name) {
    return res.status(400).json({ error: 'meeting_date и member_name обязательны' });
  }
  const id = db.upsertGroupValue({
    meeting_date,
    member_id:     member_id || null,
    member_name,
    meetings_1on1: Number(meetings_1on1) || 0,
    referrals:     Number(referrals)     || 0,
    closed_deals:  Number(closed_deals)  || 0,
    deal_amount:   Number(deal_amount)   || 0,
  });
  res.json({ success: true, id });
});

app.put('/api/group-value/:id', (req, res) => {
  const item = db.updateGroupValue(Number(req.params.id), req.body);
  if (!item) return res.status(404).json({ error: 'Запись не найдена' });
  res.json({ success: true, item });
});

app.delete('/api/group-value/:id', (req, res) => {
  db.deleteGroupValue(Number(req.params.id));
  res.json({ success: true });
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
