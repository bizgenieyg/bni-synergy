'use strict';

// Post-meeting catalog message: shared by the manual button and the Monday 10:00 cron,
// so the text and the recipient selection cannot drift apart.

const FACEBOOK_BLOCK =
  `Приглашаем вас в нашу группу BNI SYNERGY в Facebook:\n` +
  `https://www.facebook.com/share/g/1PXaN6Uxgg/`;

function buildCatalogMessage(guest, getFirstName) {
  return (
    `Здравствуйте, ${getFirstName(guest.name)}! 👋\n\n` +
    `Рады были видеть вас сегодня на встрече BNI SYNERGY! 🤝\n\n` +
    `Надеемся, что помимо приятного общения вы нашли для себя деловой интерес и новые возможности для сотрудничества.\n\n` +
    `Для вашего удобства — каталог участников группы с профессиями и контактами:\n` +
    `https://bnisynergy.biz/members-catalog\n\n` +
    `${FACEBOOK_BLOCK}\n\n` +
    `Будем рады видеть вас снова! 😊\n` +
    `Команда BNI SYNERGY`
  );
}

function createCatalog({ db, whatsapp, getTodayStr, getSessionStatus }) {
  const recipientsFor = date => db.getGuestsByDate(date).filter(g => g.wa_enabled !== 0);

  function send(guests) {
    return whatsapp.sendWithDelay(guests, g => buildCatalogMessage(g, whatsapp.getFirstName));
  }

  // Manual button: any date; the dedup setting is only touched for today's meeting.
  async function sendManual(meetingDate) {
    const guests = recipientsFor(meetingDate);
    const results = await send(guests);
    if (meetingDate === getTodayStr() && results.sent > 0) db.setSetting('catalog_sent_for', meetingDate);
    return results;
  }

  // Monday 10:00: only guests of the meeting that takes place today.
  async function runMondayCron() {
    const today = getTodayStr();
    if (db.getAllSettings().catalog_sent_for === today) {
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
    if (results.sent > 0) db.setSetting('catalog_sent_for', today);
    console.log(`[Cron] Каталог ${today}: найдено ${guests.length}, отправлено ${results.sent}, ошибок ${results.failed}`);
  }

  return { buildCatalogMessage: g => buildCatalogMessage(g, whatsapp.getFirstName), sendManual, runMondayCron };
}

module.exports = { createCatalog, buildCatalogMessage, FACEBOOK_BLOCK };
