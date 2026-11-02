'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-'));
process.env.DB_PATH = path.join(tmp, 'test.db');

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../services/db');
const { createCatalog, FACEBOOK_BLOCK } = require('../services/catalogBroadcast');

const TODAY = '02/11/26';
const sent = [];
let status = 'WORKING';
let failSends = false;
const whatsapp = {
  getFirstName: n => (n || 'Гость').trim().split(' ')[0],
  sendWithDelay: async (recipients, fn) => {
    if (failSends) return { sent: 0, failed: recipients.length, errors: [] };
    for (const r of recipients) sent.push([r.phone, fn(r)]);
    return { sent: recipients.length, failed: 0, errors: [] };
  },
};
const catalog = createCatalog({ db, whatsapp, getTodayStr: () => TODAY, getSessionStatus: async () => status });

const add = (name, phone, meetingDate, waEnabled = 1) => db.insertGuest({ name, phone, meetingDate, waEnabled });
add('Alice A', '0541000001', TODAY);
add('Bob B', '0541000002', TODAY, 0);
add('Carl C', '0541000003', '09/11/26');

test('text: Facebook block sits between the catalog link and the closing line', () => {
  const t = catalog.buildCatalogMessage({ name: 'Alice A' });
  assert.ok(t.includes('https://www.facebook.com/share/g/1PXaN6Uxgg/'));
  assert.ok(t.includes(
    'https://bnisynergy.biz/members-catalog\n\n' + FACEBOOK_BLOCK + '\n\nБудем рады видеть вас снова! 😊\nКоманда BNI SYNERGY'));
  assert.ok(t.startsWith('Здравствуйте, Alice! 👋\n\nРады были видеть вас сегодня'));
});

test('cron: only today\'s guests with WhatsApp, marks the setting, second run does not duplicate', async () => {
  await catalog.runMondayCron();
  assert.deepEqual(sent.map(s => s[0]), ['972541000001']);
  assert.equal(db.getSetting('catalog_sent_for'), TODAY);
  await catalog.runMondayCron();
  assert.equal(sent.length, 1);
});

test('cron: session not WORKING -> nothing sent, setting not set', async () => {
  db.setSetting('catalog_sent_for', '');
  status = 'FAILED';
  sent.length = 0;
  await catalog.runMondayCron();
  assert.equal(sent.length, 0);
  assert.ok(!db.getSetting('catalog_sent_for'));
  status = 'WORKING';
});

test('cron: all sends failed -> setting not set, retry stays possible', async () => {
  failSends = true;
  await catalog.runMondayCron();
  assert.ok(!db.getSetting('catalog_sent_for'));
  failSends = false;
});

test('cron: no guests today -> nothing sent', async () => {
  const c = createCatalog({ db, whatsapp, getTodayStr: () => '03/11/26', getSessionStatus: async () => status });
  sent.length = 0;
  await c.runMondayCron();
  assert.equal(sent.length, 0);
});

test('manual: other date does not touch catalog_sent_for; today does', async () => {
  db.setSetting('catalog_sent_for', '');
  await catalog.sendManual('09/11/26');
  assert.ok(!db.getSetting('catalog_sent_for'));
  await catalog.sendManual(TODAY);
  assert.equal(db.getSetting('catalog_sent_for'), TODAY);
});
