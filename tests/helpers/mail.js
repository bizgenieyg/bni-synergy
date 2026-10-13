'use strict';

// Synthetic, depersonalised BNI Connect-style emails + DKIM signing for tests.
const crypto = require('crypto');
const { dkimSign } = require('mailauth');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicB64  = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

// DNS stub: only s1._domainkey.<domain> for the listed domains resolves
function makeResolver(domains) {
  return async (name, rr) => {
    const m = /^s1\._domainkey\.(.+)$/.exec(name);
    if (rr === 'TXT' && m && domains.includes(m[1])) return [[`v=DKIM1; k=rsa; p=${publicB64}`]];
    const err = new Error('ENOTFOUND'); err.code = 'ENOTFOUND'; throw err;
  };
}

const b64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');

function bniHtml({ name, company, profession, phones, email, invitedBy, type, date }) {
  return `<html><body dir="rtl">
<table><tr><td>
<p>שלום יורי,</p>
<p>נרשם אורח לפגישה בתאריך <b>${date}</b> בשעה 07:30.</p>
<table>
<tr><td>שם</td><td>${name}</td></tr>
<tr><td>חברה</td><td>${company}</td></tr>
<tr><td>מקצוע, סיווג</td><td>${profession}</td></tr>
<tr><td>מספרי טלפון</td><td>${phones}</td></tr>
<tr><td>כתובת דוא"ל</td><td>${email}</td></tr>
<tr><td>הוזמן על ידי</td><td>${invitedBy}</td></tr>
<tr><td>סוג אורח (אם ריק ההרשמה בוצעה אונליין)</td><td>${type}</td></tr>
</table>
</td></tr></table></body></html>`;
}

async function buildMail({
  from = 'BNI Israel Support <bni.notifications@bniconnectglobal.com>',
  subject = 'הודעה על רישום אורח',
  html, messageId, signDomain = 'bniconnectglobal.com', sign = true,
}) {
  const head =
    `From: ${from}\r\n` +
    `To: yuri@example.test\r\n` +
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=\r\n` +
    `Message-ID: <${messageId}>\r\n` +
    `Date: Tue, 13 Oct 2026 10:00:00 +0000\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n`;
  const msg = head + b64(html) + '\r\n';
  if (!sign) return Buffer.from(msg);
  const { signatures } = await dkimSign(msg, {
    canonicalization: 'relaxed/relaxed',
    signatureData: [{ signingDomain: signDomain, selector: 's1', privateKey: privatePem }],
  });
  return Buffer.from(signatures + msg);
}

module.exports = { makeResolver, buildMail, bniHtml };
