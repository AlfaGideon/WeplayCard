/*
 * bot.js — опциональный Telegram-бот-помощник для WeplayCard.
 *
 * Переиспользует engine.js (та же математика, что и в веб-версии).
 * Требует установки зависимости и токен от @BotFather:
 *
 *     npm install node-telegram-bot-api
 *     TELEGRAM_TOKEN=твой_токен node bot.js
 *
 * Команды в чате:
 *   /start
 *   /calc <твои 2 карты> <общие карты> <соперников>
 *
 * Формат карты: <цвет><значение>
 *   цвета:  С = Синий, К = Красный, Ж = Жёлтый, Ф = Фиолетовый
 *   значение: 1..9
 * Пример:  /calc С9 К9 С5К2Ж7Ф3 2
 *   → твои карты С9 и К9, на столе 5 карт, 2 соперника.
 *
 * Без аргументов /calc покажет справку.
 */
'use strict';

const E = require('./engine.js');

const COLOR_MAP = { С: 0, К: 1, Ж: 2, Ф: 3 };

function parseCard(s) {
  const m = /^([СКЖФ])(\d)$/.exec(s.trim());
  if (!m) return null;
  const c = COLOR_MAP[m[1]];
  const v = parseInt(m[2], 10);
  if (v < 1 || v > 9) return null;
  return { c, v };
}

function parseArgs(text) {
  const tokens = (text || '').trim().split(/\s+/).filter(Boolean);
  const cards = [];
  let opponents = 1;
  for (const t of tokens) {
    if (/^\d$/.test(t) && Number(t) >= 1 && Number(t) <= 3) { opponents = Number(t); continue; }
    // токен может содержать несколько карт слитно, напр. "С5К2Ж7Ф3"
    const many = t.match(/[СКЖФ]\d/g);
    if (many) { for (const mc of many) { const card = parseCard(mc); if (!card) return null; cards.push(card); } }
    else { const card = parseCard(t); if (card) cards.push(card); }
  }
  return { cards, opponents };
}

function formatResult(s, opponents) {
  const winChance = typeof s.winChance === 'number' ? s.winChance : s.equity;
  let out = '';
  out += '🎯 Шанс победить: ' + (winChance * 100).toFixed(1) + '%\n';
  out += '✅ Комбинация сильнее: ' + (s.winPct * 100).toFixed(1) + '%\n';
  out += '🎲 Равная комбинация (решает удача): ' + (s.tiePct * 100).toFixed(1) + '%\n';
  out += '❌ Комбинация слабее: ' + (s.losePct * 100).toFixed(1) + '%\n';
  if (s.exact) out += '🔎 Точный перебор всех ' + s.iterations.toLocaleString('ru') + ' раскладов.\n';
  const rec = E.recommend(winChance);
  out += '\n' + rec.emoji + ' ' + rec.text + '\n';
  out += 'Итераций: ' + s.iterations.toLocaleString('ru') + ', соперников: ' + opponents +
    ', игроков всего: ' + (opponents + 1);
  return out;
}

function main() {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) {
    console.error('Укажи токен: TELEGRAM_TOKEN=твой_токен node bot.js');
    process.exit(1);
  }
  // lazy require — если пакет не установлен, упадём с понятной ошибкой
  let TelegramBot;
  try { TelegramBot = require('node-telegram-bot-api'); }
  catch (e) {
    console.error('Не найден node-telegram-bot-api. Установи: npm install node-telegram-bot-api');
    process.exit(1);
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log('WeplayCard Telegram-бот запущен.');

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
      'Привет! Я помощник за столом «Дуэль лжи» WeplayCard.\n\n' +
      'Команда:\n/calc <твои 2 карты> <общие карты> <соперников>\n\n' +
      'Цвета: С К Ж Ф, значения 1-9.\nПример: /calc С9 К9 С5К2Ж7Ф3 2');
  });

  bot.onText(/\/calc(.+)?/, (msg, match) => {
    const arg = match && match[1] ? match[1] : '';
    if (!arg.trim()) {
      bot.sendMessage(msg.chat.id, 'Формат: /calc С9 К9 С5К2Ж7Ф3 2\nЦвета: С К Ж Ф, значения 1-9.');
      return;
    }
    const parsed = parseArgs(arg);
    if (!parsed || parsed.cards.length < 2) {
      bot.sendMessage(msg.chat.id, 'Не разобрал карты. Пример: /calc С9 К9 С5К2Ж7Ф3 2');
      return;
    }
    const hero = parsed.cards.slice(0, 2);
    const table = parsed.cards.slice(2, 7);
    if (hero.length !== 2) {
      bot.sendMessage(msg.chat.id, 'Нужно ровно 2 твои карты (первые две в команде).');
      return;
    }
    // проверка на дубликаты
    const keys = new Set();
    for (const c of hero.concat(table)) {
      const k = E.cardKey(c);
      if (keys.has(k)) { bot.sendMessage(msg.chat.id, 'Одна и та же карта встречается дважды — проверь ввод.'); return; }
      keys.add(k);
    }
    // На готовом столе для 1–2 соперников считаем каждый расклад закрытых
    // карт, а не приближаем ответ случайной выборкой.
    const s = table.length === 5 && parsed.opponents <= 2 && typeof E.simulateExact === 'function'
      ? E.simulateExact({ heroHole: hero, community: table, numOpponents: parsed.opponents })
      : E.simulate({ heroHole: hero, community: table, numOpponents: parsed.opponents, iterations: 20000 });
    bot.sendMessage(msg.chat.id, formatResult(s, parsed.opponents));
  });
}

if (require.main === module) main();

module.exports = { parseCard, parseArgs, formatResult };
