const TelegramBot = require('node-telegram-bot-api');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// ==============================
//  КОНФІГУРАЦІЯ — заповни сюди
// ==============================
const BOT_TOKEN      = process.env.BOT_TOKEN || '8663329191:AAHGH2n94b75JQNKZqDrGrc_oK4nYO6KkCA';
const MAIN_GROUP_ID = -1003808813847;          // ID основної групи
const ADMIN_GROUP_ID = -5241972404;         // ID адмін групи (якщо є)
const OWNER_USERNAME = 'rezm1t'; 

const ADMIN_USERNAMES = [
  'Innzyy', 'Freezy', 'Rezm1t', 'lidnik01',
  'w1zen', 'illaG4', 'S3ruy', 'Zyx', 'Suslyk', 'Ro1az'
];

// ==============================
//  FIREBASE
// ==============================
// Варіант 1 (хостинг): env змінна FIREBASE_SERVICE_ACCOUNT = весь JSON одним рядком
// Варіант 2 (локально): файл serviceAccountKey.json поруч з bot.js
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
} else {
  try {
    serviceAccount = require('./serviceAccountKey.json');
  } catch(e) {
    console.error('❌ Firebase credentials не знайдено!\n' +
      '  Хостинг: додай env змінну FIREBASE_SERVICE_ACCOUNT\n' +
      '  Локально: поклади serviceAccountKey.json поруч з bot.js');
    process.exit(1);
  }
}
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ==============================
//  БОТ
// ==============================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ==============================
//  ПЕРЕВІРКИ РОЛЕЙ
// ==============================
function getUsername(msg) {
  return msg.from?.username || null;
}

function isOwner(msg) {
  return getUsername(msg) === OWNER_USERNAME;
}

function isAdmin(msg) {
  const u = getUsername(msg);
  return u && ADMIN_USERNAMES.includes(u);
}

// Middleware — тихо ігнорує якщо не адмін
// Повертає true якщо доступ дозволено, false якщо ні
async function guardAdmin(msg) {
  if (isAdmin(msg)) return true;
  // не відповідаємо нічого — бот просто мовчить для сторонніх
  return false;
}

// Middleware — тільки owner, з повідомленням для адмінів
async function guardOwner(msg) {
  if (!isAdmin(msg)) return false; // сторонні — мовчимо
  if (isOwner(msg)) return true;
  await bot.sendMessage(msg.chat.id, '🚫 Тільки власник може виконати цю команду.');
  return false;
}

// ==============================
//  ХЕЛПЕРИ
// ==============================
function getMonthLabel() {
  return new Date().toLocaleString('uk-UA', { month: 'long', year: 'numeric' });
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split(/[., :/]/);
  return new Date(parts[2], parts[1] - 1, parts[0]);
}

// ==============================
//  /start  /help
// ==============================
bot.onText(/\/(start|help)/, async (msg) => {
  if (!await guardAdmin(msg)) return;
  const chatId = msg.chat.id;

  const isOw = isOwner(msg);
  bot.sendMessage(chatId,
`🛹 *IFR Samokater Bot*

Доступні команди:
/stats — статистика порушень
/members — кількість людей у групах
${isOw ? '/sync — синхронізувати дані\n/admins — список адмінів' : ''}

_Ivano\\-Frankivsk Samokater Team_`,
    { parse_mode: 'MarkdownV2' }
  );
});

// ==============================
//  /stats
// ==============================
bot.onText(/\/stats/, async (msg) => {
  if (!await guardAdmin(msg)) return;
  const chatId = msg.chat.id;

  try {
    const snap = await db.collection('violations').get();
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear  = now.getFullYear();

    let total = 0, bans = 0, warns = 0, monthWarns = 0, monthBans = 0;
    const userWarns = {};

    snap.forEach(doc => {
      const d = doc.data();
      total++;
      if (d.warns >= 4) bans++; else warns++;

      const date = parseDate(d.date);
      if (date && date.getMonth() === thisMonth && date.getFullYear() === thisYear) {
        if (d.warns >= 4) monthBans++; else monthWarns++;
      }

      userWarns[d.name] = (userWarns[d.name] || 0) + d.warns;
    });

    const top = Object.entries(userWarns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, w], i) => `${i + 1}\\. @${name} — ${w} ⚠️`)
      .join('\n');

    bot.sendMessage(chatId,
`📊 *Статистика порушень*

📅 *${getMonthLabel().replace(/[-.]/g, '\\$&')}*
├ Попереджень: *${monthWarns}*
└ Банів: *${monthBans}*

📋 *Загалом у базі*
├ Всього записів: *${total}*
├ Попереджень: *${warns}*
└ Банів: *${bans}*

🏆 *Топ порушників*
${top || '— поки нікого'}`,
      { parse_mode: 'MarkdownV2' }
    );
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, '❌ Помилка при отриманні статистики.');
  }
});

// ==============================
//  /members
// ==============================
bot.onText(/\/members/, async (msg) => {
  if (!await guardAdmin(msg)) return;
  const chatId = msg.chat.id;

  try {
    const [mainCount, adminCount] = await Promise.all([
      bot.getChatMemberCount(MAIN_GROUP_ID),
      bot.getChatMemberCount(ADMIN_GROUP_ID).catch(() => null),
    ]);

    await db.collection('meta').doc('ownerPanel').set({
      mainGroupCount:  mainCount,
      adminGroupCount: adminCount ?? 0,
      updatedAt: new Date().toISOString(),
    }, { merge: true });

    let text = `👥 *Учасники груп*\n\n🛹 Основна група: *${mainCount}* осіб\n`;
    if (adminCount !== null) text += `🔐 Адмін група: *${adminCount}* осіб`;

    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, '❌ Не вдалось отримати кількість учасників.');
  }
});

// ==============================
//  /sync  (тільки owner)
// ==============================
bot.onText(/\/sync/, async (msg) => {
  if (!await guardOwner(msg)) return;
  const chatId = msg.chat.id;

  try {
    const [mainCount, adminCount] = await Promise.all([
      bot.getChatMemberCount(MAIN_GROUP_ID),
      bot.getChatMemberCount(ADMIN_GROUP_ID).catch(() => 0),
    ]);

    const snap = await db.collection('violations').get();
    const now = new Date();
    const thisMonth = now.getMonth();
    const thisYear  = now.getFullYear();

    let monthWarns = 0, monthBans = 0;
    snap.forEach(doc => {
      const d = doc.data();
      const date = parseDate(d.date);
      if (date && date.getMonth() === thisMonth && date.getFullYear() === thisYear) {
        if (d.warns >= 4) monthBans++; else monthWarns++;
      }
    });

    await db.collection('meta').doc('ownerPanel').set({
      mainGroupCount: mainCount, adminGroupCount: adminCount,
      monthWarns, monthBans, updatedAt: new Date().toISOString(),
    });

    bot.sendMessage(chatId,
`✅ *Синхронізовано успішно\\!*

👥 Основна група: *${mainCount}*
🔐 Адмін група: *${adminCount}*
⚠️ Попереджень цього місяця: *${monthWarns}*
🔨 Банів цього місяця: *${monthBans}*`,
      { parse_mode: 'MarkdownV2' }
    );
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, '❌ Помилка синхронізації: ' + e.message);
  }
});

// ==============================
//  /admins  (тільки owner)
// ==============================
bot.onText(/\/admins/, async (msg) => {
  if (!await guardOwner(msg)) return;
  const chatId = msg.chat.id;

  const list = ADMIN_USERNAMES
    .map((u, i) => `${i === 0 ? '♛' : `${i}.`} @${u}${i === 0 ? ' \\(Owner\\)' : ''}`)
    .join('\n');

  bot.sendMessage(chatId,
`👥 *Список адміністрації*\n\n${list}`,
    { parse_mode: 'MarkdownV2' }
  );
});

// ==============================
//  АВТО-СИНХРОНІЗАЦІЯ щогодини
// ==============================
setInterval(async () => {
  try {
    const [mainCount, adminCount] = await Promise.all([
      bot.getChatMemberCount(MAIN_GROUP_ID),
      bot.getChatMemberCount(ADMIN_GROUP_ID).catch(() => 0),
    ]);

    const snap = await db.collection('violations').get();
    const now = new Date();
    const thisMonth = now.getMonth(), thisYear = now.getFullYear();
    let monthWarns = 0, monthBans = 0;

    snap.forEach(doc => {
      const d = doc.data();
      const date = parseDate(d.date);
      if (date && date.getMonth() === thisMonth && date.getFullYear() === thisYear) {
        if (d.warns >= 4) monthBans++; else monthWarns++;
      }
    });

    await db.collection('meta').doc('ownerPanel').set({
      mainGroupCount: mainCount, adminGroupCount: adminCount,
      monthWarns, monthBans, updatedAt: new Date().toISOString(),
    });

    console.log(`[${new Date().toLocaleString()}] Авто-синхронізація OK`);
  } catch (e) {
    console.error('Авто-синхронізація помилка:', e.message);
  }
}, 60 * 60 * 1000);

// ==============================
//  ІГНОРУЄМО ВСІ ІНШІ ПОВІДОМЛЕННЯ
//  від не-адмінів — бот просто мовчить
// ==============================
bot.on('message', (msg) => {
  // цей обробник спрацьовує після всіх onText
  // нічого не робимо — просто мовчимо для сторонніх
});

console.log('🤖 Samokater Bot запущено!');
