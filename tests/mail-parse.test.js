'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { simpleParser } = require('mailparser');
const m = require('../services/mailIntake');
const { makeResolver, buildMail, bniHtml } = require('./helpers/mail');

const GOOD = {
  name: 'Test   Guest', company: 'Test Ltd', profession: 'Дизайнер интерьеров',
  phones: '0545551234 (משרד),  (נייד)', email: 'guest@example.test',
  invitedBy: 'עו"ד   ארתור   בלאייר', type: 'אורח', date: '20/10/2026',
};
const resolver = makeResolver(['bniconnectglobal.com']);

test('normalizeHebName strips titles, quotes, niqqud and extra spaces', () => {
  const n = m.normalizeHebName;
  assert.equal(n('עו"ד   ארתור  בלאייר'), n('ארתור בלאייר'));
  assert.equal(n('ד״ר דריאן רויטמן'), n('דריאן רויטמן'));
  assert.equal(n('רו"ח משה כהן'), 'משה כהן');
  assert.equal(n('פרופ\' דנה לוי'), 'דנה לוי');
  assert.equal(n("מיכאל טקאץ'"), n('מיכאל טקאץ׳'));
  assert.equal(n('שָׁלוֹם עֲלֵיכֶם'), 'שלום עליכם');
});

test('matchInviter matches by name_he and refuses ambiguity', () => {
  const members = [{ name: 'A', name_he: 'עו"ד ארתור בלאייר' }, { name: 'B', name_he: 'ד"ר דריאן רויטמן' }];
  assert.equal(m.matchInviter('עו״ד ארתור  בלאייר', members).name, 'A');
  assert.equal(m.matchInviter('דריאן רויטמן', members).name, 'B');
  assert.equal(m.matchInviter('מישהו אחר', members), null);
  assert.equal(m.matchInviter('', members), null);
  assert.equal(m.matchInviter('ארתור בלאייר', [...members, { name: 'C', name_he: 'ארתור בלאייר' }]), null);
});

test('PHONE_RE finds mobile numbers in several formats', () => {
  const find = s => (s.match(m.PHONE_RE) || [])[0];
  assert.equal(find('0545884437 (משרד),  (נייד)'), '0545884437');
  assert.equal(find('054-588-4437'), '054-588-4437');
  assert.equal(find('+972 54 588 4437'), '+972 54 588 4437');
  assert.equal(find('03-5551234'), undefined);
  assert.equal(find(''), undefined);
});

test('parseBniHtml extracts fields, normalises whitespace, finds meeting date', async () => {
  const raw = await buildMail({ html: bniHtml(GOOD), messageId: 'p1@test' });
  const parsed = await simpleParser(raw);
  const f = m.parseBniHtml(parsed.html);
  assert.equal(f.name, 'Test Guest');
  assert.equal(f.company, 'Test Ltd');
  assert.equal(f.profession, 'Дизайнер интерьеров');
  assert.match(f.phones, /0545551234/);
  assert.equal(f.email, 'guest@example.test');
  assert.equal(f.invitedBy, 'עו"ד ארתור בלאייר');
  assert.equal(f.type, 'אורח');
  assert.deepEqual(f.meetingDates, ['20/10/26']);
  assert.ok(!Object.values(f).includes('יורי'), 'greeting must not be parsed');
});

test('classify: valid DKIM from BNI -> bni', async () => {
  const raw = await buildMail({ html: bniHtml(GOOD), messageId: 'c1@test' });
  const r = await m.classify(raw, await simpleParser(raw), { resolver });
  assert.equal(r.kind, 'bni');
});

test('classify: BNI From without signature -> rejected', async () => {
  const raw = await buildMail({ html: bniHtml(GOOD), messageId: 'c2@test', sign: false });
  const r = await m.classify(raw, await simpleParser(raw), { resolver });
  assert.equal(r.kind, 'rejected');
});

test('classify: BNI From signed by another domain -> rejected', async () => {
  const raw = await buildMail({ html: bniHtml(GOOD), messageId: 'c3@test', signDomain: 'evil.test' });
  const r = await m.classify(raw, await simpleParser(raw), { resolver: makeResolver(['evil.test']) });
  assert.equal(r.kind, 'rejected');
});

test('classify: tampered body breaks DKIM -> rejected', async () => {
  const raw = await buildMail({ html: bniHtml(GOOD), messageId: 'c4@test' });
  const tampered = Buffer.from(raw.toString('utf8').replace(/\r\n\r\n/, '\r\n\r\nAAAA'));
  const r = await m.classify(tampered, await simpleParser(tampered), { resolver });
  assert.equal(r.kind, 'rejected');
});

test('classify: wrong subject from BNI address -> rejected; foreign From -> other', async () => {
  let raw = await buildMail({ html: bniHtml(GOOD), messageId: 'c5@test', subject: 'something else' });
  assert.equal((await m.classify(raw, await simpleParser(raw), { resolver })).kind, 'rejected');
  raw = await buildMail({ html: bniHtml(GOOD), messageId: 'c6@test', from: 'Evil <x@evil.test>', signDomain: 'evil.test' });
  assert.equal((await m.classify(raw, await simpleParser(raw), { resolver })).kind, 'other');
});
