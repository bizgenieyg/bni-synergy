'use strict';

const axios = require('axios');

const WAHA_URL     = (process.env.WAHA_URL     || 'http://localhost:3001').replace(/\/$/, '');
const WAHA_SESSION = process.env.WAHA_SESSION  || 'bni-synergy';
const WAHA_API_KEY = process.env.WAHA_API_KEY  || '';

const WAHA_HEADERS = WAHA_API_KEY ? { 'X-Api-Key': WAHA_API_KEY } : {};

const DELAY_MIN_MS = 1500;
const DELAY_MAX_MS = 4000;

function randomDelay() {
  return Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1)) + DELAY_MIN_MS;
}

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

async function sendMessage(phone, text) {
  const chatId = toChatId(phone);
  try {
    const res = await axios.post(
      `${WAHA_URL}/api/sendText`,
      { session: WAHA_SESSION, chatId, text },
      { headers: WAHA_HEADERS, timeout: 15_000 },
    );
    return res.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error(`[WhatsApp] sendMessage to ${chatId} failed:`, detail);
    throw err;
  }
}

/**
 * Send a message to a WhatsApp group using its raw group chat ID.
 * The groupChatId should be in the format "120363XXXX@g.us".
 */
async function sendGroupMessage(groupChatId, text) {
  try {
    const res = await axios.post(
      `${WAHA_URL}/api/sendText`,
      { session: WAHA_SESSION, chatId: groupChatId, text },
      { headers: WAHA_HEADERS, timeout: 15_000 },
    );
    return res.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error(`[WhatsApp] sendGroupMessage to ${groupChatId} failed:`, detail);
    throw err;
  }
}

// ─── Broadcast ────────────────────────────────────────────────────────────────

/**
 * Send a message to each recipient with a random delay (1500–4000 ms) between sends.
 *
 * @param {Array<{phone, firstName, ...}>} recipients
 * @param {(recipient) => string} buildText — returns the message body
 */
async function broadcast(recipients, buildText) {
  const results = [];

  for (const r of recipients) {
    try {
      const text = buildText(r);
      await sendMessage(r.phone, text);
      results.push({ phone: r.phone, status: 'sent' });
    } catch (err) {
      results.push({ phone: r.phone, status: 'error', error: err.message });
    }
    await new Promise(resolve => setTimeout(resolve, randomDelay()));
  }

  const ok   = results.filter(r => r.status === 'sent').length;
  const fail = results.length - ok;
  console.log(`[WhatsApp] Broadcast done: ${ok} sent, ${fail} failed`);
  return results;
}

module.exports = { sendMessage, sendGroupMessage, broadcast, toChatId };
