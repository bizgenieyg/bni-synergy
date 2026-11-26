'use strict';

// WAHA session management for the admin panel: state selection for the connect
// window, a WAHA client that takes the session name as a parameter (one session
// per group later), and an auto-recovery limiter. Never logs the API key, QR codes
// or pairing codes.

const SESSION_RE = /^[A-Za-z0-9_-]{1,64}$/;
const isValidSession = s => typeof s === 'string' && SESSION_RE.test(s);

// Window state from a WAHA session status ('UNAVAILABLE' / null = WAHA did not answer).
//   connected -> show "connected as ...", button "disconnect"
//   scan      -> QR (or pairing code)
//   starting  -> "starting…", poll
//   restart   -> STOPPED / FAILED: button "start again"
//   unavailable -> WAHA unreachable
function pickWindowState(status) {
  switch (status) {
    case 'WORKING': return 'connected';
    case 'SCAN_QR_CODE': return 'scan';
    case 'STARTING': return 'starting';
    case 'STOPPED':
    case 'FAILED':
    case 'NOT_FOUND': return 'restart';
    default: return 'unavailable';
  }
}

// Polling interval for the window per state (ms); null = no polling needed beyond the 60 s header check.
function pollIntervalMs(state) {
  return { scan: 3000, starting: 2000, restart: 5000, unavailable: 5000, connected: 15000 }[state] ?? 5000;
}

// "972525159393@c.us" -> "972525159393"
function numberFromId(id) {
  return String(id || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

// Auto-restart limiter: restart a FAILED / STOPPED session at most once per cooldown,
// never on SCAN_QR_CODE / WORKING / STARTING, and not while paused (admin disconnected on purpose).
// Also keeps "last problem" (status + time), updated only when the status changes.
function createAutoRecovery({ restart, now = Date.now, cooldownMs = 5 * 60 * 1000, onProblem = () => {}, log = () => {} }) {
  const lastRestart = new Map(); // session -> ts
  const lastStatus = new Map();  // session -> status
  const paused = new Set();
  const problems = new Map();    // session -> { at, status }

  async function check(session, status) {
    const prev = lastStatus.get(session);
    lastStatus.set(session, status);

    const isProblem = status === 'FAILED' || status === 'STOPPED' || status === 'UNAVAILABLE' || status === 'SCAN_QR_CODE';
    if (isProblem && prev !== status) {
      const p = { at: new Date(now()).toISOString(), status };
      problems.set(session, p);
      onProblem(session, p);
    }

    if (status !== 'FAILED' && status !== 'STOPPED') return { action: 'none' };
    if (paused.has(session)) return { action: 'paused' };
    const last = lastRestart.get(session);
    if (last !== undefined && now() - last < cooldownMs) return { action: 'cooldown' };
    lastRestart.set(session, now());
    log(`[WAHA] session "${session}" is ${status}: restarting`);
    try {
      await restart(session);
      return { action: 'restarted' };
    } catch (err) {
      log(`[WAHA] auto-restart of "${session}" failed: ${err.message}`);
      return { action: 'restart_failed' };
    }
  }

  return {
    check,
    pause: s => { paused.add(s); },
    resume: s => { paused.delete(s); lastRestart.delete(s); },
    isPaused: s => paused.has(s),
    lastProblem: s => problems.get(s) || null,
    setLastProblem: (s, p) => { if (p) problems.set(s, p); },
  };
}

// Thin WAHA HTTP client. fetchImpl is injectable for tests.
function createWahaClient({ url, apiKey, fetchImpl = fetch }) {
  const base = String(url || 'http://localhost:3001').replace(/\/$/, '');
  const headers = (json = false) => ({ ...(apiKey ? { 'X-Api-Key': apiKey } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) });
  const call = (path, { method = 'GET', body, timeout = 8000 } = {}) =>
    fetchImpl(`${base}${path}`, {
      method, headers: headers(body !== undefined), body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });
  const enc = encodeURIComponent;

  return {
    // -> { status, me } ; status 'UNAVAILABLE' when WAHA does not answer, 'NOT_FOUND' when the session does not exist
    async getSession(session) {
      try {
        const r = await call(`/api/sessions/${enc(session)}`, { timeout: 5000 });
        if (r.status === 404) return { status: 'NOT_FOUND', me: null };
        if (!r.ok) return { status: 'UNAVAILABLE', me: null };
        const d = await r.json();
        const me = d.me ? { pushName: d.me.pushName || '', number: numberFromId(d.me.id) } : null;
        return { status: d.status || 'UNAVAILABLE', me };
      } catch {
        return { status: 'UNAVAILABLE', me: null };
      }
    },
    // PNG data URL, or null when WAHA has no QR (it answers 422 in every status but SCAN_QR_CODE)
    async getQr(session) {
      const r = await call(`/api/${enc(session)}/auth/qr`);
      if (!r.ok) return null;
      return `data:image/png;base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
    },
    // restart; falls back to start for a session that does not exist
    async restart(session) {
      let r = await call(`/api/sessions/${enc(session)}/restart`, { method: 'POST', body: {}, timeout: 10000 });
      if (!r.ok) r = await call('/api/sessions/start', { method: 'POST', body: { name: session }, timeout: 10000 });
      if (!r.ok) throw new Error(`WAHA answered ${r.status}`);
    },
    // stop + logout (unlink the number)
    async disconnect(session) {
      const lo = await call(`/api/sessions/${enc(session)}/logout`, { method: 'POST', body: {}, timeout: 10000 });
      const st = await call(`/api/sessions/${enc(session)}/stop`, { method: 'POST', body: {}, timeout: 10000 });
      if (!lo.ok && !st.ok) throw new Error(`WAHA answered ${lo.status}/${st.status}`);
    },
    // -> { ok: true, code } | { ok: false, status, message }
    async requestCode(session, phoneNumber) {
      const r = await call(`/api/${enc(session)}/auth/request-code`, { method: 'POST', body: { phoneNumber }, timeout: 15000 });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, status: r.status, message: String(d.message || '').slice(0, 200) };
      return { ok: true, code: d.code || '' };
    },
  };
}

// Pairing-code input: digits only, international format without a leading 0 or +
function cleanPhoneNumber(input) {
  const d = String(input || '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 15 ? d : '';
}

module.exports = {
  isValidSession, pickWindowState, pollIntervalMs, numberFromId, createAutoRecovery, createWahaClient, cleanPhoneNumber,
};
