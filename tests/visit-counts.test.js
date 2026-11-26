'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'visits-')), 'test.db');

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeVisitCounts, parseMeetingDate } = require('../services/visitCounts');

const g = (id, phone, meetingDate) => ({ id, phone, meetingDate });

test('one phone in different formats is one person', () => {
  const m = computeVisitCounts([
    g('a', '0501234567', '01/06/26'),
    g('b', '+972501234567', '15/06/26'),
    g('c', '972-50-123-4567', '30/06/26'),
  ]);
  assert.deepEqual(m.get('a'), { visits12m: 0, visitsAll: 0 });
  assert.deepEqual(m.get('b'), { visits12m: 1, visitsAll: 1 });
  assert.deepEqual(m.get('c'), { visits12m: 2, visitsAll: 2 });
});

test('12 month boundary: exactly 12 months back is included, a day earlier is not', () => {
  const m = computeVisitCounts([
    g('old1', '0501234567', '29/11/25'), // one day earlier than the window
    g('old2', '0501234567', '30/11/25'), // exactly 12 months before
    g('cur',  '0501234567', '30/11/26'),
  ]);
  assert.deepEqual(m.get('cur'), { visits12m: 1, visitsAll: 2 });
});

test('second visit two months later = 1 (1); third with the second a year and a day ago = 1 (2)', () => {
  const m = computeVisitCounts([
    g('1', '0541111111', '05/01/25'),
    g('2', '0541111111', '05/03/25'),
    g('3', '0541111111', '04/03/26'),
  ]);
  assert.deepEqual(m.get('1'), { visits12m: 0, visitsAll: 0 });
  assert.deepEqual(m.get('2'), { visits12m: 1, visitsAll: 1 });
  assert.deepEqual(m.get('3'), { visits12m: 1, visitsAll: 2 });
});

test('empty or unrecognised phone gets no counter', () => {
  const m = computeVisitCounts([
    g('e', '', '01/06/26'), g('n', null, '01/06/26'), g('x', '12345', '01/06/26'), g('x2', '12345', '08/06/26'),
  ]);
  assert.equal(m.size, 0);
});

test('current and later records are not counted', () => {
  const m = computeVisitCounts([
    g('past', '0502222222', '01/06/26'),
    g('now',  '0502222222', '08/06/26'),
    g('next', '0502222222', '15/06/26'),
  ]);
  assert.deepEqual(m.get('now'),  { visits12m: 1, visitsAll: 1 });
  assert.deepEqual(m.get('past'), { visits12m: 0, visitsAll: 0 });
});

test('several records on the same date do not count as earlier', () => {
  const m = computeVisitCounts([
    g('a', '0503333333', '01/06/26'),
    g('b', '0503333333', '01/06/26'),
    g('c', '0503333333', '08/06/26'),
  ]);
  assert.deepEqual(m.get('a'), { visits12m: 0, visitsAll: 0 });
  assert.deepEqual(m.get('b'), { visits12m: 0, visitsAll: 0 });
  assert.deepEqual(m.get('c'), { visits12m: 2, visitsAll: 2 });
});

test('date parsing: DD/MM/YY, DD/MM/YYYY; invalid and year-less are rejected; 29 Feb window', () => {
  assert.equal(parseMeetingDate('30/11/26'), Date.UTC(2026, 10, 30));
  assert.equal(parseMeetingDate('30/11/2026'), Date.UTC(2026, 10, 30));
  assert.equal(parseMeetingDate('30/11'), null);
  assert.equal(parseMeetingDate('31/02/26'), null);
  const m = computeVisitCounts([g('p', '0504444444', '28/02/27'), g('q', '0504444444', '29/02/28')]);
  assert.deepEqual(m.get('q'), { visits12m: 1, visitsAll: 1 }); // 29/02/28 window starts 28/02/27
});
