'use strict';

require('dotenv').config();

// Fail closed: the admin API must never run without a password.
if (!process.env.ADMIN_PASSWORD) {
  console.error('FATAL: ADMIN_PASSWORD is not set. Set it in .env and restart (the server will not start without it).');
  process.exit(1);
}

const express              = require('express');
const cors                 = require('cors');
const path                 = require('path');
const fs                   = require('fs');
const multer               = require('multer');
const cron                 = require('node-cron');

const db       = require('./services/db');
const sheets   = require('./services/sheets');
const whatsapp = require('./services/whatsapp');
const mailIntake = require('./services/mailIntake');
const { computeVisitCounts } = require('./services/visitCounts');
const pdf      = require('./services/pdf');
const authGuard = require('./services/authGuard');
const wahaSession = require('./services/wahaSession');
const groupsService = require('./services/groups');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Groups ───────────────────────────────────────────────────────────────────
// Group data lives in `groups`; admin routes work on req.groupId (group 1 unless ?group_id= is given),
// public routes find the group from the member's ref or ?group=<slug>. WhatsApp uses the group's WAHA session.

const groups = groupsService.createGroups(db, { log: m => console.warn(m) });
const GROUP1 = db.DEFAULT_GROUP;
const meetingDateFor = gid => groups.meetingDateFor(gid);
const waFor = gid => { const g = groups.getGroup(gid); return whatsapp.forSession(g && g.waha_session); };
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || 'https://bnisynergy.biz').replace(/\/$/, '');
const groupName = gid => (groups.getGroup(gid) || {}).name || 'BNI';
// Links that the system sends out always carry the group.
const groupLink = (gid, p, extra = '') => {
  const g = groups.getGroup(gid);
  return `${PUBLIC_BASE}${p}?${extra ? extra + '&' : ''}group=${encodeURIComponent(g ? g.slug : '')}`;
};
const WEEKDAYS_RU = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
// "<weekday>, <date> в <time>": the weekday comes from the date, the time from the group (no time set = no time shown)
function meetingWhen(ddmmyy, time) {
  const p = String(ddmmyy || '').split('/').map(Number);
  let day = '';
  if (p.length >= 2 && p[0] && p[1]) {
    const y = p[2] ? 2000 + p[2] : new Date().getFullYear();
    day = WEEKDAYS_RU[new Date(Date.UTC(y, p[1] - 1, p[0])).getUTCDay()] + ', ';
  }
  return `${day}${formatMeetingDate(ddmmyy)}${time ? ' в ' + String(time).replace(/^0/, '') : ''}`;
}

// Settings as the message builders and the admin UI know them: global settings plus the group's
// address / Waze / Zoom (which moved from `settings` to `groups`).
function settingsFor(gid) {
  const g = groups.getGroup(gid);
  const all = { ...db.getAllSettings(), ...db.getGroupSettings(gid) };
  if (!g) return all;
  return { ...all, meeting_location: g.address, meeting_waze_url: g.waze_url, meeting_zoom_url: g.zoom_url,
    meeting_type: g.meeting_type, meeting_time: g.meeting_time || '',
    meeting_weekday: g.meeting_weekday === null ? '' : String(g.meeting_weekday), group_name: g.name, group_slug: g.slug,
    default_language: g.default_language,
    payment_url: g.payment_url, payment_amount: g.payment_amount == null ? '' : String(g.payment_amount) };
}

// Payment block of a message: only when the group has a payment link.
function paymentBlock(gid) {
  const g = groups.getGroup(gid);
  if (!g || !g.payment_url) return '';
  return `💳 Оплата участия${g.payment_amount ? ` (${g.payment_amount}₪)` : ''}:\n${g.payment_url}\n\n`;
}

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

// ─── Utility helpers ──────────────────────────────────────────────────────────

function formatMeetingDate(ddmmyy) {
  if (!ddmmyy) return '';
  const parts = ddmmyy.split('/');
  if (parts.length < 2) return ddmmyy;
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const dd = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  const yy = parts[2] ? (parseInt(parts[2], 10) + 2000) : new Date().getFullYear();
  return `${dd} ${months[mm - 1]} ${yy}`;
}


// Approved invitation text, identical to the registration form (public/guest.html)
const inviteBlock1 = name =>
  `Группа ${name} приглашает вас на утреннюю бизнес-встречу!\n\n` +
  `На встрече примут участие более 30 владельцев бизнеса, и у вас будет возможность представить свой бизнес с целью создания связей и активного сотрудничества.`;
const INVITE_BLOCK_2 =
  `Вас ждёт:\n` +
  `✅ Личное представление\n` +
  `✅ Бизнес-лекция от нашего спикера\n` +
  `✅ Бизнес-завтрак`;

function meetingLocationLine(settings) {
  return (settings.meeting_type || 'offline') === 'zoom'
    ? `💻 Встреча пройдёт онлайн в Zoom\n🔗 ${settings.meeting_zoom_url || ''}`
    : `📍 ${settings.meeting_location || ''}`;
}

function speakerLine(presenter) {
  return (presenter && presenter.member_name)
    ? `\n🎤 Спикер встречи: ${presenter.member_name}${presenter.member_profession ? ' — ' + presenter.member_profession : ''}`
    : '';
}

function confirmationPlaceBlock(settings) {
  if ((settings.meeting_type || 'offline') === 'zoom') {
    return `💻 Встреча пройдёт онлайн в Zoom` + (settings.meeting_zoom_url ? `\n🔗 ${settings.meeting_zoom_url}` : '');
  }
  const lines = [];
  if (settings.meeting_location) lines.push(`📍 ${settings.meeting_location}`);
  if (settings.meeting_waze_url) lines.push(`🗺️ Навигатор:\n${settings.meeting_waze_url}`);
  return lines.join('\n');
}

function buildConfirmationMessage(guest, settings) {
  const place = confirmationPlaceBlock(settings);
  return `Здравствуйте, ${whatsapp.getFirstName(guest.name)}! 👋\n\n` +
    `Напоминаем, что вы приглашены на встречу ${settings.group_name || 'BNI'} 🤝\n\n` +
    `Пожалуйста, подтвердите участие:\n` +
    `✅ ${PUBLIC_BASE}/confirm?id=${guest.id}&group=${encodeURIComponent(settings.group_slug || '')}\n\n` +
    (place ? `${place}\n\n` : '') +
    `${settings.group_name || 'BNI'}`;
}

// BNI Connect letter: invitation (to the guest, or for the inviting member to forward)
function buildMailInviteMessage({ name, meetingDate }, settings) {
  const first = name && whatsapp.getFirstName(name);
  const place = confirmationPlaceBlock(settings);
  return `Здравствуйте${first ? ', ' + first : ''}! 👋\n\n` +
    `Вас пригласили на встречу ${settings.group_name || 'BNI'}:\n` +
    `📅 ${meetingWhen(meetingDate, settings.meeting_time)}\n\n` +
    (place ? `${place}\n\n` : '') +
    `Пожалуйста, зарегистрируйтесь по ссылке:\n` +
    `✅ ${PUBLIC_BASE}/guest?group=${encodeURIComponent(settings.group_slug || '')}\n\n` +
    `${settings.group_name || 'BNI'}`;
}

// BNI Connect letter without a usable guest number: ask the inviting member to forward the invitation
function buildMailMemberRequest({ memberName, guestName }) {
  return `Здравствуйте${memberName ? ', ' + memberName : ''}! 👋\n\n` +
    `Вы записали в BNI Connect гостя: ${guestName || '—'}. В записи нет мобильного номера, поэтому мы не можем написать ему сами.\n\n` +
    `Пожалуйста, перешлите гостю следующее сообщение 👇`;
}

// First message to a guest registered from a BNI Connect email (only with mail_intake_auto_register=1)
function buildIntakeInviteMessage(guest, settings, presenter = null) {
  const firstName = (guest.name || '').trim().split(/\s+/)[0];
  return `Здравствуйте${firstName ? ', ' + firstName : ''}! 👋\n\n` +
    `Вас пригласили на встречу ${settings.group_name || 'BNI'}:\n` +
    `📅 ${meetingWhen(guest.meetingDate, settings.meeting_time)}\n\n` +
    `${meetingLocationLine(settings)}${speakerLine(presenter)}\n\n` +
    `Напишите, пожалуйста, ваше имя, профессию и как вас представить.\n\n` +
    `Пожалуйста, подтвердите участие:\n` +
    `✅ ${PUBLIC_BASE}/confirm?id=${guest.id}&group=${encodeURIComponent(settings.group_slug || '')}\n\n` +
    `${settings.group_name || 'BNI'}`;
}

function buildGuestGuideMessage(guest, name = 'BNI') {
  return [
    '📋 ПАМЯТКА ДЛЯ ГОСТЕЙ',
    '',
    'Вы у нас в гостях. Что будет на встрече?',
    '',
    'Мы рады видеть вас на встрече BNI. Вот короткий путеводитель, чтобы вы заранее знали, что будет происходить.',
    '',
    '1️⃣ До начала встречи',
    'Будет время познакомиться и пообщаться с участниками и гостями. Если вы никого не знаете — не страшно. Наша команда гостеприимства подскажет, с кем вам может быть полезно познакомиться, и поможет представиться.',
    '',
    '2️⃣ Во время встречи',
    'Каждый участник коротко расскажет о себе и своём бизнесе. Не пытайтесь запомнить всех: после встречи мы пришлём вам каталог участников с контактами. Просто отметьте тех, с кем вам хотелось бы поговорить подробнее.',
    '',
    '3️⃣ Ваши 30 секунд',
    'Гостям тоже дадут слово. Заранее подготовьте короткое представление:',
    '- Как вас зовут',
    '- Чем вы занимаетесь',
    '- Кому помогаете',
    '- С каким запросом к вам обращаться',
    '',
    'Например: «Меня зовут Анна, я семейный фотограф. Я снимаю семьи, пары и детей — не постановочно, а так, чтобы на фотографиях оставались живые эмоции. Ко мне часто приходят люди, которые говорят: "Я вообще не умею позировать" — и моя задача сделать так, чтобы им было легко и комфортно перед камерой. Сейчас мне особенно интересны знакомства с семьями, которые планируют семейную съёмку, день рождения или другое важное событие. Если среди ваших знакомых есть такие люди, буду рада знакомству».',
    '',
    'Подсказка: можно записать текст в телефон и прочитать с экрана — это совершенно нормально. И главное — не волнуйтесь. Мы сделаем всё, чтобы вам было комфортно.',
    '',
    '4️⃣ После встречи',
    'Подойдите к участникам, которые вас заинтересовали, познакомьтесь и обменяйтесь контактами. А если хочется поговорить подробнее — договоритесь о встрече 1:1, чтобы спокойно узнать больше о бизнесе друг друга.',
    '',
    `Команда ${name}`,
  ].join('\n');
}

// ─── Message variants (anti-spam) ─────────────────────────────────────────────

function pickVariant(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

const VOTING_VARIANTS = [
  (name, link, org) => `${name}, спасибо что были на встрече ${org}! 🙏\nПроголосуйте пожалуйста:\n${link}`,
  (name, link) => `Шалом, ${name}! 👋 Ваш голос важен — голосование BNI открыто:\n${link}`,
  (name, link) => `${name}, встреча прошла отлично! 🎯 Ваш голос решает:\n${link}`,
  (name, link, org) => `Привет, ${name}! Поддержите лучшего участника ${org} 🏆\n${link}`,
  (name, link) => `${name}, один клик — ваш голос засчитан ✅\nГолосование:\n${link}`,
  (name, link, org) => `Дорогой(ая) ${name}, голосование ${org} ждёт вас! 🗳️\n${link}`,
  (name, link) => `${name}, спасибо за визит! Выберите лучшего участника 🌟\n${link}`,
];

const CONTACTS_VARIANTS = [
  (name, contacts, org) => `${name}, вот контакты участников группы ${org}:\n\n${contacts}\n\nБудем рады видеть вас снова! 🤝`,
  (name, contacts) => `Шалом, ${name}! 👋 Контакты наших специалистов BNI:\n\n${contacts}`,
  (name, contacts, org) => `${name}, спасибо за визит в ${org}! 🙌\nПолезные контакты:\n\n${contacts}`,
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
const auth = authGuard.createAuth(process.env.ADMIN_PASSWORD);
const adminAuth = auth.adminAuth;
const loginLimiter = authGuard.createLoginLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

app.post('/api/admin/login', (req, res) => {
  const ip = authGuard.clientIp(req);
  if (loginLimiter.isBlocked(ip)) {
    res.set('Retry-After', String(loginLimiter.retryAfterSec(ip)));
    return res.status(429).json({ error: 'Слишком много попыток входа. Попробуйте позже.' });
  }
  const { password } = req.body || {};
  if (!auth.checkPassword(password)) {
    loginLimiter.recordFailure(ip);
    console.warn(`[Auth] failed admin login from ${ip}`);
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  res.json({ token: auth.token });
});

// Default-deny: every /api route needs the admin token unless it is in
// services/authGuard.js PUBLIC_ROUTES. Registered before all other /api routes.
app.use('/api', auth.guard);

// Which group a request works on: ?group=<slug> (anyone) or ?group_id=<n> (admin only).
// An unknown group is an error (404), never silently replaced by group 1.
// A request with NO group parameter is a legacy link/page from before groups existed and means group 1;
// every link the system sends out carries ?group=<slug>.
app.use('/api', (req, res, next) => {
  const q = req.query;
  if (q.group !== undefined) {
    const g = groups.getGroupBySlug(q.group);
    if (!g) return res.status(404).json({ error: 'group not found' });
    req.groupId = g.id;
    return next();
  }
  if (q.group_id !== undefined && auth.isAdminRequest(req)) {
    if (!/^\d+$/.test(String(q.group_id))) return res.status(400).json({ error: 'group_id must be a number' });
    const g = groups.getGroup(Number(q.group_id));
    if (!g) return res.status(404).json({ error: 'group not found' });
    req.groupId = g.id;
    return next();
  }
  req.groupId = GROUP1;       // legacy: no group in the request
  req.groupImplicit = true;
  next();
});

// ─── HTML pages ───────────────────────────────────────────────────────────────

app.get('/guest', (req, res) => {
  const ref = req.query.ref || '';
  let invitedByName = ref;
  if (/^\d+$/.test(ref)) {
    const m = db.db.prepare('SELECT name FROM members WHERE id = ?').get(Number(ref));
    if (m) invitedByName = m.name;
  }
  let gid = GROUP1; // legacy link without group/ref means group 1
  if (/^\d+$/.test(ref) && groups.groupOfMember(Number(ref))) gid = groups.groupOfMember(Number(ref));
  else if (req.query.group !== undefined) {
    const g = groups.getGroupBySlug(req.query.group);
    if (!g) return res.status(404).type('text').send('Group not found');
    gid = g.id;
  }
  const pub = groups.publicGroup(groups.getGroup(gid)) || {};
  const html = fs.readFileSync(path.join(__dirname, 'public', 'guest.html'), 'utf8');
  const injected = html.replace('<script>', `<script>window.__REF_NAME__=${JSON.stringify(invitedByName)};\n` +
    `window.__GROUP__=${JSON.stringify({ slug: pub.slug, name: pub.name, waze_url: pub.waze_url, payment_url: pub.payment_url, payment_amount: pub.payment_amount, default_language: pub.default_language }).replace(/</g, '\\u003c')};\n`);
  res.type('html').send(injected);
});
app.get('/admin',           (req, res) => {
  // Serve React SPA if built, otherwise fall back to admin.html
  const spa = path.join(__dirname, 'public', 'dist', 'index.html');
  if (fs.existsSync(spa)) return res.sendFile(spa);
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/confirm',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'confirm.html')));
app.get('/member',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'member.html')));
app.get('/voting',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'voting.html')));
app.get('/profile',         (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/members-catalog', (req, res) => res.sendFile(path.join(__dirname, 'public', 'members-catalog.html')));
app.get('/presentations',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'presentations.html')));

app.use(express.static(path.join(__dirname, 'public')));

// ─── Health / test ────────────────────────────────────────────────────────────

app.get('/api/test', (req, res) => {
  const s = settingsFor(req.groupId);
  res.json({
    status:           'ok',
    nextMeeting:      meetingDateFor(req.groupId),
    totalGuests:      db.getTotalCount(req.groupId),
    meeting_location: s.meeting_location || '',
    meeting_type:     s.meeting_type     || 'offline',
    meeting_time:     s.meeting_time     || '',
  });
});

// ─── Guest registration ───────────────────────────────────────────────────────

app.post('/api/register', async (req, res) => {
  const { name, phone, specialty, type, meetingDate: bodyDate, email } = req.body;
  // The inviter is stored by member ID; the group is the inviter's group (group 1 when unknown).
  let invitedBy = req.body.invitedBy || '';
  let invitedByMemberId = null;
  let gid = req.groupId;
  const rawRef = req.body.invitedByMemberId ?? (/^\d+$/.test(String(invitedBy)) ? invitedBy : null);
  if (rawRef !== null && rawRef !== undefined && /^\d+$/.test(String(rawRef))) {
    const m = db.getMemberById(Number(rawRef));
    if (m) { invitedByMemberId = m.id; invitedBy = m.name; gid = m.group_id; }
  } else if (invitedBy.trim()) {
    const m = db.getAllMembers(gid).find(x => x.name.trim() === invitedBy.trim()); // exact match only
    if (m) invitedByMemberId = m.id;
  }

  if (!name || !phone) {
    return res.status(400).json({ error: 'Имя и телефон обязательны' });
  }
  if (/[\u0590-\u05FF]/.test(name) || /[\u0590-\u05FF]/.test(specialty)) {
    return res.status(400).json({ error: 'Hebrew characters not allowed in name or specialty' });
  }
  if (specialty && specialty.length > 50) {
    return res.status(400).json({ error: 'Профессия не может быть длиннее 50 символов' });
  }
  if (name.trim().split(/\s+/).filter(Boolean).length < 2) {
    return res.status(400).json({ error: 'Пожалуйста, введите имя и фамилию' });
  }

  const meetingDate = (bodyDate && /^\d{2}\/\d{2}\/\d{2}$/.test(bodyDate.trim()) ? bodyDate.trim() : null) || meetingDateFor(gid);

  // Deduplication: silently succeed if same name or phone already registered for this meeting
  const duplicate = db.findDuplicateGuest(meetingDate, phone, name, gid);
  if (duplicate) return res.json({ success: true, duplicate: true, id: duplicate.id });

  const isSub       = type === 'sub';
  const firstName   = name.split(' ')[0]; // for WA greeting

  // 1. Save to SQLite — substitutions are pre-marked as paid
  const id = db.insertGuest({
    name, phone, specialty, invitedBy, meetingDate, email: email || '',
    paid:   isSub ? 1 : 0,
    paidAt: isSub ? new Date().toISOString() : null,
    guestType: isSub ? 'sub' : 'guest',
    groupId: gid, invitedByMemberId,
  });

  // 2. Google Sheets — non-blocking
  const paymentMethod = isSub ? `замена за ${invitedBy || '—'}` : 'онлайн';
  sheets.appendGuest({ name, phone, specialty, invitedBy, meetingDate, paymentMethod, email: email || '', sheetId: (groups.getGroup(gid) || {}).sheet_id })
    .then(sheetRow => { if (sheetRow) db.updateSheetRow(id, sheetRow); })
    .catch(err => console.error('[Sheets] appendGuest failed:', err.message));

  // 3. WhatsApp — different message for substitutions
  const settings  = settingsFor(gid);
  const regLocation = settings.meeting_location || '';

  // Lookup presenter for this meeting date
  const presenter = db.getPresentationByDate(meetingDate, gid);
  const presenterLine = (presenter && presenter.member_name)
    ? `\n\n🎤 На встрече выступит:\n${presenter.member_name}${presenter.member_profession ? ' — ' + presenter.member_profession : ''}`
    : '';

  let waText;
  if (isSub) {
    waText =
      `Шалом, ${firstName}! 👋\n\n` +
      `Вы зарегистрированы как замена на встречу ${settings.group_name} 🤝\n\n` +
      `${inviteBlock1(settings.group_name)}\n\n${INVITE_BLOCK_2}\n\n` +
      `📅 ${meetingWhen(meetingDate, settings.meeting_time)}\n` +
      `📍 ${regLocation}${presenterLine}\n\n` +
      `🗺️ Навигатор:\n${settings.meeting_waze_url || ''}\n\n` +
      `Спасибо, что поддерживаете группу! 🙌`;
  } else {
    waText =
      `Шалом, ${firstName}! 👋\n\n` +
      `Вы зарегистрированы на встречу ${settings.group_name} 🤝\n\n` +
      `${inviteBlock1(settings.group_name)}\n\n${INVITE_BLOCK_2}\n\n` +
      `📅 ${meetingWhen(meetingDate, settings.meeting_time)}\n` +
      `📍 ${regLocation}${presenterLine}\n\n` +
      paymentBlock(gid) +
      `🗺️ Навигатор:\n${settings.meeting_waze_url || ''}\n\n` +
      `До встречи! 🙌`;
  }

  // Helper: resolve presenter photo path
  function presenterPhotoPath(p) {
    if (!p || !p.member_photo) return null;
    const fp = path.join(__dirname, 'public', 'uploads', p.member_photo);
    return fs.existsSync(fp) ? fp : null;
  }

  waFor(gid).sendMessage(phone, waText)
    .then(async () => {
      db.markWaSent(id);
      const photoPath = presenterPhotoPath(presenter);
      if (photoPath) {
        const caption = `${presenter.member_name}${presenter.member_profession ? '\n' + presenter.member_profession : ''}`;
        await waFor(gid).sendImage(phone, photoPath, caption)
          .catch(err => console.error('[WhatsApp] sendImage (presenter) failed:', err.message));
      }
    })
    .catch(err => console.error('[WhatsApp] sendMessage failed:', err.message));

  // If confirmation blast already ran for this meeting, send confirmation WA to this new guest
  if (settings.confirmation_round1_for === meetingDate || settings.confirmation_round2_for === meetingDate) {
    const confirmMsg = buildConfirmationMessage({ id, name }, settings);
    setTimeout(() => {
      waFor(gid).sendMessage(phone, confirmMsg)
        .then(() => db.markWaSent(id))
        .catch(err => console.error('[WhatsApp] late-reg confirm failed:', err.message));
    }, 30000); // 30s delay so registration WA goes first
  }

  return res.json({ success: true, id, name, isSub });
});

// ─── Mail intake (BNI Connect "guest registered" emails, piped in by Postfix) ──

function isMeetingInPast(ddmmyy) {
  const [d, m, y] = ddmmyy.split('/').map(Number);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' }); // YYYY-MM-DD
  const meeting = `20${String(y).padStart(2, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return meeting < today;
}

function onIntakeGuestCreated(g) {
  sheets.appendGuest({
    name: g.name, phone: g.phone, specialty: g.specialty, invitedBy: g.invitedBy, meetingDate: g.meetingDate,
    paymentMethod: g.isSub ? `замена за ${g.invitedBy || '—'}` : 'онлайн', email: g.email,
    sheetId: (groups.getGroup(GROUP1) || {}).sheet_id,
  })
    .then(sheetRow => { if (sheetRow) db.updateSheetRow(g.id, sheetRow); })
    .catch(err => console.error('[Sheets] appendGuest (mail intake) failed:', err.message));

  if (!g.phone || !g.waEnabled || isMeetingInPast(g.meetingDate)) return;
  const msg = buildIntakeInviteMessage(g, settingsFor(GROUP1), db.getPresentationByDate(g.meetingDate, GROUP1));
  whatsapp.sendMessage(g.phone, msg)
    .then(() => {
      db.markWaSent(g.id);
      db.setGuestProfileStatus(g.id, 'awaiting');
    })
    .catch(err => console.error('[MailIntake] WhatsApp invite failed:', err.message));
}

function isLocalIntakeRequest(req) {
  const ip = req.socket.remoteAddress;
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  // nginx always adds X-Real-IP, so a request that went through the proxy is never accepted here
  return loopback && !req.headers['x-real-ip'] && !req.headers['x-forwarded-for'];
}

function intakeSecretOk(req) {
  const expected = process.env.MAIL_INTAKE_SECRET || '';
  const got = String(req.headers['x-intake-secret'] || '');
  const h = s => crypto.createHash('sha256').update(s).digest();
  return expected.length >= 16 && crypto.timingSafeEqual(h(got), h(expected));
}

app.post('/internal/mail-intake', express.raw({ type: () => true, limit: '2mb' }), async (req, res) => {
  if (!isLocalIntakeRequest(req)) return res.status(404).end();
  if (!process.env.MAIL_INTAKE_SECRET) return res.status(503).json({ error: 'MAIL_INTAKE_SECRET not configured' });
  if (!intakeSecretOk(req)) return res.status(403).json({ error: 'forbidden' });
  if (!Buffer.isBuffer(req.body)) return res.status(415).json({ error: 'send raw message with Content-Type: message/rfc822' });
  if (!req.body.length) return res.status(400).json({ error: 'empty body' });
  try {
    const out = await mailIntake.handleIncomingMail(req.body, {
      db,
      nextMeetingDate: () => meetingDateFor(GROUP1),
      afterCreate: onIntakeGuestCreated,
      groupId: GROUP1, // mail for other groups needs its own mailbox/link; until then every letter is group 1's
      autoRegister: () => db.getGroupSetting(GROUP1, 'mail_intake_auto_register') === '1',
      mode: () => db.getGroupSetting(GROUP1, 'mail_intake_mode'),
      notifyPhone: () => db.getGroupSetting(GROUP1, 'mail_intake_notify_phone') || '',
      checkWhatsApp: (...a) => waFor(GROUP1).checkNumberExists(...a),
      sendSequence: (...a) => waFor(GROUP1).sendSequence(...a),
      isPast: isMeetingInPast,
      buildInvite: g => buildMailInviteMessage(g, settingsFor(GROUP1)),
      buildMemberRequest: buildMailMemberRequest,
    });
    res.json(out);
  } catch (err) {
    console.error('[MailIntake] fatal:', err.stack || err.message);
    res.status(500).json({ error: 'intake failed' });
  }
});

// ─── Guests API ───────────────────────────────────────────────────────────────

app.get('/api/guests', (req, res) => {
  const { date } = req.query;
  // Visit counters are computed over the whole guests table, then filtered for the response
  const all = db.getAllGuests(req.groupId);
  const counts = computeVisitCounts(all);
  const guests = date ? all.filter(g => g.meetingDate === date) : all;
  res.json(guests.map(g => ({
    ...g,
    name: g.name || `${g.firstName || ''} ${g.lastName || ''}`.trim(),
    ...(counts.get(g.id) || {}),
  })));
});

app.get('/api/meetings', (req, res) => {
  const next  = meetingDateFor(req.groupId);
  const dates = db.getMeetingDates(req.groupId).filter(d => d !== next);
  const all   = next ? [next, ...dates] : dates;
  res.json(all);
});

app.put('/api/guests/:id/paid', (req, res) => {
  const guest = db.getGuestById(req.params.id);
  if (!guest) return res.status(404).json({ error: 'Гость не найден' });

  db.markPaid(guest.id);

  if (guest.sheetRow) {
    sheets.markPaid(guest.meetingDate, guest.sheetRow, (groups.getGroup(guest.group_id) || {}).sheet_id)
      .catch(err => console.error('[Sheets] markPaid failed:', err.message));
  }

  res.json({ success: true });
});

app.delete('/api/guests/:id', (req, res) => {
  db.db.prepare('DELETE FROM guests WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.patch('/api/guests/:id/wa-toggle', (req, res) => {
  const next = db.toggleWaEnabled(req.params.id);
  if (next === null) return res.status(404).json({ error: 'Гость не найден' });
  res.json({ success: true, wa_enabled: next });
});

app.patch('/api/guests/:id', (req, res) => {
  const { specialty } = req.body;
  const guest = db.getGuestById(req.params.id);
  if (!guest) return res.status(404).json({ error: 'Гость не найден' });
  db.updateGuestSpecialty(req.params.id, specialty || '');
  res.json({ success: true });
});

// Public endpoint — no auth required
app.get('/api/guests/:id/public', (req, res) => {
  const guest = db.getGuestById(req.params.id);
  if (!guest) return res.status(404).json({ error: 'Гость не найден' });
  const settings = settingsFor(guest.group_id);
  res.json({
    name:        guest.name || `${guest.firstName || ''} ${guest.lastName || ''}`.trim(),
    meetingDate: guest.meetingDate,
    confirmed:   guest.confirmed || 0,
    meetingType: settings.meeting_type || 'offline',
    meetingTime: settings.meeting_time || '',
    location:    settings.meeting_location || '',
    zoomUrl:     settings.meeting_zoom_url || '',
  });
});

app.post('/api/guests/:id/confirm', (req, res) => {
  const guest = db.getGuestById(req.params.id);
  if (!guest) return res.status(404).json({ error: 'Гость не найден' });
  const status = req.body?.confirmed === -1 ? -1 : 1;
  if (status === -1) {
    db.markDeclined(guest.id);
  } else {
    db.markConfirmed(guest.id);
    if (guest.wa_enabled && guest.phone && db.claimGuideSent(guest.id)) {
      waFor(guest.group_id).sendMessage(guest.phone, buildGuestGuideMessage(guest, groupName(guest.group_id)))
        .catch(err => {
          console.error('[GuestGuide] send failed:', err.message);
          db.releaseGuideSent(guest.id);
        });
    }
  }
  res.json({ success: true, confirmed: status });
});

// ─── Members API ──────────────────────────────────────────────────────────────

app.get('/api/members', (req, res) => {
  const { active } = req.query;
  const members = active === 'true'
    ? db.getActiveMembers(req.groupId)
    : db.getAllMembers(req.groupId);
  res.json(auth.isAdminRequest(req) ? members : members.map(authGuard.publicMemberList));
});

app.post('/api/members', (req, res) => {
  const { name, profession, name_he, phone, birthday } = req.body;
  if (!name) return res.status(400).json({ error: 'name обязателен' });
  try {
    const id = db.insertMember({ name, profession, name_he, phone, birthday, groupId: req.groupId });
    res.json({ success: true, id });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Участник с таким именем уже существует' });
    }
    throw err;
  }
});

app.put('/api/members/reorder', adminAuth, (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array' });
  db.reorderMembers(order.map(Number));
  res.json({ success: true });
});

app.put('/api/members/:id', (req, res) => {
  const member = db.updateMember(Number(req.params.id), req.body);
  if (!member) return res.status(404).json({ error: 'Участник не найден' });
  res.json({ success: true, member });
});

app.delete('/api/members/:id', (req, res) => {
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Участник не найден' });
  db.setMemberActive(member.id, 0);
  res.json({ success: true });
});

app.get('/api/members/count', (req, res) => {
  res.json({ count: db.getActiveMembers(req.groupId).length });
});

app.get('/api/members/:id', (req, res) => {
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Участник не найден' });
  res.json(auth.isAdminRequest(req) ? member : authGuard.publicMemberProfile(member));
});

app.get('/api/members/:id/photo', (req, res) => {
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Участник не найден' });
  res.json({ url: member.photo ? `/uploads/${member.photo}` : null });
});

app.post('/api/members/:id/photo', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Участник не найден' });

  // Delete old photo file if filename changed
  if (member.photo && member.photo !== req.file.filename) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, member.photo)); } catch {}
  }

  db.updateMemberPhoto(member.id, req.file.filename);
  res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

app.patch('/api/members/:id/profile', (req, res) => {
  const member = db.updateMemberProfile(Number(req.params.id), req.body);
  if (!member) return res.status(404).json({ error: 'Участник не найден' });
  res.json({ success: true, member: auth.isAdminRequest(req) ? member : authGuard.publicMemberProfile(member) });
});

app.patch('/api/members/:id/activate', (req, res) => {
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Участник не найден' });
  db.setMemberActive(member.id, 1);
  res.json({ success: true });
});

app.get('/api/members/:id/socials', (req, res) => {
  const socials = db.getMemberSocials(Number(req.params.id));
  res.json(socials);
});

app.put('/api/members/:id/socials', (req, res) => {
  const member = db.getMemberById(Number(req.params.id));
  if (!member) return res.status(404).json({ error: 'Участник не найден' });
  const { socials } = req.body;
  if (!Array.isArray(socials)) return res.status(400).json({ error: 'socials должен быть массивом' });
  db.setMemberSocials(member.id, socials.filter(s => s.platform && s.url));
  res.json({ success: true });
});

app.get('/api/guests/active-count', (req, res) => {
  const next  = meetingDateFor(req.groupId);
  const count = next ? db.getGuestsByDate(next, req.groupId).length : 0;
  res.json({ count, date: next });
});

app.get('/api/guests/stats', (req, res) => {
  const dates = db.getMeetingDates(req.groupId).slice(0, 8).reverse();
  const stats  = dates.map(d => {
    const guests = db.getGuestsByDate(d, req.groupId);
    return { date: d, total: guests.length, paid: guests.filter(g => g.paid).length };
  });
  res.json(stats);
});

// ─── Public catalog ───────────────────────────────────────────────────────────

app.get('/api/catalog', (req, res) => {
  const members = db.getActiveMembers(req.groupId);
  const result  = members.map(m => ({ ...m, socials: db.getMemberSocials(m.id) }));
  res.json(auth.isAdminRequest(req) ? result : result.map(authGuard.publicCatalogMember));
});

// ─── PDF endpoints ────────────────────────────────────────────────────────────

app.get('/api/pdf/list', (req, res) => {
  const date   = req.query.date || meetingDateFor(req.groupId);
  const guests = db.getGuestsByDate(date, req.groupId);
  pdf.generateGuestList(res, guests, date, groupName(req.groupId));
});

app.get('/api/pdf/badges', (req, res) => {
  const date   = req.query.date || meetingDateFor(req.groupId);
  const guests = db.getGuestsByDate(date, req.groupId);
  pdf.generateBadges(res, guests, date, groupName(req.groupId));
});

app.get('/api/pdf/members', (req, res) => {
  const members = db.getActiveMembers(req.groupId).map(m => ({ ...m, socials: db.getMemberSocials(m.id) }));
  pdf.generateMembersCatalog(res, members, UPLOADS_DIR, groupName(req.groupId));
});

// ─── Settings ─────────────────────────────────────────────────────────────────

// While the group's meeting weekday is not set, the date is the old manual setting (group 1 only).
app.get('/api/settings/next-meeting', (req, res) => {
  res.json({ date: meetingDateFor(req.groupId), auto: groups.scheduleIsSet(req.groupId) });
});

app.patch('/api/settings/next-meeting', (req, res) => {
  if (groups.scheduleIsSet(req.groupId)) return res.status(409).json({ error: 'Дата рассчитывается по расписанию группы' });
  const { date } = req.body;
  if (!date) return res.status(400).json({ error: 'date обязателен' });
  const trimmed = String(date).trim();
  db.setGroupSetting(req.groupId, 'next_meeting_date', trimmed);
  res.json({ success: true, date: trimmed });
});

// Public: only the whitelisted keys, taken from the requested group (?group=slug, default group 1).
app.get('/api/settings', (req, res) => {
  res.json(authGuard.filterSettings(settingsFor(req.groupId), auth.isAdminRequest(req)));
});

// Address / Waze / Zoom moved to the group: writes of the old keys go there.
const GROUP_SETTING_KEYS = { meeting_location: 'address', meeting_waze_url: 'waze_url', meeting_zoom_url: 'zoom_url', meeting_type: 'meeting_type' };
const GROUP_STATE_KEYS = new Set(require('./services/groupsMigration').GROUP_SETTING_KEYS);
app.put('/api/settings', adminAuth, (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: 'key обязателен' });
  if (GROUP_SETTING_KEYS[key]) {
    const r = groups.updateGroup(req.groupId, { [GROUP_SETTING_KEYS[key]]: value ?? '' });
    if (r.error) return res.status(400).json({ error: r.error });
    return res.json({ success: true });
  }
  if (GROUP_STATE_KEYS.has(key)) { db.setGroupSetting(req.groupId, key, value ?? ''); return res.json({ success: true }); }
  return res.status(400).json({ error: `unknown setting key "${key}"` });
});

// ─── Group settings & positions (admin) ───────────────────────────────────────

app.get('/api/group', (req, res) => {
  const g = groups.getGroup(req.groupId);
  if (!g) return res.status(404).json({ error: 'group not found' });
  const { waha_session, ...rest } = g;
  res.json({ ...rest, waha_session, next_meeting: meetingDateFor(req.groupId), schedule_set: groups.scheduleIsSet(req.groupId) });
});

app.put('/api/group', (req, res) => {
  const r = groups.updateGroup(req.groupId, req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  wavesCache.delete(req.groupId); catalogCache.delete(req.groupId); // they hold the WhatsApp session of the group
  res.json({ success: true, group: r.group, next_meeting: meetingDateFor(req.groupId) });
});

app.get('/api/positions', (req, res) => {
  res.json({ positions: groups.listPositions(req.groupId), assignments: groups.memberPositionsMap(req.groupId) });
});

app.put('/api/members/:id/positions', (req, res) => {
  const r = groups.setMemberPositions(Number(req.params.id), req.body && req.body.positions);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ success: true, positions: r.positions });
});

// ─── Birthdays ────────────────────────────────────────────────────────────────

app.get('/api/birthdays/upcoming', (req, res) => {
  const members = db.getActiveMembers(req.groupId);
  const result  = [];
  const today   = new Date(); today.setHours(0, 0, 0, 0);

  // ±7 day window around today (covers past 7 days and next 7 days)
  if (req.query.around === 'auto') {
    const from = new Date(today); from.setDate(from.getDate() - 7);
    const to   = new Date(today); to.setDate(to.getDate() + 7);
    for (const member of members) {
      if (!member.birthday) continue;
      const parts = member.birthday.split('/');
      if (parts.length < 2) continue;
      const day = parseInt(parts[0], 10), month = parseInt(parts[1], 10);
      if (isNaN(day) || isNaN(month)) continue;
      for (const yo of [-1, 0, 1]) {
        const bday = new Date(today.getFullYear() + yo, month - 1, day);
        bday.setHours(0, 0, 0, 0);
        if (bday >= from && bday <= to) {
          result.push({ ...member, daysUntil: Math.round((bday - today) / 86_400_000) });
          break;
        }
      }
    }
    result.sort((a, b) => a.daysUntil - b.daysUntil);
    return res.json(result);
  }

  // Default: next N days from today
  const days = Math.min(parseInt(req.query.days || '14', 10), 365);
  for (const member of members) {
    if (!member.birthday) continue;
    const parts = member.birthday.split('/');
    if (parts.length < 2) continue;
    const day   = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    if (isNaN(day) || isNaN(month)) continue;
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
  if (!member)        return res.status(404).json({ error: 'Участник не найден' });
  if (!member.phone)  return res.status(400).json({ error: 'Нет номера телефона' });

  const msg =
    `🎂 С Днём рождения, ${member.name.split(' ')[0]}!\n\n` +
    `Вся группа ${groupName(member.group_id)} поздравляет вас с праздником! 🎉\n` +
    `Желаем процветания бизнесу и здоровья! 🥂`;

  try {
    await waFor(member.group_id).sendMessage(member.phone, msg);
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

  const gid = req.groupId;
  if (db.getGroupSetting(gid, 'voting_open') !== '1') {
    return res.status(403).json({ error: 'voting_closed' });
  }
  // the candidate must be a member of this group
  const cand = db.getMemberById(Number(candidateId));
  if (!cand || cand.group_id !== gid) return res.status(400).json({ error: 'Выберите участника' });

  const meetingDate = meetingDateFor(gid);
  db.insertAnonymousVote({ meetingDate, candidateId: Number(candidateId), candidateName, groupId: gid });

  // Auto-close when all expected voters have voted
  const voteCount = db.getVoteCount(meetingDate, gid);
  const expected  = db.getActiveMembers(gid).length + db.getGuestsByDate(meetingDate, gid).filter(g => g.wa_enabled !== 0).length;
  if (expected > 0 && voteCount >= expected) {
    db.setGroupSetting(gid, 'voting_open', '0');
  }

  res.json({ success: true });
});

app.get('/api/voting/results', (req, res) => {
  if (!req.query.date) {
    const parseDMY = d => { const p = d.split('/'); return new Date(2000 + parseInt(p[2] || 0), parseInt(p[1]) - 1, parseInt(p[0])); };
    const allDates = db.db.prepare(
      'SELECT DISTINCT meetingDate FROM votes WHERE group_id = ?'
    ).all(req.groupId).map(r => r.meetingDate)
      .sort((a, b) => parseDMY(b) - parseDMY(a));
    return res.json(allDates.map(d => ({ date: d, results: db.getVoteResults(d, req.groupId) })));
  }
  res.json(db.getVoteResults(req.query.date, req.groupId));
});

app.get('/api/voting/status', (req, res) => {
  const gid         = req.groupId;
  const meetingDate = meetingDateFor(gid);
  const open        = db.getGroupSetting(gid, 'voting_open') === '1';
  const voteCount   = db.getVoteCount(meetingDate, gid);
  const expected    = db.getActiveMembers(gid).length + db.getGuestsByDate(meetingDate, gid).filter(g => g.wa_enabled !== 0).length;
  res.json({ open, voteCount, expected, meetingDate });
});

app.post('/api/voting/open', (req, res) => {
  const gid = req.groupId;
  const meetingDate = meetingDateFor(gid);
  db.setGroupSetting(gid, 'voting_open', '1');
  db.deleteVotesByDate(meetingDate, gid);
  res.json({ success: true });

  const votingUrl = groupLink(gid, '/voting');
  const votingMsg = `🗳️ Голосование открыто!\n\nВыберите лучшую презентацию встречи ${groupName(gid)}:\n${votingUrl}`;

  const guestsForVoting = db.getGuestsByDate(meetingDate, gid).filter(g => g.wa_enabled === 1 && g.waSent === 1);
  if (guestsForVoting.length) {
    waFor(gid).sendWithDelay(guestsForVoting, () => votingMsg)
      .catch(err => console.error('[Voting/open] individual notify failed:', err.message));
  }

  const chatId = (groups.getGroup(gid) || {}).whatsapp_chat_id || '';
  if (chatId) {
    waFor(gid).sendGroupMessage(chatId,
      `🗳️ *Голосование открыто!*\n\nВыберите лучшую презентацию встречи ${groupName(gid)}:\n${votingUrl}`
    ).catch(err => console.error('[Voting/open] group notify failed:', err.message));
  }
});

app.get('/api/voting/winners', (req, res) => {
  res.json(db.getLastWinners(3, req.groupId));
});

app.post('/api/voting/close', (req, res) => {
  db.setGroupSetting(req.groupId, 'voting_open', '0');
  res.json({ success: true });
});

app.post('/api/voting/reset', (req, res) => {
  db.deleteVotesByDate(meetingDateFor(req.groupId), req.groupId);
  res.json({ success: true });
});

// ─── Broadcasts ───────────────────────────────────────────────────────────────

app.post('/api/send-voting', async (req, res) => {
  const { date, votingLink } = req.body;
  if (!date || !votingLink) {
    return res.status(400).json({ error: 'date и votingLink обязательны' });
  }

  const guests  = db.getGuestsByDate(date, req.groupId).filter(g => g.wa_enabled === 1);
  const chatId  = (groups.getGroup(req.groupId) || {}).whatsapp_chat_id || '';

  res.json({ success: true, total: guests.length, groupSent: !!chatId, message: 'Рассылка запущена' });

  // Individual messages to guests (random variant per message)
  waFor(req.groupId).sendWithDelay(guests, g =>
    pickVariant(VOTING_VARIANTS)(whatsapp.getFirstName(g.name), votingLink, groupName(req.groupId))
  ).catch(err => console.error('[Broadcast] send-voting guests error:', err.message));
});

app.post('/api/send-contacts', async (req, res) => {
  const { date, contactsText } = req.body;
  if (!date || !contactsText) {
    return res.status(400).json({ error: 'date и contactsText обязательны' });
  }

  const guests = db.getGuestsByDate(date, req.groupId).filter(g => g.wa_enabled !== 0);
  res.json({ success: true, total: guests.length, message: 'Рассылка запущена' });

  waFor(req.groupId).broadcast(guests, g =>
    pickVariant(CONTACTS_VARIANTS)((g.name || '').split(' ')[0], contactsText, groupName(req.groupId))
  ).catch(err => console.error('[Broadcast] send-contacts error:', err.message));
});

app.post('/api/whatsapp/send-catalog', async (req, res) => {
  const { meeting_date } = req.body;
  if (!meeting_date) return res.status(400).json({ error: 'meeting_date обязателен' });

  const guests = db.getGuestsByDate(meeting_date, req.groupId).filter(g => g.wa_enabled !== 0);
  res.json({ sent: guests.length });

  catalogFor(req.groupId).sendManual(meeting_date)
    .catch(err => console.error('[Broadcast] send-catalog error:', err.message));
});

app.post('/api/whatsapp/send-confirmations', async (req, res) => {
  const { meeting_date } = req.body;
  if (!meeting_date) return res.status(400).json({ error: 'meeting_date обязателен' });

  const guests = db.getGuestsByDate(meeting_date, req.groupId).filter(g => g.wa_enabled === 1 && !g.confirmed);
  const settings = settingsFor(req.groupId);
  db.setGroupSetting(req.groupId, 'confirmation_sent_for', meeting_date);
  db.setGroupSetting(req.groupId, 'confirmation_round1_for', meeting_date); // manual send enables the 30-second confirmation for late registrations
  res.json({ sent: guests.length });

  waFor(req.groupId).sendWithDelay(guests, g => buildConfirmationMessage(g, settings))
    .then(r => {
      console.log(`[Confirmations] Done: ${r.sent} sent, ${r.failed} failed`);
    })
    .catch(err => console.error('[Broadcast] send-confirmations error:', err.message));
});

// ─── WAHA status / reconnect ─────────────────────────────────────────────────

// ─── WAHA session control (admin only; session name is a parameter) ───────────

const DEFAULT_WAHA_SESSION = process.env.WAHA_SESSION || 'default';
const waha = wahaSession.createWahaClient({ url: process.env.WAHA_URL, apiKey: process.env.WAHA_API_KEY || '' });

const wahaRecovery = wahaSession.createAutoRecovery({
  restart: name => waha.restart(name),
  log: msg => console.log(msg),
  onProblem: (name, p) => { try { db.setSetting(`waha_last_problem:${name}`, JSON.stringify(p)); } catch {} },
});
for (const name of new Set(groups.listGroups().map(g => g.waha_session))) {
  try {
    const saved = db.getSetting(`waha_last_problem:${name}`);
    if (saved) wahaRecovery.setLastProblem(name, JSON.parse(saved));
  } catch {}
}

function wahaSessionName(req, res) {
  const groupSession = (groups.getGroup(req.groupId) || {}).waha_session;
  const name = String(req.query.session || (req.body && req.body.session) || groupSession || DEFAULT_WAHA_SESSION);
  if (!wahaSession.isValidSession(name)) { res.status(400).json({ error: 'bad session name' }); return null; }
  return name;
}

app.get('/api/waha/status', async (req, res) => {
  const name = wahaSessionName(req, res); if (!name) return;
  const { status, me } = await waha.getSession(name);
  res.json({
    session: name, status, ok: status === 'WORKING', state: wahaSession.pickWindowState(status), me,
    lastProblem: wahaRecovery.lastProblem(name), paused: wahaRecovery.isPaused(name),
  });
});

app.get('/api/waha/qr', async (req, res) => {
  const name = wahaSessionName(req, res); if (!name) return;
  // WAHA has a QR only in SCAN_QR_CODE (422 in every other status): check the status first
  const { status } = await waha.getSession(name);
  if (status !== 'SCAN_QR_CODE') return res.json({ qr: '', found: false, status });
  try {
    const qr = await waha.getQr(name);
    res.json({ qr: qr || '', found: !!qr, status });
  } catch {
    res.json({ qr: '', found: false, status: 'UNAVAILABLE' });
  }
});

app.post('/api/waha/restart', async (req, res) => {
  const name = wahaSessionName(req, res); if (!name) return;
  try {
    wahaRecovery.resume(name);
    await waha.restart(name);
    res.json({ status: 'STARTING' });
  } catch (err) {
    res.status(502).json({ error: `WAHA: ${err.message}` });
  }
});

app.post('/api/waha/logout', async (req, res) => {
  const name = wahaSessionName(req, res); if (!name) return;
  try {
    wahaRecovery.pause(name); // deliberate disconnect: do not auto-restart
    await waha.disconnect(name);
    console.log(`[WAHA] session "${name}" disconnected by admin`);
    res.json({ success: true });
  } catch (err) {
    res.status(502).json({ error: `WAHA: ${err.message}` });
  }
});

app.post('/api/waha/request-code', async (req, res) => {
  const name = wahaSessionName(req, res); if (!name) return;
  const phone = wahaSession.cleanPhoneNumber(req.body && req.body.phoneNumber);
  if (!phone) return res.status(400).json({ error: 'phoneNumber: international format, digits only' });
  try {
    const r = await waha.requestCode(name, phone);
    if (!r.ok) return res.status(r.status === 422 ? 409 : 502).json({ error: r.message || 'WAHA refused', wahaStatus: r.status });
    res.json({ code: r.code });
  } catch {
    res.status(502).json({ error: 'WAHA unavailable' });
  }
});

// Background check every 60 s: restart a FAILED / STOPPED session at most once per 5 minutes.
function startWahaWatchdog() {
  const tick = async () => {
    const sessions = [...new Set(groups.listGroups().map(g => g.waha_session))];
    for (const name of sessions) {
      try {
        const { status } = await waha.getSession(name);
        await wahaRecovery.check(name, status);
      } catch (err) {
        console.error(`[WAHA] watchdog ${name}:`, err.message); // one session failing never stops the others
      }
    }
  };
  setTimeout(tick, 15_000);
  return setInterval(tick, 60_000);
}

// ─── Presentations ────────────────────────────────────────────────────────────

app.get('/api/presentations', (req, res) => {
  res.json(db.getPresentations(null, req.groupId));
});

// GET by date: path param uses dashes (DD-MM-YY) to avoid URL slash ambiguity
app.get('/api/presentations/:date', (req, res) => {
  const date = req.params.date.replace(/-/g, '/');
  res.json(db.getPresentationByDate(date, req.groupId));
});

app.post('/api/presentations', (req, res) => {
  const { meeting_date, member_name, change_description, notes } = req.body;
  if (!meeting_date || !member_name || !change_description) {
    return res.status(400).json({ error: 'Заполните обязательные поля' });
  }
  const id = db.insertPresentation({ meeting_date, member_name, change_description, notes, groupId: req.groupId });
  res.json({ success: true, id });
});

app.put('/api/presentations/:dateOrId', (req, res) => {
  const param = req.params.dateOrId;
  if (/^\d+$/.test(param)) {
    // Legacy: update by numeric id
    const item = db.updatePresentation(Number(param), req.body);
    if (!item) return res.status(404).json({ error: 'Запись не найдена' });
    return res.json({ success: true, item });
  }
  // Calendar: upsert by date (DD-MM-YY in URL → DD/MM/YY in DB)
  const date = param.replace(/-/g, '/');
  const { member_id, member_name, notes } = req.body;
  const item = db.upsertPresentationByDate(date, { member_id, member_name, notes }, req.groupId);
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
function yearLabel(range) {
  // "2025-10-01".."2026-09-30" → "2025-26"
  return `${range.start.slice(0, 4)}-${range.end.slice(2, 4)}`;
}

function yearBucket(offset, gid) {
  const range = db.bniYearRange(offset);
  const totals = db.getGroupValueTotalsByYear(range.start, range.end, gid) || {};
  return {
    label: yearLabel(range),
    start: range.start,
    end: range.end,
    total_1on1: totals.total_1on1 || 0,
    total_referrals: totals.total_referrals || 0,
    total_deals: totals.total_deals || 0,
    total_amount: totals.total_amount || 0,
  };
}

app.get('/api/group-value/totals', (req, res) => {
  const period = req.query.period || 'all';
  const periodDays = { week: 7, month: 30, quarter: 90 };
  const days = periodDays[period];
  const t = days ? db.getGroupValueTotalsByPeriod(days, req.groupId) : db.getGroupValueTotals(req.groupId);
  res.json({
    ...(t || { total_1on1: 0, total_referrals: 0, total_deals: 0, total_amount: 0 }),
    current_year: yearBucket(0, req.groupId),
    prev_year: yearBucket(1, req.groupId),
    prev_prev_year: yearBucket(2, req.groupId),
  });
});

app.get('/api/group-value/summary', (req, res) => {
  res.json(db.getGroupValueSummary(req.groupId));
});

app.get('/api/group-value', (req, res) => {
  const { date } = req.query;
  res.json(db.getGroupValue(date || null, req.groupId));
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
    groupId:       req.groupId,
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

// ─── Meeting Stats ────────────────────────────────────────────────────────────

// IMPORTANT: /api/meeting-stats/totals must come before /api/meeting-stats/:id
app.get('/api/meeting-stats/totals', adminAuth, (req, res) => {
  const period = req.query.period || 'all';
  const periodDays = { week: 7, month: 30, quarter: 90 };
  const days = periodDays[period];
  const t = db.getMeetingStatsTotals(days, req.groupId);
  res.json(t || { total_1on1: 0, total_referrals: 0, total_deals: 0, total_amount: 0 });
});

app.get('/api/meeting-stats', adminAuth, (req, res) => {
  res.json(db.getAllMeetingStats(req.groupId));
});

app.post('/api/meeting-stats', adminAuth, (req, res) => {
  const { meeting_date, meetings_1on1, referrals, closed_deals, deal_amount } = req.body;
  if (!meeting_date) return res.status(400).json({ error: 'meeting_date required' });
  const updated = db.upsertMeetingStats(meeting_date, {
    meetings_1on1: Number(meetings_1on1) || 0,
    referrals:     Number(referrals)     || 0,
    closed_deals:  Number(closed_deals)  || 0,
    deal_amount:   Number(deal_amount)   || 0,
  }, req.groupId);
  res.json({ ok: true, updated });
});

app.delete('/api/meeting-stats/:id', adminAuth, (req, res) => {
  db.deleteMeetingStats(Number(req.params.id));
  res.json({ ok: true });
});

// ─── Background jobs: one scheduler, every group in its own time zone ─────────
// A job is due relative to the group's meeting weekday (Monday group: waves on Thursday 10:00 and Sunday 18:00,
// the unconfirmed list an hour after each wave, the catalog on the meeting day 10:00) plus a daily birthday job.
// Each group has its own WAHA session, notify recipient and state (group_settings); a failure in one group is
// caught inside its job, logged with the group id, and the other groups carry on.

const wavesCache = new Map();
const catalogCache = new Map();
const todayIn = gid => {
  const tz = (groups.getGroup(gid) || {}).timezone || 'Asia/Jerusalem';
  const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: tz }).split('-');
  return `${d}/${m}/${y.slice(2)}`;
};
function wavesFor(gid) {
  if (!wavesCache.has(gid)) {
    wavesCache.set(gid, require('./services/confirmationWaves').createWaves({
      db, whatsapp: waFor(gid), buildConfirmationMessage, getTodayStr: () => todayIn(gid), formatMeetingDate,
      getNextMeeting: () => meetingDateFor(gid),
      groupId: gid,
      getSettings: () => settingsFor(gid),
      getGroupName: () => groupName(gid),
      getNotifyPhone: () => groups.unconfirmedNotifyPhone(gid), // head of the notifying position; the group's own setting as fallback
    }));
  }
  return wavesCache.get(gid);
}
function catalogFor(gid) {
  if (!catalogCache.has(gid)) {
    catalogCache.set(gid, require('./services/catalogBroadcast').createCatalog({
      db, whatsapp: waFor(gid), getTodayStr: () => todayIn(gid), groupId: gid,
      getSessionStatus: () => waFor(gid).getSessionStatus(),
      getMessageOptions: () => {
        const g = groups.getGroup(gid) || {};
        return { groupName: g.name, catalogUrl: groupLink(gid, '/members-catalog'), facebookUrl: g.facebook_url };
      },
    }));
  }
  return catalogCache.get(gid);
}

function checkBirthdaysForGroup(group) {
  const today = zonedToday(group.timezone);
  const todayStr = `${String(today.d).padStart(2, '0')}/${String(today.m).padStart(2, '0')}`;
  const stamp = `${todayStr}/${today.y}`;
  if (db.getGroupSetting(group.id, 'birthday_sent_for') === stamp) return; // once per day per group
  db.setGroupSetting(group.id, 'birthday_sent_for', stamp);

  const members = db.getMembersBirthday(todayStr, group.id);
  for (const member of members) {
    if (!member.phone) continue;
    const msg =
      `🎂 С Днём рождения, ${member.name.split(' ')[0]}!\n\n` +
      `Вся группа ${group.name} поздравляет вас с праздником! 🎉\n` +
      `Желаем процветания бизнесу и здоровья! 🥂`;
    waFor(group.id).sendMessage(member.phone, msg)
      .then(() => console.log(`[Birthday] group ${group.id}: sent to ${member.name}`))
      .catch(err => console.error(`[Birthday] group ${group.id}: failed for ${member.name}:`, err.message));
  }
  if (members.length) console.log(`[Birthday] group ${group.id}: checked ${todayStr}: ${members.length} birthday(s)`);
}
function zonedToday(tz) { const { y, m, d } = groupsService.zonedParts(new Date(), tz); return { y, m, d }; }

const scheduler = require('./services/groupScheduler').createGroupScheduler({
  listGroups: () => groups.listGroups(),
  jobs: [
    { name: 'confirmation-wave-1',   offsetDays: 3, time: '10:00', run: g => wavesFor(g.id).runConfirmationWave(1) },
    { name: 'unconfirmed-list-1',    offsetDays: 3, time: '11:00', run: g => wavesFor(g.id).sendUnconfirmedList(1) },
    { name: 'confirmation-wave-2',   offsetDays: 6, time: '18:00', run: g => wavesFor(g.id).runConfirmationWave(2) },
    { name: 'unconfirmed-list-2',    offsetDays: 6, time: '19:00', run: g => wavesFor(g.id).sendUnconfirmedList(2) },
    { name: 'members-catalog',       offsetDays: 0, time: '10:00', run: g => catalogFor(g.id).runMeetingDayCron() },
    { name: 'birthdays',             daily: true,   time: '09:00', run: g => checkBirthdaysForGroup(g) },
  ],
  log: m => console.log(m),
  logError: m => console.error(m),
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  startWahaWatchdog();
  scheduler.start();
  console.log(`\n🟢 BNI server running on http://localhost:${PORT}`);
  console.log(`   Guest form   : http://localhost:${PORT}/guest`);
  console.log(`   Member form  : http://localhost:${PORT}/member`);
  console.log(`   Voting       : http://localhost:${PORT}/voting`);
  console.log(`   Admin panel  : http://localhost:${PORT}/admin`);
  console.log(`   Test API     : http://localhost:${PORT}/api/test`);
  console.log(`   Next meeting : ${meetingDateFor(GROUP1) || '(not set)'}\n`);
});
