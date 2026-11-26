'use strict';

// Background jobs for every group. One tick per ~30 s; for each group the local time (its own time zone)
// decides which job is due. A failure in one group (no WhatsApp session, WAHA down, bad data) is caught
// inside that group's job, logged with the group id, and never stops the other groups.
//
// A job is placed relative to the group's meeting weekday:
//   { name, offsetDays, time: 'HH:MM', run(group) }  -> due on weekday (meeting_weekday + offsetDays) % 7 at `time`.
//   { name, daily: true, time, run(group) }          -> due every day at `time`.
// Groups without a meeting weekday only get the daily jobs.

const { zonedParts } = require('./groups');

function createGroupScheduler({ listGroups, jobs, now = () => new Date(), log = console.log, logError = console.error }) {
  const fired = new Set();   // `${group}|${job}|${local date}` already started
  const running = new Set(); // same keys while the job is still running

  const hhmm = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

  function dueJobs(group, parts) {
    return jobs.filter(j => {
      if (parts.minutes !== hhmm(j.time)) return false;
      if (j.daily) return true;
      if (group.meeting_weekday === null || group.meeting_weekday === undefined) return false;
      return parts.dow === (Number(group.meeting_weekday) + j.offsetDays) % 7;
    });
  }

  async function runOne(group, job, key) {
    try {
      await job.run(group);
    } catch (err) {
      logError(`[Cron] group ${group.id} (${group.slug}) job "${job.name}" failed: ${err && err.message ? err.message : err}`);
    } finally {
      running.delete(key);
    }
  }

  // Returns a promise that settles when every job started by this tick finished (tests await it).
  function tick() {
    const started = [];
    let list;
    try { list = listGroups(); } catch (err) { logError(`[Cron] cannot list groups: ${err.message}`); return Promise.resolve(); }
    for (const group of list) {
      let parts;
      try { parts = zonedParts(now(), group.timezone); } catch (err) { logError(`[Cron] group ${group.id}: bad time zone: ${err.message}`); continue; }
      const day = `${parts.y}-${parts.m}-${parts.d}`;
      for (const job of dueJobs(group, parts)) {
        const key = `${group.id}|${job.name}|${day}`;
        if (fired.has(key) || running.has(key)) continue;
        fired.add(key);
        running.add(key);
        log(`[Cron] group ${group.id} (${group.slug}): ${job.name}`);
        started.push(runOne(group, job, key));
      }
    }
    if (fired.size > 5000) fired.clear();
    return Promise.allSettled(started);
  }

  function start(intervalMs = 30_000) {
    return setInterval(() => { tick(); }, intervalMs);
  }

  return { tick, start };
}

module.exports = { createGroupScheduler };
