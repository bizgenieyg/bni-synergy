'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'waves-'));
process.env.DB_PATH = path.join(tmp, 'test.db');

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../services/db');
const { createWaves } = require('../services/confirmationWaves');

const MEETING = '20/10/26';
let today = '15/10/26';
const sent = [];       // [phone, text] from sendWithDelay
const direct = [];     // [phone, text] from sendMessage (manager list)
const whatsapp = {
  sendWithDelay: async (recipients, fn) => { for (const r of recipients) sent.push([r.phone, fn(r)]); return { sent: recipients.length, failed: 0, errors: [] }; },
  sendMessage: async (phone, text) => { direct.push([phone, text]); },
};
const waves = createWaves({
  db, whatsapp,
  buildConfirmationMessage: g => `CONFIRM ${g.id}`,
  getTodayStr: () => today,
  formatMeetingDate: d => d,
  getNextMeeting: () => db.getSetting('next_meeting_date'),
});

const add = (name, phone, extra = {}) => {
  const id = db.insertGuest({ name, phone, meetingDate: extra.meetingDate || MEETING, waEnabled: extra.waEnabled ?? 1 });
  if (extra.confirmed) db.markConfirmed(id);
  return id;
};

db.setSetting('next_meeting_date', MEETING);
db.setSetting('unconfirmed_notify_phone', '0501112233');
const a = add('Alice A', '0541000001');
const b = add('Bob B', '0541000002', { confirmed: true });
add('Carl C', '0541000003', { waEnabled: 0 });
const d = add('Dina D', '0541000004');
add('Eve E', '0541000005', { meetingDate: '27/10/26' });

test('wave 1: only unconfirmed guests with WhatsApp of the next meeting, own state keys', async () => {
  await waves.runConfirmationWave(1);
  assert.deepEqual(sent.map(x => x[1]).sort(), [`CONFIRM ${a}`, `CONFIRM ${d}`].sort());
  assert.equal(db.getSetting('confirmation_round1_for'), MEETING);
  assert.equal(db.getSetting('confirmation_round1_date'), today);
  assert.equal(db.getSetting('confirmation_round2_date'), null);
});

test('wave 1 does not repeat on the same day', async () => {
  const n = sent.length;
  await waves.runConfirmationWave(1);
  assert.equal(sent.length, n);
});

test('wave 2 is not blocked by wave 1 and targets everyone still unconfirmed', async () => {
  const n = sent.length;
  db.markConfirmed(a);                       // Alice confirms between the waves
  const late = add('Late L', '0541000006');  // registers after wave 1
  await waves.runConfirmationWave(2);
  const texts = sent.slice(n).map(x => x[1]).sort();
  assert.deepEqual(texts, [`CONFIRM ${d}`, `CONFIRM ${late}`].sort());
  assert.equal(db.getSetting('confirmation_round2_for'), MEETING);
  assert.equal(db.getSetting('confirmation_round2_date'), today);
});

test('manager list after a wave: unconfirmed only, greeting by wave, skipped if wave did not run today', async () => {
  direct.length = 0;
  await waves.sendUnconfirmedList(1);
  assert.equal(direct.length, 1);
  assert.equal(direct[0][0], '0501112233');
  assert.match(direct[0][1], /^Добрый день! /);
  assert.match(direct[0][1], /Dina D/);
  assert.match(direct[0][1], /Late L/);
  assert.doesNotMatch(direct[0][1], /Alice A|Bob B|Carl C|Eve E/);
  await waves.sendUnconfirmedList(2);
  assert.match(direct[1][1], /^Добрый вечер! /);

  today = '16/10/26';                         // next day: no wave ran today
  await waves.sendUnconfirmedList(1);
  await waves.sendUnconfirmedList(2);
  assert.equal(direct.length, 2);
});

test('no list when everyone confirmed; wave with no guests logs zero and does not throw', async () => {
  for (const g of db.getGuestsByDate(MEETING)) db.markConfirmed(g.id);
  today = '17/10/26';
  await waves.runConfirmationWave(1);
  const n = direct.length;
  await waves.sendUnconfirmedList(1);
  assert.equal(direct.length, n);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
