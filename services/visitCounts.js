'use strict';

// Visit counters for the guests table. Pure: takes guest rows, returns a Map
// id -> { visits12m, visitsAll }. A guest is matched across records by the
// normalized phone; counts are distinct meeting dates (no "attended" flag exists); a record is a visit.

// "DD/MM/YY" or "DD/MM/YYYY" -> UTC midnight timestamp, or null if unparseable
// (including "DD/MM" without a year, where the year cannot be known).
function parseMeetingDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const day = +m[1], month = +m[2];
  const year = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  const t = Date.UTC(year, month - 1, day);
  const d = new Date(t);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return t;
}

// Same day-of-month 12 months earlier; 29 Feb -> 28 Feb of the previous year.
function twelveMonthsBefore(t) {
  const d = new Date(t);
  const y = d.getUTCFullYear() - 1, mo = d.getUTCMonth(), day = d.getUTCDate();
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return Date.UTC(y, mo, Math.min(day, last));
}

function lowerBound(arr, x) { // first index with arr[i] >= x
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

function upperBound(arr, x) { // first index with arr[i] > x
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= x) lo = mid + 1; else hi = mid; }
  return lo;
}

// A record is itself a visit. For a row R: visitsAll = number of DISTINCT meeting
// dates of the same phone that are not later than R's date (R included);
// visits12m = those not earlier than 12 months before R's date (inclusive).
function computeVisitCounts(guests, normalize = require('./db').normalizePhone) {
  const result = new Map();
  const dates = new Map(); // phone -> Set of timestamps
  const rows = [];

  for (const g of guests) {
    const phone = normalize(g.phone);
    const t = parseMeetingDate(g.meetingDate);
    if (!/^972\d{9}$/.test(phone) || t === null) continue; // unrecognised phone / date: no counter
    rows.push({ id: g.id, phone, t });
    if (!dates.has(phone)) dates.set(phone, new Set());
    dates.get(phone).add(t);
  }
  const sorted = new Map();
  for (const [phone, set] of dates) sorted.set(phone, [...set].sort((a, b) => a - b));

  for (const r of rows) {
    const arr = sorted.get(r.phone);
    const upto = upperBound(arr, r.t);                       // distinct dates <= R
    const from = lowerBound(arr, twelveMonthsBefore(r.t));   // dates >= R - 12 months
    result.set(r.id, { visits12m: upto - from, visitsAll: upto });
  }
  return result;
}

module.exports = { computeVisitCounts, parseMeetingDate };
