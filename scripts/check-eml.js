#!/usr/bin/env node
'use strict';

// Usage: node scripts/check-eml.js path/to/letter.eml
// Verifies From/subject/DKIM (real DNS) and prints what the parser extracts. Writes nothing.
const fs = require('fs');
const { simpleParser } = require('mailparser');
const intake = require('../services/mailIntake');

(async () => {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/check-eml.js file.eml'); process.exit(2); }
  const raw = fs.readFileSync(file);
  const parsed = await simpleParser(raw);
  console.log('From   :', parsed.from && parsed.from.text);
  console.log('Subject:', parsed.subject);
  const cls = await intake.classify(raw, parsed);
  console.log('Verdict:', cls.kind, cls.reason || '');
  if (parsed.html) {
    const f = intake.parseBniHtml(parsed.html);
    const phone = (f.phones.match(intake.PHONE_RE) || [])[0] || '(none)';
    console.log('Fields :', JSON.stringify({ ...f, phoneFound: phone }, null, 2));
  }
})();
