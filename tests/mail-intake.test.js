'use strict';

// Auto-register mode (setting mail_intake_auto_register=1). Needs better-sqlite3 (run on a machine where it is built, e.g. the server).
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-intake-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.MAIL_INTAKE_DIR = path.join(tmp, 'mail');

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../services/db');
const intake = require('../services/mailIntake');
const { makeResolver, buildMail, bniHtml } = require('./helpers/mail');

const resolver = makeResolver(['bniconnectglobal.com']);
const created = [];
const deps = { db, resolver, nextMeetingDate: () => '19/10/26', afterCreate: g => created.push(g), autoRegister: () => true };
const run = raw => intake.handleIncomingMail(raw, deps);
const guestRow = id => db.db.prepare('SELECT * FROM guests WHERE id = ?').get(id);
const countGuests = () => db.db.prepare('SELECT COUNT(*) c FROM guests').get().c;

function ensureMember(name, name_he) {
  const row = db.db.prepare('SELECT id FROM members WHERE name = ?').get(name);
  if (row) db.db.prepare('UPDATE members SET name_he = ?, active = 1 WHERE id = ?').run(name_he, row.id);
  else db.insertMember({ name, name_he });
}
ensureMember('Артур Блаер', 'עו"ד ארתור בלאייר');
ensureMember('Александр Кудинов, д-р', 'ד"ר אלכסנדר קודינוב');

const SAMPLE_GUEST = {
  name: 'Test   Guest', company: 'Test Ltd', profession: 'Дизайнер интерьеров',
  phones: '0545551234 (משרד),  (נייד)', email: 'guest@example.test',
  invitedBy: 'עו"ד   ארתור   בלאייר', type: 'אורח', date: '20/10/2026',
};
const SAMPLE_SUB = {
  name: 'דנה כהן', company: 'חברה לדוגמה', profession: 'רואת חשבון',
  phones: '052-555-9876 (נייד)', email: 'dana@example.test',
  invitedBy: 'ד״ר אלכסנדר קודינוב', type: 'ממלא מקום', date: '20/10/2026',
};

test('guest sample (Cyrillic): created with all fields, inviter matched by name_he', async () => {
  const out = await run(await buildMail({ html: bniHtml(SAMPLE_GUEST), messageId: 'g1@test' }));
  assert.equal(out.status, 'created');
  const g = guestRow(out.guestId);
  assert.equal(g.name, 'Test Guest');
  assert.equal(g.phone, '972545551234');
  assert.equal(g.specialty, 'Дизайнер интерьеров');
  assert.equal(g.email, 'guest@example.test');
  assert.equal(g.invitedBy, 'Артур Блаер');
  assert.equal(g.meetingDate, '20/10/26');
  assert.equal(g.paid, 0);
  assert.equal(g.guest_type, 'guest');
  assert.equal(g.wa_enabled, 1);
  assert.equal(g.source, 'bni_email');
  assert.equal(g.needs_review, 0);
  assert.equal(created.at(-1).id, g.id);
  assert.equal(created.at(-1).isSub, false);
});

test('substitute sample (Hebrew): paid=1, inviter with ד"ר matched', async () => {
  const out = await run(await buildMail({ html: bniHtml(SAMPLE_SUB), messageId: 's1@test' }));
  assert.equal(out.status, 'created');
  const g = guestRow(out.guestId);
  assert.equal(g.name, 'דנה כהן');
  assert.equal(g.paid, 1);
  assert.equal(g.guest_type, 'sub');
  assert.equal(g.phone, '972525559876');
  assert.equal(g.invitedBy, 'Александр Кудинов, д-р');
  assert.equal(g.needs_review, 0);
  assert.equal(created.at(-1).isSub, true);
});

test('same message again -> duplicate, nothing created', async () => {
  const before = countGuests(), calls = created.length;
  const out = await run(await buildMail({ html: bniHtml(SAMPLE_GUEST), messageId: 'g1@test' }));
  assert.equal(out.status, 'duplicate');
  assert.equal(countGuests(), before);
  assert.equal(created.length, calls);
});

test('same guest, new Message-ID -> merged by phone+date, no new guest, no new WhatsApp', async () => {
  const before = countGuests(), calls = created.length;
  const out = await run(await buildMail({ html: bniHtml(SAMPLE_GUEST), messageId: 'g1-again@test' }));
  assert.equal(out.status, 'merged');
  assert.equal(countGuests(), before);
  assert.equal(created.length, calls);
});

test('merge fills only empty fields of an existing guest', async () => {
  const id = db.insertGuest({ name: 'Existing One', phone: '0535550001', specialty: '', invitedBy: '', meetingDate: '20/10/26', email: '' });
  const html = bniHtml({ ...SAMPLE_GUEST, name: 'Other Name', phones: '053-555-0001', profession: 'Юрист' });
  const out = await run(await buildMail({ html, messageId: 'm1@test' }));
  assert.equal(out.status, 'merged');
  const g = guestRow(id);
  assert.equal(g.name, 'Existing One');
  assert.equal(g.specialty, 'Юрист');
  assert.equal(g.invitedBy, 'Артур Блаер');
});

test('no phone -> guest created without WhatsApp and flagged', async () => {
  const html = bniHtml({ ...SAMPLE_GUEST, name: 'No Phone', phones: '(משרד), (נייד)' });
  const out = await run(await buildMail({ html, messageId: 'np@test' }));
  const g = guestRow(out.guestId);
  assert.equal(g.phone, '');
  assert.equal(g.wa_enabled, 0);
  assert.equal(g.needs_review, 1);
  assert.equal(created.at(-1).waEnabled, 0);
});

test('unknown inviter keeps raw text and flags review; unknown type flags review', async () => {
  let html = bniHtml({ ...SAMPLE_GUEST, name: 'Inv Unknown', phones: '0545550002', invitedBy: 'מישהו לא ידוע' });
  let g = guestRow((await run(await buildMail({ html, messageId: 'iu@test' }))).guestId);
  assert.equal(g.invitedBy, 'מישהו לא ידוע');
  assert.equal(g.needs_review, 1);
  html = bniHtml({ ...SAMPLE_GUEST, name: 'Type Empty', phones: '0545550003', type: '' });
  g = guestRow((await run(await buildMail({ html, messageId: 'te@test' }))).guestId);
  assert.equal(g.needs_review, 1);
  assert.equal(g.paid, 0);
});

test('missing meeting date falls back to next meeting and flags review', async () => {
  const html = bniHtml({ ...SAMPLE_GUEST, name: 'No Date', phones: '0545550004' }).replace(/בתאריך/g, 'ב');
  const g = guestRow((await run(await buildMail({ html, messageId: 'nd@test' }))).guestId);
  assert.equal(g.meetingDate, '19/10/26');
  assert.equal(g.needs_review, 1);
});

test('forged BNI mail (no DKIM) is rejected, saved under rejected/, no guest', async () => {
  const before = countGuests();
  const out = await run(await buildMail({ html: bniHtml({ ...SAMPLE_GUEST, name: 'Forged One', phones: '0545550005' }), messageId: 'f1@test', sign: false }));
  assert.equal(out.status, 'rejected');
  assert.equal(countGuests(), before);
  const row = db.db.prepare("SELECT * FROM mail_intake WHERE message_id = '<f1@test>'").get();
  assert.equal(row.status, 'rejected');
  assert.match(row.raw_path, /\/rejected\//);
  assert.ok(fs.existsSync(row.raw_path));
});

test('Gmail forwarding confirmation: saved, ignored, code and link are logged', async () => {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    const raw = Buffer.from(
      'From: Gmail Team <forwarding-noreply@google.com>\r\nTo: guests@in.bnisynergy.biz\r\n' +
      'Subject: Gmail Forwarding Confirmation - Receive Mail from someone@example.test\r\n' +
      'Message-ID: <gmail1@test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n' +
      'someone@example.test has requested to automatically forward mail to your email address guests@in.bnisynergy.biz.\r\n' +
      'Confirmation code: 123456789\r\n\r\nTo allow this request, please click the link below:\r\n' +
      'https://mail-settings.google.com/mail/vf-%5BABC%5D-XYZ\r\n');
    const out = await run(raw);
    assert.equal(out.status, 'ignored');
  } finally { console.log = orig; }
  const joined = logs.join('\n');
  assert.match(joined, /Gmail Forwarding Confirmation/);
  assert.match(joined, /123456789/);
  assert.match(joined, /mail-settings\.google\.com/);
  const row = db.db.prepare("SELECT * FROM mail_intake WHERE message_id = '<gmail1@test>'").get();
  assert.ok(row.raw_path && fs.existsSync(row.raw_path));
  assert.doesNotMatch(row.raw_path, /rejected/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
