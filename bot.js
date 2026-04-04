const TelegramBot = require('node-telegram-bot-api');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
 
// ==============================
//  КОНФІГУРАЦІЯ — заповни сюди
// ==============================
const BOT_TOKEN     = '8663329191:AAHGH2n94b75JQNKZqDrGrc_oK4nYO6KkCA';       // від @BotFather
const MAIN_GROUP_ID = -1003808813847;          // ID основної групи
const ADMIN_GROUP_ID = -5241972404;         // ID адмін групи (якщо є)
const OWNER_USERNAME = 'innzyy';               // нікнейм власника без @
 
// ==============================
//  FIREBASE ADMIN INIT
// ==============================
const serviceAccount = require('./serviceAccountKey.json'); // завантаж з Firebase Console
 
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
 
// ==============================
//  БОТ INIT
// ==============================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
 
// ==============================
//  ХЕЛПЕРИ
// ==============================
function isOwner(msg) {
  return msg.from?.username === OWNER_USERNAME;
}
 
function getMonthLabel() {
  return new Date().toLocaleString('uk-UA', { month: 'long', year: 'numeric' });
}
 
function parseDate(dateStr) {
  // формат: "05.04.2026, 12:00:00"
  if (!dateStr) return null;
  const parts = dateStr.split(/[., :/]/);
  return new Date(parts[2], parts[1] - 1, parts[0]);
}
 
// ==============================
//  КОМАНДА /start або /help
// ==============================
bot.onText(/\/(start|help)/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
`🛹 *IFR Samokater Bot*
 
Доступні команди:
/stats — статистика порушень
/members — кількість людей у групах
/sync — синхронізувати дані (тільки owner)
 
_Бот групи Ivano-Frankivsk Samokater Team_`,
    { parse_mode: 'Markdown' }
  );
});
 
// ==============================
//  КОМАНДА /stats
// ==============================
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
 
  try {
    const snap = await db.collection('violations').get();
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
 
    let total = 0, bans = 0, warns = 0;
    let monthWarns = 0, monthBans = 0;
    const userWarns = {};
 
    snap.forEach(doc => {
      const d = doc.data();
      total++;
 
      if (d.warns >= 4) bans++;
      else warns++;
 
      // рахуємо за поточний місяць
      const date = parseDate(d.date);
      if (date && date.getMonth() === thisMonth && date.getFullYear() === thisYear) {
        if (d.warns >= 4) monthBans++;
        else monthWarns++;
      }
 
      // топ порушників
      if (!userWarns[d.name]) userWarns[d.name] = 0;
      userWarns[d.name] += d.warns;
    });
 
    // топ-3
    const top = Object.entries(userWarns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, w], i) => `${i + 1}. @${name} — ${w} ⚠️`)
      .join('\n');
 
    bot.sendMessage(chatId,
`📊 *Статистика порушень*
 
📅 *${getMonthLabel()}*
├ Попереджень: *${monthWarns}*
└ Банів: *${monthBans}*
 
📋 *Загалом у базі*
├ Всього записів: *${total}*
├ Попереджень: *${warns}*
└ Банів: *${bans}*
 
🏆 *Топ порушників*
${top || '— поки нікого'}`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, '❌ Помилка при отриманні статистики.');
  }
});
 
// ==============================
//  КОМАНДА /members
// ==============================
bot.onText(/\/members/, async (msg) => {
  const chatId = msg.chat.id;
 
  try {
    const [mainCount, adminCount] = await Promise.all([
      bot.getChatMemberCount(MAIN_GROUP_ID),
      bot.getChatMemberCount(ADMIN_GROUP_ID).catch(() => null),
    ]);
 
    let text = `👥 *Учасники груп*\n\n`;
    text += `🛹 Основна група: *${mainCount}* осіб\n`;
    if (adminCount !== null) {
      text += `🔐 Адмін група: *${adminCount}* осіб\n`;
    }
 
    // також записуємо в Firebase для owner panel
    await db.collection('meta').doc('groupStats').set({
      mainGroupCount: mainCount,
      adminGroupCount: adminCount ?? 0,
      updatedAt: new Date().toISOString(),
    });
 
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, '❌ Не вдалось отримати кількість учасників. Переконайся що бот є адміном групи.');
  }
});
 
// ==============================
//  КОМАНДА /sync (тільки owner)
// ==============================
bot.onText(/\/sync/, async (msg) => {
  const chatId = msg.chat.id;
 
  if (!isOwner(msg)) {
    return bot.sendMessage(chatId, '🚫 Тільки власник може виконати синхронізацію.');
  }
 
  try {
    const [mainCount, adminCount] = await Promise.all([
      bot.getChatMemberCount(MAIN_GROUP_ID),
      bot.getChatMemberCount(ADMIN_GROUP_ID).catch(() => 0),
    ]);
 
    const snap = await db.collection('violations').get();
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
 
    let monthWarns = 0, monthBans = 0;
    snap.forEach(doc => {
      const d = doc.data();
      const date = parseDate(d.date);
      if (date && date.getMonth() === thisMonth && date.getFullYear() === thisYear) {
        if (d.warns >= 4) monthBans++;
        else monthWarns++;
      }
    });
 
    await db.collection('meta').doc('ownerPanel').set({
      mainGroupCount: mainCount,
      adminGroupCount: adminCount,
      monthWarns,
      monthBans,
      updatedAt: new Date().toISOString(),
    });
 
    bot.sendMessage(chatId,
`✅ *Синхронізовано успішно!*
 
👥 Основна група: *${mainCount}*
🔐 Адмін група: *${adminCount}*
⚠️ Попереджень цього місяця: *${monthWarns}*
🔨 Банів цього місяця: *${monthBans}*`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, '❌ Помилка синхронізації: ' + e.message);
  }
});
 
// ==============================
//  АВТО-СИНХРОНІЗАЦІЯ кожну годину
// ==============================
setInterval(async () => {
  try {
    const [mainCount, adminCount] = await Promise.all([
      bot.getChatMemberCount(MAIN_GROUP_ID),
      bot.getChatMemberCount(ADMIN_GROUP_ID).catch(() => 0),
    ]);
 
    const snap = await db.collection('violations').get();
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear = now.getFullYear();
 
    let monthWarns = 0, monthBans = 0;
    snap.forEach(doc => {
      const d = doc.data();
      const date = parseDate(d.date);
      if (date && date.getMonth() === thisMonth && date.getFullYear() === thisYear) {
        if (d.warns >= 4) monthBans++;
        else monthWarns++;
      }
    });
 
    await db.collection('meta').doc('ownerPanel').set({
      mainGroupCount: mainCount,
      adminGroupCount: adminCount,
      monthWarns,
      monthBans,
      updatedAt: new Date().toISOString(),
    });
 
    console.log(`[${new Date().toLocaleString()}] Авто-синхронізація OK`);
  } catch (e) {
    console.error('Авто-синхронізація помилка:', e.message);
  }
}, 60 * 60 * 1000); // кожну годину
 
console.log('🤖 Samokater Bot запущено!');