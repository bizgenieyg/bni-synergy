'use strict';

// Confirmation waves of ONE group (the group scheduler calls them in the group's time zone).
// Wave 1: meeting day -4 at 10:00 (Thursday for a Monday group), list to the manager at 11:00.
// Wave 2: meeting day -1 at 18:00, list at 19:00.
// Each wave keeps its own state (group_settings of this group) so "already sent today" never blocks the other one.

function createWaves({ db, whatsapp, buildConfirmationMessage, getTodayStr, formatMeetingDate, getNextMeeting, groupId = 1, getNotifyPhone = null, getSettings = null, getGroupName = () => 'BNI' }) {
  const CONFIRM_WAVES = {
    1: { label: 'Волна 1', forKey: 'confirmation_round1_for', dateKey: 'confirmation_round1_date', greeting: 'Добрый день' },
    2: { label: 'Волна 2', forKey: 'confirmation_round2_for', dateKey: 'confirmation_round2_date', greeting: 'Добрый вечер' },
  };

  async function runConfirmationWave(round) {
    const w = CONFIRM_WAVES[round];
    const state = db.getGroupSettings(groupId);
    const settings = getSettings ? getSettings() : state;
    const nextMeeting = getNextMeeting();
    if (!nextMeeting) { console.log(`[Cron] ${w.label}: встреча не задана, пропускаем`); return; }

    const today = getTodayStr();
    if (state[w.dateKey] === today) {
      console.log(`[Cron] ${w.label}: уже отправляли сегодня, пропускаем`);
      return;
    }
    db.setGroupSetting(groupId, w.forKey, nextMeeting);
    db.setGroupSetting(groupId, w.dateKey, today);
    db.setGroupSetting(groupId, 'confirmation_sent_for', nextMeeting); // shown in the admin UI

    const guests = db.db.prepare(
      'SELECT * FROM guests WHERE meetingDate=? AND wa_enabled=1 AND confirmed=0 AND group_id=?'
    ).all(nextMeeting, groupId);
    console.log(`[Cron] группа ${groupId}, ${w.label}: найдено ${guests.length} неподтверждённых гостей на ${nextMeeting}`);

    const results = await whatsapp.sendWithDelay(guests, g => buildConfirmationMessage(g, settings));
    console.log(`[Cron] группа ${groupId}, ${w.label}: найдено ${guests.length}, отправлено ${results.sent}, ошибок ${results.failed}`);
  }

  async function sendUnconfirmedList(round) {
    const w = CONFIRM_WAVES[round];
    const state = db.getGroupSettings(groupId);
    if (state[w.dateKey] !== getTodayStr()) {
      console.log(`[Cron] Список после волны ${round}: волна сегодня не проходила, пропускаем`);
      return;
    }
    const phone = getNotifyPhone ? getNotifyPhone() : db.getGroupSetting(groupId, 'unconfirmed_notify_phone');
    if (!phone) {
      console.log('[Cron] получатель списка не задан, пропускаем');
      return;
    }
    const nextMeeting = getNextMeeting();
    if (!nextMeeting) return;

    const unconfirmed = db.db.prepare(
      'SELECT name, phone FROM guests WHERE meetingDate=? AND confirmed=0 AND wa_enabled=1 AND group_id=? ORDER BY name ASC'
    ).all(nextMeeting, groupId);
    if (!unconfirmed.length) {
      console.log(`[Cron] Список после волны ${round}: все гости подтвердили участие, не отправляем`);
      return;
    }

    const dateStr = formatMeetingDate(nextMeeting);
    const groupName = getGroupName();
    const list    = unconfirmed.map((g, i) => `${i + 1}. ${g.name} — ${g.phone}`).join('\n');
    const text    = `${w.greeting}! 👋\n\nСписок гостей на встречу ${dateStr}, которые ещё не подтвердили участие (${unconfirmed.length} чел.):\n\n${list}\n\n${groupName}`;

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
