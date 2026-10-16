'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { simpleParser } = require('mailparser');
const cheerio = require('cheerio');
const { dkimVerify } = require('mailauth');

const BNI_FROM        = 'bni.notifications@bniconnectglobal.com';
const BNI_DKIM_DOMAIN = 'bniconnectglobal.com';
const BNI_SUBJECT     = 'הודעה על רישום אורח';

const PHONE_RE = /(?<!\d)(?:\+?972|0)[\s-]?5\d[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g;
const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/g;
const NIQQUD    = /[֑-ׇ]/g;
const QUOTES    = /["'`´“”„‟‘’‚‛״׳]/g;
const TITLES    = new Set(['דר', 'עוד', 'רוח', 'פרופ']);

function cleanText(s) {
  return String(s || '').replace(INVISIBLE, '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeHebName(s) {
  const tokens = cleanText(s).replace(NIQQUD, '').split(' ').filter(Boolean);
  while (tokens.length > 1 && TITLES.has(tokens[0].replace(QUOTES, ''))) tokens.shift();
  return tokens.join(' ').replace(QUOTES, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function matchInviter(rawName, members) {
  const key = normalizeHebName(rawName);
  if (!key) return null;
  const hits = members.filter(m => normalizeHebName(m.name_he) === key);
  return hits.length === 1 ? hits[0] : null;
}

function toMeetingDate(d, m, y) {
  const day = Number(d), mon = Number(m), year = Number(y);
  const dt = new Date(Date.UTC(year, mon - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== mon - 1 || dt.getUTCDate() !== day) return null;
  return `${String(day).padStart(2, '0')}/${String(mon).padStart(2, '0')}/${String(year).slice(2)}`;
}

function parseBniHtml(html) {
  const $ = cheerio.load(html);
  const rows = [];
  $('tr').each((_, tr) => {
    const cells = $(tr).children('td,th').toArray();
    if (cells.length < 2) return;
    if (cells.some(c => $(c).find('table').length)) return;
    const label = cleanText($(cells[0]).text()).replace(/[:：]\s*$/, '').replace(QUOTES, '');
    const value = cleanText($(cells[1]).text());
    if (label) rows.push([label, value]);
  });
  const find = test => (rows.find(([k]) => test(k)) || [, ''])[1];

  const bodyText = cleanText($('body').text() || $.root().text());
  const dates = [];
  for (const m of bodyText.matchAll(/בתאריך\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/g)) {
    const d = toMeetingDate(m[1], m[2], m[3]);
    if (d && !dates.includes(d)) dates.push(d);
  }

  return {
    name:        find(k => k === 'שם'),
    company:     find(k => k === 'חברה'),
    profession:  find(k => k.startsWith('מקצוע')),
    phones:      find(k => k.startsWith('מספרי טלפון') || k === 'טלפון'),
    email:       find(k => k.startsWith('כתובת דואל') || k.startsWith('דואל')),
    invitedBy:   find(k => k.startsWith('הוזמן על ידי')),
    type:        find(k => k.startsWith('סוג אורח')),
    meetingDates: dates,
  };
}

function domainOk(d) {
  d = String(d || '').toLowerCase();
  return d === BNI_DKIM_DOMAIN || d.endsWith('.' + BNI_DKIM_DOMAIN);
}

async function classify(raw, parsed, { resolver } = {}) {
  const from = (parsed.from && parsed.from.value && parsed.from.value[0] && parsed.from.value[0].address || '').toLowerCase();
  if (from !== BNI_FROM) return { kind: 'other' };
  const subject = cleanText(parsed.subject);
  if (subject !== BNI_SUBJECT) return { kind: 'rejected', reason: `subject mismatch: "${subject}"` };
  let res;
  try {
    res = await dkimVerify(raw, resolver ? { resolver } : {});
  } catch (err) {
    return { kind: 'rejected', reason: `dkim error: ${err.message}` };
  }
  const results = res.results || [];
  const ok = results.some(r => r.status && r.status.result === 'pass' && r.status.aligned !== false && domainOk(r.signingDomain));
  if (!ok) {
    const summary = results.map(r => `${r.signingDomain}:${r.status && r.status.result}`).join(', ') || 'no signatures';
    return { kind: 'rejected', reason: `dkim not passed (${summary})` };
  }
  return { kind: 'bni' };
}

function mailDir() {
  return process.env.MAIL_INTAKE_DIR || '/var/mail-intake';
}

function saveRaw(raw, { rejected = false } = {}) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(mailDir(), ...(rejected ? ['rejected', day] : [day]));
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.eml`);
    fs.writeFileSync(file, raw, { mode: 0o600 });
    return file;
  } catch (err) {
    console.error('[MailIntake] failed to save .eml:', err.message);
    return '';
  }
}

function logOtherMail(parsed) {
  const from = parsed.from && parsed.from.text || '';
  console.log(`[MailIntake] other mail: subject="${cleanText(parsed.subject)}" from="${from}"`);
  const text = parsed.text || (parsed.html ? cheerio.load(parsed.html).root().text() : '');
  const lines = String(text).split(/\r?\n/).map(cleanText).filter(l =>
    l && (/https?:\/\//i.test(l) || /\b\d{5,}\b/.test(l) || /confirm|verif|forward|код|подтвержд/i.test(l)));
  for (const l of lines.slice(0, 20)) console.log(`[MailIntake]   ${l.slice(0, 500)}`);
}

const DEFAULT_NOTIFY_PHONE = '972523695741';
const ISRAEL_PHONE_RE = /(?<!\d)(?:\+?972[\s-]?|0)(?:5\d|7\d|[2-489])[\s-]?\d{3}[\s-]?\d{4}(?!\d)/g;

function normalizeIsraelPhone(raw, db) {
  const n = db.normalizePhone(raw);
  if (/^972\d{9}$/.test(n)) return n;
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('972')) d = d.slice(3);
  if (d.startsWith('0')) d = d.slice(1);
  return d.length === 8 ? '972' + d : '';   // landline: 0X + 7 digits
}

// All Israeli numbers of the letter; a mobile 05x wins, otherwise the first one found
function pickPhone(text, db) {
  const all = (String(text).match(ISRAEL_PHONE_RE) || []).map(r => normalizeIsraelPhone(r, db)).filter(Boolean);
  return { phone: all.find(p => /^9725\d{8}$/.test(p)) || all[0] || '', all };
}

function maskPhone(p) {
  return p && p.length > 7 ? `${p.slice(0, 3)}***${p.slice(-4)}` : '***';
}

const TYPE_LABEL = t => (t === 'אורח' ? 'Гость' : t === 'ממלא מקום' ? 'Замена' : 'Не определён ⚠️');

// Service line (test mode, and always in branch C)
function serviceLine({ prefix, target, info }) {
  const invited = info.invitedBy || '—';
  return `${prefix} → ${target} | ${TYPE_LABEL(info.type)} | Пригласил: ${invited}${info.inviterMatched ? '' : ' ⚠️'}`;
}

/**
 * Last step for a BNI guest letter (no guest record is created):
 *   A: guest has a WhatsApp number  -> invitation to the guest
 *   B: no number in WhatsApp         -> two messages to the inviting member (ask to forward + invitation)
 *   C: inviter unknown / no phone    -> the same two messages to the manager, marked ⚠️
 * Mode `test` (default) sends everything to the manager with a service line first.
 */
async function sendInvitations(f, deps) {
  const { db } = deps;
  const mode = deps.mode && deps.mode() === 'prod' ? 'prod' : 'test';
  const manager = (deps.notifyPhone && deps.notifyPhone()) || DEFAULT_NOTIFY_PHONE;

  const { phone } = pickPhone(f.phones, db);
  const inviter = matchInviter(f.invitedBy, db.getActiveMembers().filter(m => m.name_he));
  let meetingDate = f.meetingDates[0] || '';
  const dateFallback = !meetingDate;
  if (dateFallback) meetingDate = deps.nextMeetingDate();

  const info = {
    type: f.type, name: f.name, phone, company: f.company, profession: f.profession,
    invitedBy: inviter ? inviter.name : f.invitedBy, inviterMatched: !!inviter, meetingDate,
  };
  const base = { ...info, invitedByRaw: f.invitedBy, email: f.email, dateFallback, mode };

  if (deps.isPast && deps.isPast(meetingDate)) {
    return { status: 'skipped_past', reason: 'meeting date is in the past', parsedJson: JSON.stringify(base) };
  }
  const sentStatuses = mode === 'test' ? ['sent_test'] : ['sent_guest', 'sent_member', 'sent_fallback'];
  if (db.findSentIntake({ phone, name: f.name, meetingDate, statuses: sentStatuses })) {
    return { status: 'duplicate', reason: 'already sent for this guest', parsedJson: JSON.stringify(base) };
  }

  let numberExists = null;
  if (phone) {
    try { numberExists = await deps.checkWhatsApp(phone); }
    catch (err) { console.error('[MailIntake] WhatsApp number check failed:', err.message); }
  }

  const memberFirst = inviter ? inviter.name.trim().split(/\s+/)[0] : '';
  let branch, to, texts, serviceTarget;
  const invite = deps.buildInvite({ name: f.name, meetingDate });
  if (phone && numberExists === true) {
    branch = 'A'; to = phone; texts = [invite]; serviceTarget = 'гость';
  } else if (inviter && inviter.phone) {
    branch = 'B'; to = inviter.phone; texts = [deps.buildMemberRequest({ memberName: memberFirst, guestName: f.name }), invite];
    serviceTarget = `участник ${memberFirst}, ${inviter.phone}`;
  } else {
    branch = 'C'; to = manager; texts = [deps.buildMemberRequest({ memberName: memberFirst, guestName: f.name }), invite];
    serviceTarget = inviter
      ? `участник ${memberFirst} (нет телефона ⚠️)`
      : `участник ${f.invitedBy || '—'} (не найден в списке ⚠️)`;
  }

  const parsedJson = JSON.stringify({ ...base, branch, numberExists, to });
  let status;
  if (mode === 'test') {
    const line = serviceLine({ prefix: '🧪 ТЕСТ', target: serviceTarget, info });
    texts = texts.map(t => `${line}\n${t}`);
    to = manager; status = 'sent_test';
  } else if (branch === 'C') {
    const line = serviceLine({ prefix: '⚠️ ПЕРЕШЛИТЕ ВРУЧНУЮ', target: serviceTarget, info });
    texts = texts.map(t => `${line}\n${t}`);
    status = 'sent_fallback';
  } else {
    status = branch === 'A' ? 'sent_guest' : 'sent_member';
  }

  try {
    await deps.sendSequence(to, texts);
  } catch (err) {
    console.error('[MailIntake] sending failed (WhatsApp unavailable?):', err.message);
    console.log(`[MailIntake] branch=${branch} mode=${mode} to=${maskPhone(to)} status=send_failed`);
    return { status: 'send_failed', branch, reason: err.message, parsedJson };
  }
  console.log(`[MailIntake] branch=${branch} mode=${mode} to=${maskPhone(to)} status=${status}`);
  return { status, branch, parsedJson, notifiedAt: new Date().toISOString() };
}

async function processGuestMail(parsed, deps) {
  const { db } = deps;
  if (!parsed.html) return { status: 'unparsed', reason: 'no html part' };
  const f = parseBniHtml(parsed.html);
  if (!(deps.autoRegister && deps.autoRegister())) return sendInvitations(f, deps);

  let needsReview = false;
  let isSub = false;
  if (f.type === 'ממלא מקום') isSub = true;
  else if (f.type !== 'אורח') needsReview = true;

  const phoneRaw = (f.phones.match(PHONE_RE) || [])[0] || '';
  const phone = phoneRaw ? db.normalizePhone(phoneRaw) : '';
  if (!phone) needsReview = true;

  const inviter = matchInviter(f.invitedBy, db.getActiveMembers().filter(m => m.name_he));
  const invitedBy = inviter ? inviter.name : f.invitedBy;
  if (!inviter) needsReview = true;

  let meetingDate = f.meetingDates[0];
  if (!meetingDate || f.meetingDates.length > 1) needsReview = true;
  if (!meetingDate) meetingDate = deps.nextMeetingDate();

  const name = f.name;
  if (!name) needsReview = true;
  const specialty = f.profession || f.company;
  const email = (f.email.match(/[^\s<>()]+@[^\s<>()]+\.[^\s<>()]+/) || [''])[0];

  const existing = phone ? db.findGuestByDatePhone(meetingDate, phone) : db.findGuestByDateName(meetingDate, name);
  if (existing) {
    db.fillGuestEmptyFields(existing.id, { name, specialty, invitedBy, email });
    return { status: 'merged', guestId: existing.id };
  }

  const id = db.insertGuest({
    name, phone, specialty, invitedBy, meetingDate, email,
    paid: isSub ? 1 : 0,
    paidAt: isSub ? new Date().toISOString() : null,
    waEnabled: phone ? 1 : 0,
    guestType: isSub ? 'sub' : 'guest',
    source: 'bni_email',
    needsReview,
  });
  if (deps.afterCreate) {
    try {
      Promise.resolve(deps.afterCreate({ id, name, phone, specialty, invitedBy, meetingDate, email, isSub, waEnabled: phone ? 1 : 0 }))
        .catch(err => console.error('[MailIntake] afterCreate failed:', err.message));
    } catch (err) {
      console.error('[MailIntake] afterCreate failed:', err.message);
    }
  }
  return { status: 'created', guestId: id, needsReview };
}

async function handleIncomingMail(raw, deps) {
  const { db } = deps;
  const parsed = await simpleParser(raw);
  const messageId = (parsed.messageId || '').trim() || 'sha256:' + crypto.createHash('sha256').update(raw).digest('hex');
  if (!db.claimMailIntake(messageId)) {
    console.log(`[MailIntake] duplicate ${messageId}, skipped`);
    return { status: 'duplicate' };
  }

  let out = { status: 'error' };
  let rejected = false;
  try {
    const cls = await classify(raw, parsed, { resolver: deps.resolver });
    if (cls.kind === 'other') {
      out = { status: 'ignored' };
      logOtherMail(parsed);
    } else if (cls.kind === 'rejected') {
      out = { status: 'rejected', reason: cls.reason };
      rejected = true;
      console.warn(`[MailIntake] REJECTED: ${cls.reason}`);
    } else {
      out = await processGuestMail(parsed, deps);
      console.log(`[MailIntake] ${out.status}${out.guestId ? ' guest=' + out.guestId : ''}${out.needsReview ? ' (needs_review)' : ''}`);
    }
  } catch (err) {
    console.error('[MailIntake] processing error:', err.stack || err.message);
    out = { status: 'error', reason: err.message };
  } finally {
    const rawPath = saveRaw(raw, { rejected });
    db.finishMailIntake(messageId, {
      status: out.status, guestId: out.guestId || null, rawPath,
      parsedJson: out.parsedJson || null, notifiedAt: out.notifiedAt || null,
    });
  }
  const { parsedJson, notifiedAt, ...result } = out;
  return result;
}

module.exports = {
  BNI_FROM, BNI_DKIM_DOMAIN, BNI_SUBJECT, PHONE_RE,
  cleanText, normalizeHebName, matchInviter, parseBniHtml, classify, handleIncomingMail,
  ISRAEL_PHONE_RE, pickPhone,
};
