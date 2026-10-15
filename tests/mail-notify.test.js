'use strict';

// Default stage: BNI emails only produce a WhatsApp notification to the manager.
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-notify-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.MAIL_INTAKE_DIR = path.join(tmp, 'mail');

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../services/db');
const intake = require('../services/mailIntake');
const { makeResolver, buildMail, bniHtml } = require('./helpers/mail');

const MANAGER = '972523695741';
const sent = [];
let failSend = false;
const created = [];
const deps = {
  db, resolver: makeResolver(['bniconnectglobal.com']),
  nextMeetingDate: () => '19/10/26',
  afterCreate: g => created.push(g),
  autoRegister: () => db.getSetting('mail_intake_auto_register') === '1',
  notifyPhone: () => MANAGER,
  sendMessage: async (phone, text) => { if (failSend) throw new Error('Session status is not as expected'); sent.push([phone, text]); },
};
const run = raw => intake.handleIncomingMail(raw, deps);
const row = id => db.db.prepare('SELECT * FROM mail_intake WHERE message_id = ?').get(`<${id}>`);
const countGuests = () => db.db.prepare('SELECT COUNT(*) c FROM guests').get().c;

function ensureMember(name, name_he) {
  const r = db.db.prepare('SELECT id FROM members WHERE name = ?').get(name);
  if (r) db.db.prepare('UPDATE members SET name_he = ?, active = 1 WHERE id = ?').run(name_he, r.id);
  else db.insertMember({ name, name_he });
}
ensureMember('Артур Блаер', 'עו"ד ארתור בלאייר');
ensureMember('Александр Кудинов, д-р', 'ד"ר אלכסנדר קודינוב');

const GUEST = {
  name: 'Test   Guest', company: 'Test Ltd', profession: 'Дизайнер интерьеров',
  phones: '0545551234 (משרד),  (נייד)', email: 'guest@example.test',
  invitedBy: 'עו"ד   ארתור   בלאייר', type: 'אורח', date: '20/10/2026',
};
const SUB = {
  name: 'דנה כהן', company: 'חברה לדוגמה', profession: 'רואת חשבון',
  phones: '052-555-9876 (נייד)', email: 'dana@example.test',
  invitedBy: 'ד״ר אלכסנדר קודינוב', type: 'ממלא מקום', date: '20/10/2026',
};

test('guest sample: one notification to the manager, recognised fields, no guest created', async () => {
  const before = countGuests();
  const out = await run(await buildMail({ html: bniHtml(GUEST), messageId: 'n1@test' }));
  assert.equal(out.status, 'notified');
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], MANAGER);
  assert.equal(sent[0][1],
    '📩 Новый гость из BNI Connect\n\n' +
    'Тип: Гость\n' +
    'Имя: Test Guest\n' +
    'Телефон: 972545551234\n' +
    'Компания / профессия: Test Ltd / Дизайнер интерьеров\n' +
    'Пригласил: Артур Блаер\n' +
    'Встреча: 20/10/2026');
  assert.equal(countGuests(), before);
  assert.equal(created.length, 0);
  const r = row('n1@test');
  assert.equal(r.status, 'notified');
  assert.ok(r.notified_at);
  assert.equal(JSON.parse(r.parsed_json).phone, '972545551234');
});

test('substitute sample (Hebrew): type Замена, inviter with ד״ר matched', async () => {
  const out = await run(await buildMail({ html: bniHtml(SUB), messageId: 'n2@test' }));
  assert.equal(out.status, 'notified');
  const text = sent.at(-1)[1];
  assert.match(text, /Тип: Замена\n/);
  assert.match(text, /Имя: דנה כהן\n/);
  assert.match(text, /Телефон: 972525559876\n/);
  assert.match(text, /Пригласил: Александр Кудинов, д-р\n/);
});

test('same message again -> duplicate, no second notification', async () => {
  const n = sent.length;
  const out = await run(await buildMail({ html: bniHtml(GUEST), messageId: 'n1@test' }));
  assert.equal(out.status, 'duplicate');
  assert.equal(sent.length, n);
});

test('same guest in a new letter (phone + date) -> duplicate, no notification', async () => {
  const n = sent.length;
  const out = await run(await buildMail({ html: bniHtml(GUEST), messageId: 'n1-again@test' }));
  assert.equal(out.status, 'duplicate');
  assert.equal(sent.length, n);
  assert.equal(row('n1-again@test').status, 'duplicate');
});

test('same phone but another meeting date is a new notification', async () => {
  const n = sent.length;
  await run(await buildMail({ html: bniHtml({ ...GUEST, date: '27/10/2026' }), messageId: 'n1-next@test' }));
  assert.equal(sent.length, n + 1);
  assert.match(sent.at(-1)[1], /Встреча: 27\/10\/2026/);
});

test('warnings: unknown inviter, undefined type, no phone, empty fields', async () => {
  const html = bniHtml({ ...GUEST, name: '', company: '', profession: '', phones: '(משרד), (נייד)', invitedBy: 'מישהו לא ידוע', type: '' });
  await run(await buildMail({ html, messageId: 'w1@test' }));
  const text = sent.at(-1)[1];
  assert.match(text, /Тип: Не определён ⚠️\n/);
  assert.match(text, /Имя: —\n/);
  assert.match(text, /Телефон: — ⚠️ нет в письме\n/);
  assert.match(text, /Компания \/ профессия: — \/ —\n/);
  assert.match(text, /Пригласил: מישהו לא ידוע ⚠️ не найден в списке\n/);
});

test('WhatsApp unavailable: notify_failed, nothing lost; a later retry of the same guest is notified', async () => {
  failSend = true;
  const html = bniHtml({ ...GUEST, name: 'Retry Guest', phones: '0545550077' });
  const out = await run(await buildMail({ html, messageId: 'f1@test' }));
  assert.equal(out.status, 'notify_failed');
  const r = row('f1@test');
  assert.equal(r.status, 'notify_failed');
  assert.equal(r.notified_at, null);
  assert.ok(r.raw_path && fs.existsSync(r.raw_path));
  failSend = false;
  const again = await run(await buildMail({ html, messageId: 'f1-retry@test' }));
  assert.equal(again.status, 'notified');
});

test('forged BNI mail and foreign mail: no notification, rejected/ file kept', async () => {
  const n = sent.length;
  const forged = await run(await buildMail({ html: bniHtml(GUEST), messageId: 'x1@test', sign: false }));
  assert.equal(forged.status, 'rejected');
  assert.match(row('x1@test').raw_path, /\/rejected\//);
  const foreign = await run(await buildMail({ html: bniHtml(GUEST), messageId: 'x2@test', from: 'Evil <x@evil.test>', signDomain: 'evil.test' }));
  assert.equal(foreign.status, 'ignored');
  assert.equal(sent.length, n);
  assert.equal(countGuests(), 0);
});

test('mail_intake_auto_register=1 keeps the old behaviour available (creates guest, no manager notification)', async () => {
  db.setSetting('mail_intake_auto_register', '1');
  const n = sent.length;
  const out = await run(await buildMail({ html: bniHtml({ ...GUEST, name: 'Auto Guest', phones: '0545550088' }), messageId: 'a1@test' }));
  assert.equal(out.status, 'created');
  assert.equal(sent.length, n);
  assert.equal(created.length, 1);
  db.setSetting('mail_intake_auto_register', '0');
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
