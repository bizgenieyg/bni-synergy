'use strict';

// Group-level data and rules: settings of a group, next meeting date, positions, notification recipient.
// `dbm` is the services/db module (needs .db and .getSetting).

const DEFAULT_GROUP_ID = 1;

// ─── Next meeting date ────────────────────────────────────────────────────────

// Local calendar parts of `now` in the given IANA time zone.
function zonedParts(now, tz) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz || 'Asia/Jerusalem', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hourCycle: 'h23', hour: 'numeric', minute: 'numeric',
  });
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { y: +p.year, m: +p.month, d: +p.day, dow, minutes: (+p.hour) * 60 + (+p.minute) };
}

/**
 * Date (DD/MM/YY) of the group's nearest meeting.
 * On the meeting day it is today (the whole day); from the next day it is the same weekday of the next week.
 * `time` ("HH:MM") is accepted for the schedule record; the switch happens at the day boundary in `tz`.
 * Returns null when the weekday is not set.
 */
function nextMeetingDate(now, weekday, time, tz) { // eslint-disable-line no-unused-vars
  if (weekday === null || weekday === undefined || weekday === '' || !(weekday >= 0 && weekday <= 6)) return null;
  const { y, m, d, dow } = zonedParts(now instanceof Date ? now : new Date(now), tz);
  const add = (Number(weekday) - dow + 7) % 7;
  const t = new Date(Date.UTC(y, m - 1, d + add));
  const p = n => String(n).padStart(2, '0');
  return `${p(t.getUTCDate())}/${p(t.getUTCMonth() + 1)}/${p(t.getUTCFullYear() % 100)}`;
}

// ─── Groups ───────────────────────────────────────────────────────────────────

function createGroups(dbm, { now = () => new Date(), log = console.warn } = {}) {
  const db = dbm.db;

  const getGroup = id => db.prepare('SELECT * FROM groups WHERE id = ?').get(id) || null;
  const getGroupBySlug = slug => db.prepare('SELECT * FROM groups WHERE slug = ?').get(String(slug || '')) || null;
  const listGroups = () => db.prepare('SELECT * FROM groups ORDER BY id').all();
  const groupOfMember = memberId => {
    const r = db.prepare('SELECT group_id FROM members WHERE id = ?').get(Number(memberId));
    return r ? r.group_id : null;
  };

  const URL_FIELDS = ['waze_url', 'zoom_url', 'payment_url', 'facebook_url'];
  function updateGroup(id, body) {
    const cur = getGroup(id);
    if (!cur) return { error: 'group not found' };
    const next = { ...cur };
    if (body.name !== undefined) {
      const n = String(body.name).trim();
      if (!n || n.length > 80) return { error: 'name: 1..80 characters' };
      next.name = n;
    }
    if (body.address !== undefined) next.address = String(body.address).trim();
    if (body.meeting_type !== undefined) {
      if (!['offline', 'zoom'].includes(body.meeting_type)) return { error: 'meeting_type: offline or zoom' };
      next.meeting_type = body.meeting_type;
    }
    if (body.default_language !== undefined) {
      if (!['ru', 'en', 'he'].includes(body.default_language)) return { error: 'default_language: ru, en or he' };
      next.default_language = body.default_language;
    }
    if (body.timezone !== undefined) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: String(body.timezone) }); } catch { return { error: 'timezone: unknown IANA zone' }; }
      next.timezone = String(body.timezone);
    }
    if (body.waha_session !== undefined) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(body.waha_session))) return { error: 'waha_session: letters, digits, - and _' };
      next.waha_session = String(body.waha_session);
    }
    for (const f of ['whatsapp_chat_id', 'sheet_id']) if (body[f] !== undefined) next[f] = String(body[f]).trim();
    for (const f of URL_FIELDS) {
      if (body[f] === undefined) continue;
      const v = String(body[f]).trim();
      if (v && !/^https?:\/\//i.test(v)) return { error: `${f}: must start with http(s)://` };
      next[f] = v;
    }
    if (body.meeting_weekday !== undefined) {
      const w = body.meeting_weekday;
      if (w === null || w === '') next.meeting_weekday = null;
      else if (/^[0-6]$/.test(String(w))) next.meeting_weekday = Number(w);
      else return { error: 'meeting_weekday: 0..6 or empty' };
    }
    if (body.meeting_time !== undefined) {
      const t = body.meeting_time;
      if (t === null || t === '') next.meeting_time = null;
      else if (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t))) next.meeting_time = String(t);
      else return { error: 'meeting_time: HH:MM or empty' };
    }
    if (body.payment_amount !== undefined) {
      const a = body.payment_amount;
      if (a === null || a === '') next.payment_amount = null;
      else if (/^\d{1,6}$/.test(String(a))) next.payment_amount = Number(a);
      else return { error: 'payment_amount: whole number or empty' };
    }
    db.prepare(`UPDATE groups SET name=?, address=?, waze_url=?, zoom_url=?, payment_url=?, payment_amount=?, meeting_weekday=?, meeting_time=?,
                meeting_type=?, default_language=?, timezone=?, waha_session=?, whatsapp_chat_id=?, sheet_id=?, facebook_url=? WHERE id=?`)
      .run(next.name, next.address, next.waze_url, next.zoom_url, next.payment_url, next.payment_amount, next.meeting_weekday, next.meeting_time,
        next.meeting_type, next.default_language, next.timezone, next.waha_session, next.whatsapp_chat_id, next.sheet_id, next.facebook_url, id);
    return { group: getGroup(id) };
  }

  // Date of the nearest meeting: computed from the group schedule; while the weekday is not set the old
  // `next_meeting_date` setting is used (group 1 before the admin fills the schedule).
  function meetingDateFor(groupId = DEFAULT_GROUP_ID) {
    const g = getGroup(groupId);
    if (g && g.meeting_weekday !== null) return nextMeetingDate(now(), g.meeting_weekday, g.meeting_time, g.timezone);
    return dbm.getGroupSetting(groupId, 'next_meeting_date') || '';
  }
  const scheduleIsSet = groupId => { const g = getGroup(groupId); return !!g && g.meeting_weekday !== null; };

  // The part of a group that public pages may see (no session, no timezone, no internals).
  const publicGroup = g => g && ({ slug: g.slug, name: g.name, address: g.address, waze_url: g.waze_url,
    payment_url: g.payment_url, payment_amount: g.payment_amount, default_language: g.default_language });

  // "Monday, 30 November 2026 at 07:30" pieces for message texts, from the group's own schedule.
  // time is '' when the group has not set one (the text then simply has no time).
  const meetingTime = groupId => { const g = getGroup(groupId); return (g && g.meeting_time) || ''; };

  // New empty group with defaults. Copies nothing from other groups.
  function createGroup({ name, slug, wahaSession = null, language = 'he' }) {
    const n = String(name || '').trim();
    const sl = String(slug || '').trim().toLowerCase();
    if (!n) return { error: 'name is required' };
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(sl)) return { error: 'slug: latin letters, digits and -, 2..41 characters' };
    if (getGroupBySlug(sl)) return { error: `slug "${sl}" is already taken` };
    const session = wahaSession || sl;
    if (!['ru', 'en', 'he'].includes(language)) return { error: 'language: ru, en or he' };
    const r = db.prepare('INSERT INTO groups (name, slug, waha_session, default_language, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(n, sl, session, language, new Date().toISOString());
    return { group: getGroup(r.lastInsertRowid) };
  }

  // ─── Positions ──────────────────────────────────────────────────────────────

  const listPositions = groupId => db.prepare('SELECT * FROM positions WHERE group_id = ? ORDER BY id').all(groupId);

  // member_id -> [{ position_id, is_head }] for every member of the group
  function memberPositionsMap(groupId) {
    const rows = db.prepare(`
      SELECT mp.member_id, mp.position_id, mp.is_head FROM member_positions mp
      JOIN members m ON m.id = mp.member_id WHERE m.group_id = ?`).all(groupId);
    const out = {};
    for (const r of rows) (out[r.member_id] ||= []).push({ position_id: r.position_id, is_head: r.is_head });
    return out;
  }

  // Replace the member's positions. Positions must belong to the member's own group.
  function setMemberPositions(memberId, list) {
    const gid = groupOfMember(memberId);
    if (gid === null) return { error: 'member not found' };
    if (!Array.isArray(list)) return { error: 'positions must be an array' };
    const valid = new Set(listPositions(gid).map(p => p.id));
    const clean = [];
    for (const it of list) {
      const pid = Number(it && it.position_id);
      if (!valid.has(pid)) return { error: `position ${it && it.position_id} does not belong to this group` };
      if (!clean.some(c => c.position_id === pid)) clean.push({ position_id: pid, is_head: it.is_head ? 1 : 0 });
    }
    db.transaction(() => {
      db.prepare('DELETE FROM member_positions WHERE member_id = ?').run(memberId);
      const ins = db.prepare('INSERT INTO member_positions (member_id, position_id, group_id, is_head) VALUES (?, ?, ?, ?)');
      for (const c of clean) ins.run(memberId, c.position_id, gid, c.is_head);
    })();
    return { positions: clean };
  }

  // Phone of the member who is head of a position with notify_unconfirmed=1 in this group.
  // Falls back to the old `unconfirmed_notify_phone` setting (warning in the log).
  function unconfirmedNotifyPhone(groupId = DEFAULT_GROUP_ID) {
    const row = db.prepare(`
      SELECT m.phone FROM member_positions mp
      JOIN positions p ON p.id = mp.position_id
      JOIN members m ON m.id = mp.member_id
      WHERE p.group_id = ? AND m.group_id = ? AND p.notify_unconfirmed = 1 AND mp.is_head = 1 AND m.active = 1 AND TRIM(m.phone) != ''
      ORDER BY p.id, m.id LIMIT 1`).get(groupId, groupId);
    if (row) return row.phone;
    const legacy = dbm.getGroupSetting(groupId, 'unconfirmed_notify_phone');
    if (legacy) {
      log(`[Groups] group ${groupId}: no head of a position with notify_unconfirmed, using the group's unconfirmed_notify_phone setting`);
      return legacy;
    }
    log(`[Groups] group ${groupId}: nobody to notify about unconfirmed guests`);
    return '';
  }

  return {
    getGroup, getGroupBySlug, listGroups, groupOfMember, updateGroup, createGroup, meetingTime, meetingDateFor, scheduleIsSet, publicGroup,
    listPositions, memberPositionsMap, setMemberPositions, unconfirmedNotifyPhone,
  };
}

module.exports = { nextMeetingDate, createGroups, zonedParts, DEFAULT_GROUP_ID };
