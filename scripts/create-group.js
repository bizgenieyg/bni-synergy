#!/usr/bin/env node
'use strict';

// Creates an EMPTY group: no members, guests, positions or settings are copied from any other group.
//   node scripts/create-group.js "<name>" <slug> [waha-session]
// The slug is the group's link parameter (/guest?group=<slug>); the WAHA session defaults to the slug.
// The DB path comes from DB_PATH (as in the server). Group UI is a later task.

const groupsService = require('../services/groups');
const dbm = require('../services/db');

const [name, slug, session] = process.argv.slice(2);
// New groups are Hebrew-speaking (right-to-left pages); group 1 (Russian) is created by the migration.
if (!name || !slug) {
  console.error('usage: node scripts/create-group.js "<name>" <slug> [waha-session]');
  process.exit(2);
}

const groups = groupsService.createGroups(dbm);
const r = groups.createGroup({ name, slug, wahaSession: session || null, language: 'he' });
if (r.error) {
  console.error('error: ' + r.error);
  process.exit(1);
}
const g = r.group;
console.log(`Group created: id=${g.id} slug=${g.slug} name="${g.name}" waha_session=${g.waha_session} default_language=${g.default_language}`);
console.log(`  guest form : /guest?group=${g.slug}`);
console.log(`  voting     : /voting?group=${g.slug}`);
console.log(`  catalog    : /members-catalog?group=${g.slug}`);
console.log('Next: set the schedule, address and links in the admin (Group settings), connect the WhatsApp session.');
