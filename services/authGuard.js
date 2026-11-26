'use strict';

// Admin authentication and the default-deny guard for /api.
// Everything under /api requires the admin token unless the route is listed in
// PUBLIC_ROUTES. The list is derived from what public/*.html actually call.
// Pure module: no Express app, no env access at import time.

const crypto = require('crypto');

// ':num' = digits only, any other ':name' = one path segment.
const PUBLIC_ROUTES = [
  ['POST', '/api/admin/login'],
  ['GET',  '/api/test'],
  // guest registration / confirmation / voting (guest.html, confirm.html, voting.html)
  ['POST', '/api/register'],
  ['GET',  '/api/guests/:id/public'],
  ['POST', '/api/guests/:id/confirm'],
  ['POST', '/api/voting'],
  ['GET',  '/api/voting/status'],
  // public catalog + settings (members-catalog.html, guest.html)
  ['GET',  '/api/catalog'],
  ['GET',  '/api/settings'],
  // member self-service pages (member.html, voting.html, profile.html).
  // KNOWN RISK: no per-member auth yet, any visitor can edit a profile by id.
  ['GET',   '/api/members'],
  ['GET',   '/api/members/:num'],
  ['GET',   '/api/members/:num/photo'],
  ['POST',  '/api/members/:num/photo'],
  ['GET',   '/api/members/:num/socials'],
  ['PUT',   '/api/members/:num/socials'],
  ['PATCH', '/api/members/:num/profile'],
  // guest.html shows the presentation of the day
  ['GET',  '/api/presentations/:date'],
  // payment provider callback (optionally protected by PAYBOX_WEBHOOK_SECRET)
  ['POST', '/api/paybox-webhook'],
  ['GET',  '/api/paybox-webhook'],
].map(([method, path]) => ({
  method,
  path,
  re: new RegExp('^' + path.split('/').map(seg =>
    seg === ':num' ? '\\d+' : seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  ).join('/') + '$'),
}));

function normalizePath(p) {
  let s = String(p || '').split('?')[0].split('#')[0];
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s;
}

function isPublicRoute(method, path) {
  let m = String(method || '').toUpperCase();
  if (m === 'HEAD') m = 'GET';
  const p = normalizePath(path);
  return PUBLIC_ROUTES.some(r => r.method === m && r.re.test(p));
}

// ─── Tokens ───────────────────────────────────────────────────────────────────

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Same derivation as before, so already issued tokens stay valid.
function makeStaticToken(password) {
  return crypto.createHmac('sha256', password + 'bni-synergy-salt').digest('hex');
}

function bearer(req) {
  const auth = (req.headers && req.headers.authorization) || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}

function createAuth(password) {
  if (!password) throw new Error('ADMIN_PASSWORD is required');
  const expected = makeStaticToken(password);
  const isAdminRequest = req => {
    const t = bearer(req);
    return t !== '' && safeEqual(t, expected);
  };
  const adminAuth = (req, res, next) => {
    if (!isAdminRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
    next();
  };
  const guard = (req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (isPublicRoute(req.method, (req.baseUrl || '') + (req.path || ''))) return next();
    return adminAuth(req, res, next);
  };
  return {
    token: expected,
    isAdminRequest,
    adminAuth,
    guard,
    checkPassword: pw => typeof pw === 'string' && safeEqual(pw, password),
  };
}

// ─── Login rate limit (in memory) ─────────────────────────────────────────────

function createLoginLimiter({ max = 10, windowMs = 15 * 60 * 1000, now = Date.now } = {}) {
  const fails = new Map(); // ip -> [timestamps]
  const recent = ip => {
    const t = now();
    const arr = (fails.get(ip) || []).filter(x => t - x < windowMs);
    if (arr.length) fails.set(ip, arr); else fails.delete(ip);
    return arr;
  };
  return {
    isBlocked: ip => recent(ip).length >= max,
    retryAfterSec: ip => {
      const arr = recent(ip);
      return arr.length >= max ? Math.max(1, Math.ceil((arr[0] + windowMs - now()) / 1000)) : 0;
    },
    recordFailure: ip => { const arr = recent(ip); arr.push(now()); fails.set(ip, arr); },
    size: () => fails.size,
  };
}

// Client IP behind nginx. nginx overwrites X-Real-IP with $remote_addr but does not
// touch X-Forwarded-For (a client can forge it), so trust X-Real-IP only when the
// connection comes from the local proxy.
function clientIp(req) {
  const remote = (req.socket && req.socket.remoteAddress) || req.ip || '';
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const real = req.headers && req.headers['x-real-ip'];
  return local && real ? String(real).trim() : remote;
}

// ─── Public data shaping ──────────────────────────────────────────────────────

const PUBLIC_SETTING_KEYS = ['meeting_location', 'meeting_waze_url', 'meeting_type', 'meeting_time', 'meeting_weekday', 'group_name', 'default_language'];

function filterSettings(all, isAdmin) {
  if (isAdmin) return all;
  const out = {};
  for (const k of PUBLIC_SETTING_KEYS) if (all && k in all) out[k] = all[k];
  return out;
}

// What the public pages read: voting/member lists need id, name, profession, photo;
// profile.html (self-service) also reads phone and birthday of the member being edited;
// members-catalog.html shows phone.
const pick = (o, keys) => Object.fromEntries(keys.filter(k => k in o).map(k => [k, o[k]]));
const publicMemberList    = m => pick(m, ['id', 'name', 'profession', 'photo']);
const publicMemberProfile = m => pick(m, ['id', 'name', 'profession', 'phone', 'birthday', 'photo']);
const publicCatalogMember = m => pick(m, ['id', 'name', 'profession', 'phone', 'photo', 'socials']);

// ─── Webhook key ──────────────────────────────────────────────────────────────

function webhookKeyOk(secret, provided) {
  if (!secret) return true;
  return typeof provided === 'string' && provided !== '' && safeEqual(provided, secret);
}

module.exports = {
  PUBLIC_ROUTES, isPublicRoute, normalizePath, makeStaticToken, createAuth, createLoginLimiter,
  clientIp, PUBLIC_SETTING_KEYS, filterSettings,
  publicMemberList, publicMemberProfile, publicCatalogMember, webhookKeyOk,
};
