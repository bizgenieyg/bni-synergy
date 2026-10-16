'use strict';

// BNI emails -> invitation messages (branches A/B/C, modes test/prod). Needs better-sqlite3.
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-invite-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.MAIL_INTAKE_DIR = path.join(tmp, 'mail');

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../services/db');
const intake = require('../services/mailIntake');
const { makeResolver, buildMail, bniHtml } = require('./helpers/mail');

const MANAGER = '972523695741';
const sent = [];                     // [to, texts[]]
let mode = 'test';
let failSend = false;
let existsFn = () => true;
const guestsBefore = () => db.db.prepare('SELECT COUNT(*) c FROM guests').get().c;

const deps = {
  db, resolver: makeResolver(['bniconnectglobal.com']),
  nextMeetingDate: () => '19/10/26',
  mode: () => mode,
  notifyPhone: () => MANAGER,
  isPast: d => d === '01/01/20',
  checkWhatsApp: async phone => existsFn(phone),
  sendSequence: async (to, texts) => { if (failSend) throw new Error('Session status is not as expected'); sent.push([to, texts]); },
  buildInvite: g => `INVITE:${g.name}:${g.meetingDate}`,
  buildMemberRequest: g => `REQ:${g.memberName}:${g.guestName}`,
};
const run = raw => intake.handleIncomingMail(raw, deps);
const row = id => db.db.prepare('SELECT * FROM mail_intake WHERE message_id = ?').get(`<${id}>`);
const last = () => sent.at(-1);

function ensureMember(name, name_he, phone) {
  const r = db.db.prepare('SELECT id FROM members WHERE name = ?').get(name);
  if (r) db.db.prepare('UPDATE members SET name_he = ?, phone = ?, active = 1 WHERE id = ?').run(name_he, db.normalizePhone(phone), r.id);
  else db.insertMember({ name, name_he, phone });
}
ensureMember('Артур Блаер', 'עו"ד ארתור בלאייר', '0501110001');
ensureMember('Александр Кудинов, д-р', 'ד"ר אלכסנדר קודינוב', '');

const G = {
  name: 'Test   Guest', company: 'Test Ltd', profession: 'Дизайнер',
  phones: '0545551234 (משרד),  (נייד)', email: 'guest@example.test',
  invitedBy: 'עו"ד   ארתור   בלאייר', type: 'אורח', date: '20/10/2026',
};
const mail = (over, id) => buildMail({ html: bniHtml({ ...G, ...over }), messageId: id });

test('A (test mode): guest has WhatsApp -> ONE message, to the manager, with the service line', async () => {
  const out = await run(await mail({}, 'a1@test'));
  assert.equal(out.status, 'sent_test');
  assert.equal(out.branch, 'A');
  assert.equal(sent.length, 1);
  assert.equal(last()[0], MANAGER);
  assert.deepEqual(last()[1], ['🧪 ТЕСТ → гость | Гость | Пригласил: Артур Блаер\nINVITE:Test Guest:20/10/26']);
  const r = row('a1@test');
  assert.equal(r.status, 'sent_test');
  assert.equal(JSON.parse(r.parsed_json).branch, 'A');
  assert.equal(guestsBefore(), 0);
});

test('B (test mode): no phone in the letter -> two messages in order (request, invitation)', async () => {
  await run(await mail({ name: 'No Phone', phones: '(משרד), (נייד)' }, 'b1@test'));
  const [to, texts] = last();
  assert.equal(to, MANAGER);
  assert.equal(texts.length, 2);
  const line = '🧪 ТЕСТ → участник Артур, 972501110001 | Гость | Пригласил: Артур Блаер';
  assert.deepEqual(texts, [`${line}\nREQ:Артур:No Phone`, `${line}\nINVITE:No Phone:20/10/26`]);
});

test('B: number not in WhatsApp (numberExists=false) and failed check both go to branch B', async () => {
  existsFn = () => false;
  const o1 = await run(await mail({ name: 'Not In WA', phones: '0545550010' }, 'b2@test'));
  assert.equal(o1.branch, 'B');
  existsFn = () => { throw new Error('WAHA down'); };
  const o2 = await run(await mail({ name: 'Check Fails', phones: '0545550011' }, 'b3@test'));
  assert.equal(o2.branch, 'B');
  assert.equal(JSON.parse(row('b3@test').parsed_json).numberExists, null);
  existsFn = () => true;
});

test('C: inviter not found, or found without phone -> two messages to the manager, flagged', async () => {
  await run(await mail({ name: 'Unknown Inviter', phones: '', invitedBy: 'מישהו לא ידוע' }, 'c1@test'));
  let [to, texts] = last();
  assert.equal(to, MANAGER);
  assert.equal(texts.length, 2);
  assert.match(texts[0], /^🧪 ТЕСТ → участник מישהו לא ידוע \(не найден в списке ⚠️\) \| Гость \| Пригласил: מישהו לא ידוע ⚠️\n/);

  await run(await mail({ name: 'No Member Phone', phones: '', invitedBy: 'ד"ר אלכסנדר קודינוב', type: 'ממלא מקום' }, 'c2@test'));
  [to, texts] = last();
  assert.match(texts[0], /^🧪 ТЕСТ → участник Александр \(нет телефона ⚠️\) \| Замена \| Пригласил: Александр Кудинов, д-р\n/);
  assert.equal(JSON.parse(row('c2@test').parsed_json).branch, 'C');
});

test('phones: landline-only is accepted, mobile 05x beats a landline', async () => {
  existsFn = p => p === '972545550020';
  await run(await mail({ name: 'Mixed', phones: '03-555-1234, 054-555-0020' }, 'p1@test'));
  assert.equal(JSON.parse(row('p1@test').parsed_json).phone, '972545550020');
  assert.equal(JSON.parse(row('p1@test').parsed_json).branch, 'A');
  existsFn = () => false;
  await run(await mail({ name: 'Landline', phones: '03-555-1235' }, 'p2@test'));
  assert.equal(JSON.parse(row('p2@test').parsed_json).phone, '97235551235');
  assert.equal(JSON.parse(row('p2@test').parsed_json).branch, 'B');
  existsFn = () => true;
  assert.deepEqual(intake.pickPhone('072-123-4567', db).all, ['972721234567']);
});

test('duplicates: same Message-ID and same guest (phone + date) send nothing', async () => {
  const n = sent.length;
  assert.equal((await run(await mail({}, 'a1@test'))).status, 'duplicate');
  assert.equal((await run(await mail({}, 'a1-again@test'))).status, 'duplicate');
  assert.equal(sent.length, n);
});

test('meeting date in the past: nothing is sent', async () => {
  const n = sent.length;
  const out = await run(await mail({ name: 'Past', phones: '0545550030', date: '01/01/2020' }, 'past@test'));
  assert.equal(out.status, 'skipped_past');
  assert.equal(sent.length, n);
});

test('WhatsApp unavailable: send_failed, letter saved; a retry of the same guest is sent', async () => {
  failSend = true;
  const out = await run(await mail({ name: 'Retry', phones: '0545550040' }, 'f1@test'));
  assert.equal(out.status, 'send_failed');
  assert.equal(row('f1@test').status, 'send_failed');
  assert.ok(fs.existsSync(row('f1@test').raw_path));
  failSend = false;
  assert.equal((await run(await mail({ name: 'Retry', phones: '0545550040' }, 'f1-retry@test'))).status, 'sent_test');
});

test('prod mode: A -> guest, B -> member (no service line), C -> manager with ⚠️; test records do not block prod', async () => {
  mode = 'prod';
  const before = sent.length;
  // same guest as the first test (already sent in test mode) must now be sent for real
  assert.equal((await run(await mail({}, 'pa@test'))).status, 'sent_guest');
  assert.deepEqual(last(), ['972545551234', ['INVITE:Test Guest:20/10/26']]);

  assert.equal((await run(await mail({ name: 'Prod B', phones: '' }, 'pb@test'))).status, 'sent_member');
  assert.deepEqual(last(), ['972501110001', ['REQ:Артур:Prod B', 'INVITE:Prod B:20/10/26']]);

  assert.equal((await run(await mail({ name: 'Prod C', phones: '', invitedBy: 'מישהו לא ידוע' }, 'pc@test'))).status, 'sent_fallback');
  const [to, texts] = last();
  assert.equal(to, MANAGER);
  assert.match(texts[0], /^⚠️ ПЕРЕШЛИТЕ ВРУЧНУЮ → участник מישהו לא ידוע \(не найден в списке ⚠️\) \| Гость \| Пригласил: מישהו לא ידוע ⚠️\nREQ:/);
  assert.equal(sent.length, before + 3);

  // repeated letter in prod: nothing
  assert.equal((await run(await mail({}, 'pa-again@test'))).status, 'duplicate');
  mode = 'test';
});

test('forged / foreign mail: nothing sent, rejected/ file kept, no guests', async () => {
  const n = sent.length;
  const forged = await run(await buildMail({ html: bniHtml(G), messageId: 'x1@test', sign: false }));
  assert.equal(forged.status, 'rejected');
  assert.match(row('x1@test').raw_path, /\/rejected\//);
  const foreign = await run(await buildMail({ html: bniHtml(G), messageId: 'x2@test', from: 'Evil <x@evil.test>', signDomain: 'evil.test' }));
  assert.equal(foreign.status, 'ignored');
  assert.equal(sent.length, n);
  assert.equal(guestsBefore(), 0);
});

test('one log line per letter with masked recipient', async () => {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try { await run(await mail({ name: 'Log Guest', phones: '0545550050' }, 'log@test')); }
  finally { console.log = orig; }
  assert.ok(logs.some(l => l === '[MailIntake] branch=A mode=test to=972***5741 status=sent_test'), logs.join('\n'));
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
