'use strict';

// Confirmation waves (Asia/Jerusalem crons are registered in server.js).
// Wave 1: Thursday 10:00, list to the manager at 11:00. Wave 2: Sunday 18:00, list at 19:00.
// Each wave keeps its own state so "already sent today" never blocks the other one.

function createWaves({ db, whatsapp, buildConfirmationMessage, getTodayStr, formatMeetingDate, getNextMeeting }) {
  const CONFIRM_WAVES = {
    1: { label: 'Волна 1 (чт 10:00)', forKey: 'confirmation_round1_for', dateKey: 'confirmation_round1_date', greeting: 'Добрый день' },
    2: { label: 'Волна 2 (вс 18:00)', forKey: 'confirmation_round2_for', dateKey: 'confirmation_round2_date', greeting: 'Добрый вечер' },
  };

  async function runConfirmationWave(round) {
    const w = CONFIRM_WAVES[round];
    const settings = db.getAllSettings();
    const nextMeeting = getNextMeeting();
    if (!nextMeeting) { console.log(`[Cron] ${w.label}: встреча не задана, пропускаем`); return; }

    const today = getTodayStr();
    if (settings[w.dateKey] === today) {
      console.log(`[Cron] ${w.label}: уже отправляли сегодня, пропускаем`);
      return;
    }
    db.setSetting(w.forKey, nextMeeting);
    db.setSetting(w.dateKey, today);
    db.setSetting('confirmation_sent_for', nextMeeting); // shown in the admin UI

    const guests = db.db.prepare(
      'SELECT * FROM guests WHERE meetingDate=? AND wa_enabled=1 AND confirmed=0'
    ).all(nextMeeting);
    console.log(`[Cron] ${w.label}: найдено ${guests.length} неподтверждённых гостей на ${nextMeeting}`);

    const results = await whatsapp.sendWithDelay(guests, g => buildConfirmationMessage(g, settings));
    console.log(`[Cron] ${w.label}: найдено ${guests.length}, отправлено ${results.sent}, ошибок ${results.failed}`);
  }

  async function sendUnconfirmedList(round) {
    const w = CONFIRM_WAVES[round];
    const settings = db.getAllSettings();
    if (settings[w.dateKey] !== getTodayStr()) {
      console.log(`[Cron] Список после волны ${round}: волна сегодня не проходила, пропускаем`);
      return;
    }
    const phone = db.getSetting('unconfirmed_notify_phone');
    if (!phone) {
      console.log('[Cron] unconfirmed_notify_phone не настроен, пропускаем');
      return;
    }
    const nextMeeting = getNextMeeting();
    if (!nextMeeting) return;

    const unconfirmed = db.db.prepare(
      'SELECT name, phone FROM guests WHERE meetingDate=? AND confirmed=0 AND wa_enabled=1 ORDER BY name ASC'
    ).all(nextMeeting);
    if (!unconfirmed.length) {
      console.log(`[Cron] Список после волны ${round}: все гости подтвердили участие, не отправляем`);
      return;
    }

    const dateStr = formatMeetingDate(nextMeeting);
    const list    = unconfirmed.map((g, i) => `${i + 1}. ${g.name} — ${g.phone}`).join('\n');
    const text    = `${w.greeting}! 👋\n\nСписок гостей на встречу ${dateStr}, которые ещё не подтвердили участие (${unconfirmed.length} чел.):\n\n${list}\n\nBNI Synergy`;

    try {
      await whatsapp.sendMessage(phone, text);
      console.log(`[Cron] Список после волны ${round}: отправлено ${unconfirmed.length} неподтверждённых на ${phone}`);
    } catch (e) {
      console.error('[Cron] Не удалось отправить список неподтверждённых:', e.message);
    }
  }

  return { CONFIRM_WAVES, runConfirmationWave, sendUnconfirmedList };
}

module.exports = { createWaves };
