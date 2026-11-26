'use strict';

// Post-meeting catalog message of ONE group: shared by the manual button and the meeting-day cron,
// so the text and the recipient selection cannot drift apart. Name, catalog link and Facebook link
// come from the group (the link carries ?group=<slug>).

function buildCatalogMessage(guest, getFirstName, { groupName = 'BNI', catalogUrl = '', facebookUrl = '' } = {}) {
  return (
    `Здравствуйте, ${getFirstName(guest.name)}! 👋\n\n` +
    `Рады были видеть вас сегодня на встрече ${groupName}! 🤝\n\n` +
    `Надеемся, что помимо приятного общения вы нашли для себя деловой интерес и новые возможности для сотрудничества.\n\n` +
    `Для вашего удобства — каталог участников группы с профессиями и контактами:\n` +
    `${catalogUrl}\n\n` +
    (facebookUrl ? `Приглашаем вас в нашу группу ${groupName} в Facebook:\n${facebookUrl}\n\n` : '') +
    `Будем рады видеть вас снова! 😊\n` +
    `Команда ${groupName}`
  );
}

function createCatalog({ db, whatsapp, getTodayStr, getSessionStatus, groupId = 1, getMessageOptions = () => ({}) }) {
  const recipientsFor = date => db.getGuestsByDate(date, groupId).filter(g => g.wa_enabled !== 0);
  const text = g => buildCatalogMessage(g, whatsapp.getFirstName, getMessageOptions());

  function send(guests) {
    return whatsapp.sendWithDelay(guests, text);
  }

  // Manual button: any date; the dedup setting is only touched for today's meeting.
  async function sendManual(meetingDate) {
    const guests = recipientsFor(meetingDate);
    const results = await send(guests);
    if (meetingDate === getTodayStr() && results.sent > 0) db.setGroupSetting(groupId, 'catalog_sent_for', meetingDate);
    return results;
  }

  // Monday 10:00: only guests of the meeting that takes place today.
  async function runMondayCron() {
    const today = getTodayStr();
    if (db.getGroupSetting(groupId, 'catalog_sent_for') === today) {
      console.log(`[Cron] Каталог: на ${today} уже отправлен, пропускаем`);
      return;
    }
    const guests = recipientsFor(today);
    if (!guests.length) {
      console.log(`[Cron] Каталог: на сегодня (${today}) гостей нет, ничего не отправляем`);
      return;
    }
    let status;
    try { status = await getSessionStatus(); } catch (e) { status = `ошибка проверки: ${e.message}`; }
    if (status !== 'WORKING') {
      console.error(`[Cron] Каталог: WhatsApp-сессия не WORKING (${status}), рассылка на ${today} не выполнена`);
      return;
    }
    const results = await send(guests);
    if (results.sent > 0) db.setGroupSetting(groupId, 'catalog_sent_for', today);
    console.log(`[Cron] Каталог ${today}: найдено ${guests.length}, отправлено ${results.sent}, ошибок ${results.failed}`);
  }

  return { buildCatalogMessage: text, sendManual, runMondayCron, runMeetingDayCron: runMondayCron };
}

module.exports = { createCatalog, buildCatalogMessage };
