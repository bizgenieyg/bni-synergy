'use strict';

const axios = require('axios');

const WAHA_URL     = (process.env.WAHA_URL     || 'http://localhost:3001').replace(/\/$/, '');
const WAHA_SESSION = process.env.WAHA_SESSION  || 'bni-synergy';

const BROADCAST_DELAY_MS = 2000;

// ─── Phone normalisation ──────────────────────────────────────────────────────

/**
 * Convert any Israeli phone number format to WAHA chatId.
 * Strip non-digits → if starts with 0, replace with 972 → append @c.us
 *
 * Example: "054-776-1466" → "972547761466@c.us"
 */
function toChatId(phone) {
  let d = String(phone).replace(/\D/g, '');
  if (d.startsWith('0')) d = '972' + d.slice(1);
  else if (!d.startsWith('972')) d = '972' + d;
  return `${d}@c.us`;
}

// ─── Core send ────────────────────────────────────────────────────────────────

/**
 * Send a WhatsApp text message via WAHA.
 * Wraps in try/catch so one failure never crashes the server.
 */
async function sendMessage(phone, text) {
  const chatId = toChatId(phone);
  try {
    const res = await axios.post(
      `${WAHA_URL}/api/sendText`,
      { session: WAHA_SESSION, chatId, text },
      { timeout: 15_000 },
    );
    return res.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error(`[WhatsApp] sendMessage to ${chatId} failed:`, detail);
    throw err;
  }
}

// ─── Broadcast ────────────────────────────────────────────────────────────────

/**
 * Send a message to each guest with a delay between sends.
 *
 * @param {Array<{phone, firstName, ...}>} guests
 * @param {(guest) => string} buildText — returns the message body for a guest
 */
async function broadcast(guests, buildText) {
  const results = [];

  for (const guest of guests) {
    try {
      const text = buildText(guest);
      await sendMessage(guest.phone, text);
      results.push({ phone: guest.phone, status: 'sent' });
    } catch (err) {
      results.push({ phone: guest.phone, status: 'error', error: err.message });
    }
    // Always wait before the next send, even after an error
    await new Promise(r => setTimeout(r, BROADCAST_DELAY_MS));
  }

  const ok   = results.filter(r => r.status === 'sent').length;
  const fail = results.length - ok;
  console.log(`[WhatsApp] Broadcast done: ${ok} sent, ${fail} failed`);
  return results;
}

module.exports = { sendMessage, broadcast, toChatId };
