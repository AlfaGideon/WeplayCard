/*
 * engine.js — ядро игры "WeplayCard" (Дуэль лжи).
 *
 * Это чистая логика без DOM, работает и в браузере, и в Node.js.
 * В браузере доступно как window.WeplayEngine, в Node — через require('./engine.js').
 *
 * Колода: 4 цвета (Синий, Красный, Жёлтый, Фиолетовый) × значения 1..9 = 36 карт.
 * Раздача как в Холдеме: 2 карты в руки + 5 общих (3, потом 1, потом 1).
 * Комбинации ранжируются по "уровню" (1 — слабейшая, 9 — сильнейшая),
 * строго по нумерации из ТЗ пользователя.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WeplayEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- Справочники -----------------------------------------------------------
  const COLORS = [
    { id: 0, name: 'Синий',      short: 'С', css: '#3b82f6', tint: 'rgba(59,130,246,0.18)' },
    { id: 1, name: 'Красный',    short: 'К', css: '#ef4444', tint: 'rgba(239,68,68,0.18)' },
    { id: 2, name: 'Жёлтый',     short: 'Ж', css: '#eab308', tint: 'rgba(234,179,8,0.18)' },
    { id: 3, name: 'Фиолетовый', short: 'Ф', css: '#a855f7', tint: 'rgba(168,85,247,0.18)' },
  ];

  // Уровень = сила комбинации (чем выше, тем сильнее), строго по ТЗ.
  const LEVEL_NAMES = {
    1: 'Барашек',     // старшая карта
    2: 'Кабан',       // одна пара
    3: 'Волк',        // две пары
    4: 'Буревестник', // три карты одного числа (сет)
    5: 'Морал',       // 5 последовательных карт (стрит)
    6: 'Носорог',     // три + пара (фулл-хаус)
    7: 'Медведь',     // 5 карт одного цвета (флеш)
    8: 'Титан',       // 4 одинаковые (каре)
    9: 'Дракон',      // 5 последовательных одного цвета (стрит-флеш)
  };

  const LEVEL_DESC = {
    1: 'Старшая карта — нет комбинаций',
    2: 'Одна пара',
    3: 'Две пары',
    4: 'Три карты одного числа',
    5: 'Пять последовательных карт (любые цвета)',
    6: 'Тройка + пара',
    7: 'Пять карт одного цвета',
    8: 'Четыре одинаковые карты',
    9: 'Пять последовательных карт одного цвета',
  };

  // --- Базовые утилиты -------------------------------------------------------
  function buildDeck() {
    const d = [];
    for (let c = 0; c < 4; c++) for (let v = 1; v <= 9; v++) d.push({ c, v });
    return d;
  }

  // Уникальный ключ карты (цвет*10 + значение), чтобы быстро сравнивать/исключать.
  function cardKey(card) { return card.c * 10 + card.v; }

  function cardLabel(card) {
    return (COLORS[card.c] ? COLORS[card.c].short : '?') + card.v;
  }

  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // Все сочетания по k элементов из массива индексов.
  function combinations(arr, k) {
    const res = [];
    (function rec(start, combo) {
      if (combo.length === k) { res.push(combo.slice()); return; }
      for (let i = start; i < arr.length; i++) {
        combo.push(arr[i]); rec(i + 1, combo); combo.pop();
      }
    })(0, []);
    return res;
  }

  // Лексикографическое сравнение массивов-счёта (для определения победителя).
  function compareScore(a, b) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const x = a[i] || 0, y = b[i] || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  // --- Оценка ровно 5 карт ---------------------------------------------------
  // Возвращает { level, name, score:[level, ...тайбрейк], cards }.
  function evaluate5(cards) {
    const values = cards.map(x => x.v);
    const asc = values.slice().sort((a, b) => a - b);      // по возрастанию
    const desc = values.slice().sort((a, b) => b - a);     // по убыванию

    const colorCounts = {};
    const valueCounts = {};
    cards.forEach(x => {
      colorCounts[x.c] = (colorCounts[x.c] || 0) + 1;
      valueCounts[x.v] = (valueCounts[x.v] || 0) + 1;
    });

    const isFlush = Object.keys(colorCounts).some(c => colorCounts[c] === 5);
    const uniq = [...new Set(asc)];
    const isStraight = uniq.length === 5 && (uniq[4] - uniq[0] === 4);

    // Группируем по значениям: сначала по количеству, потом по старшинству.
    const groups = Object.keys(valueCounts)
      .map(v => ({ v: +v, n: valueCounts[v] }))
      .sort((a, b) => (b.n - a.n) || (b.v - a.v));

    let quad = null, trip = null, pairs = [];
    groups.forEach(g => {
      if (g.n === 4) quad = g.v;
      else if (g.n === 3) trip = g.v;
      else if (g.n === 2) pairs.push(g.v);
    });
    pairs.sort((a, b) => b - a);
    const singles = groups.filter(g => g.n === 1).map(g => g.v).sort((a, b) => b - a);

    let level, score;

    if (isFlush && isStraight) {
      level = 9;                                  // Дракон — стрит-флеш
      score = [9, uniq[4]];
    } else if (quad !== null) {
      level = 8;                                  // Титан — каре
      score = [8, quad, singles[0]];
    } else if (trip !== null && pairs.length >= 1) {
      level = 6;                                  // Носорог — фулл-хаус
      score = [6, trip, pairs[0]];
    } else if (isFlush) {
      level = 7;                                  // Медведь — флеш
      score = [7, ...desc];
    } else if (isStraight) {
      level = 5;                                  // Морал — стрит
      score = [5, uniq[4]];
    } else if (trip !== null) {
      level = 4;                                  // Буревестник — сет
      score = [4, trip, ...singles];
    } else if (pairs.length === 2) {
      level = 3;                                  // Волк — две пары
      score = [3, pairs[0], pairs[1], singles[0]];
    } else if (pairs.length === 1) {
      level = 2;                                  // Кабан — пара
      score = [2, pairs[0], ...singles];
    } else {
      level = 1;                                  // Барашек — старшая
      score = [1, ...desc];
    }

    return { level, name: LEVEL_NAMES[level], score, cards: cards.slice() };
  }

  // --- Лучшая 5-ка из 5..7 карт ---------------------------------------------
  // Возвращает лучший evaluate5 среди всех сочетаний по 5.
  function bestHand(cards) {
    if (!cards || cards.length < 5) {
      return { level: 0, name: '—', score: [0], cards: cards ? cards.slice() : [],
               note: 'недостаточно карт для комбинации (нужно минимум 5)' };
    }
    const idx = cards.map((_, i) => i);
    let best = null;
    for (const combo of combinations(idx, 5)) {
      const five = combo.map(i => cards[i]);
      const e = evaluate5(five);
      if (!best || compareScore(e.score, best.score) > 0) best = e;
    }
    return best;
  }

  // --- Один розыгрыш (Монте-Карло) ------------------------------------------
  // Добирает недостающие общие карты и руки соперников из оставшейся колоды,
  // сводит в показдаун и сравнивает.
  function playOnce(heroHole, community, numOpponents, rng) {
    rng = rng || Math.random;
    const used = new Set([...heroHole, ...community].map(cardKey));
    const remaining = buildDeck().filter(c => !used.has(cardKey(c)));
    shuffle(remaining, rng);

    let p = 0;
    const need = 5 - community.length;
    const drawn = remaining.slice(p, p + need); p += need;
    const fullCommunity = community.concat(drawn);

    const heroScore = bestHand(heroHole.concat(fullCommunity)).score;

    let maxOpp = [0];
    for (let i = 0; i < numOpponents; i++) {
      const oppHole = remaining.slice(p, p + 2); p += 2;
      const s = bestHand(oppHole.concat(fullCommunity)).score;
      if (compareScore(s, maxOpp) > 0) maxOpp = s;
    }

    let result;
    const cmp = compareScore(heroScore, maxOpp);
    if (cmp > 0) result = 'win';
    else if (cmp === 0) result = 'tie';
    else result = 'lose';

    return { result, heroLevel: heroScore[0], heroScore };
  }

  // --- Полная симуляция (синхронно) -----------------------------------------
  function simulate(opts) {
    const heroHole = opts.heroHole || [];
    const community = opts.community || [];
    const numOpponents = opts.numOpponents || 1;
    const iterations = opts.iterations || 20000;
    const rng = opts.rng || Math.random;

    let win = 0, tie = 0, lose = 0;
    const levelHist = {};
    const levelWins = {}; // победы по уровню финальной руки героя

    for (let i = 0; i < iterations; i++) {
      const r = playOnce(heroHole, community, numOpponents, rng);
      if (r.result === 'win') { win++; levelWins[r.heroLevel] = (levelWins[r.heroLevel] || 0) + 1; }
      else if (r.result === 'tie') tie++;
      else lose++;
      levelHist[r.heroLevel] = (levelHist[r.heroLevel] || 0) + 1;
    }

    const equity = (win + tie / 2) / iterations;
    return {
      iterations,
      win, tie, lose,
      winPct: win / iterations,
      tiePct: tie / iterations,
      losePct: lose / iterations,
      equity,
      levelHist,
      levelWins,
    };
  }

  // --- Рекомендация по ставке -----------------------------------------------
  // equity — доля (0..1). Возвращает текст и класс для подсветки.
  function recommend(equity, betToCall, pot) {
    // Если заданы пот-оддсы, учитываем их: нужно equity > bet/(pot+bet).
    let oddsNote = '';
    if (typeof betToCall === 'number' && typeof pot === 'number' && pot + betToCall > 0) {
      const need = betToCall / (pot + betToCall);
      oddsNote = ` (нужно ≥ ${(need * 100).toFixed(0)}% по пот-оддсам)`;
      if (equity >= need && equity >= 0.5) {
        return { text: 'УРАВНИВАЙ / ПОДНИМАЙ', cls: 'call', emoji: '✅', note: oddsNote };
      }
    }
    if (equity >= 0.66) return { text: 'ПОДНИМАЙ СТАВКУ', cls: 'raise', emoji: '🔥', note: oddsNote };
    if (equity >= 0.5)  return { text: 'УРАВНИВАЙ (Call)', cls: 'call', emoji: '✅', note: oddsNote };
    if (equity >= 0.33) return { text: 'Малая ставка / рискованный блеф', cls: 'warn', emoji: '⚠️', note: oddsNote };
    return { text: 'ПАСУЙ (Fold)', cls: 'fold', emoji: '🛑', note: oddsNote };
  }

  return {
    COLORS, LEVEL_NAMES, LEVEL_DESC,
    buildDeck, cardKey, cardLabel, shuffle, combinations, compareScore,
    evaluate5, bestHand, playOnce, simulate, recommend,
  };
});
