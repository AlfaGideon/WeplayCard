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

  // --- Оценка для <5 карт (префлоп / неполный борд) -----------------------
  // Нужна чтобы показать Барашка/Кабана сразу после выбора 1-2 карманных.
  // Для <5 стрит/флеш невозможны, остаются только сет/пары/старшая.
  function evaluatePartial(cards) {
    const n = cards ? cards.length : 0;
    if (!n) return { level: 0, name: '—', score: [0], cards: [], desc: '' };
    if (n === 1) {
      return { level: 1, name: LEVEL_NAMES[1], score: [1, cards[0].v], cards: cards.slice(), desc: LEVEL_DESC[1] };
    }
    const valueCounts = {};
    cards.forEach(function(c){ valueCounts[c.v] = (valueCounts[c.v] || 0) + 1; });
    const groups = Object.keys(valueCounts).map(function(v){ return { v: +v, n: valueCounts[v] }; })
      .sort(function(a,b){ return (b.n - a.n) || (b.v - a.v); });
    let quad = null, trip = null, pairs = [];
    groups.forEach(function(g){
      if (g.n === 4) quad = g.v;
      else if (g.n === 3) trip = g.v;
      else if (g.n === 2) pairs.push(g.v);
    });
    pairs.sort(function(a,b){ return b - a; });
    const singles = groups.filter(function(g){ return g.n === 1; }).map(function(g){ return g.v; }).sort(function(a,b){ return b - a; });
    const descVals = cards.map(function(c){ return c.v; }).sort(function(a,b){ return b - a; });
    const sortedCards = cards.slice().sort(function(a,b){ return b.v - a.v; });
    let level, score, bestCards;
    if (quad !== null) {
      level = 8;
      score = [8, quad].concat(singles);
      bestCards = cards.filter(function(c){ return c.v === quad; }).concat(sortedCards.filter(function(c){ return c.v !== quad; }));
    } else if (trip !== null) {
      level = 4;
      score = [4, trip].concat(singles);
      bestCards = cards.filter(function(c){ return c.v === trip; }).concat(sortedCards.filter(function(c){ return c.v !== trip; }));
    } else if (pairs.length >= 2) {
      level = 3;
      score = [3, pairs[0], pairs[1]].concat(singles);
      bestCards = [];
      pairs.forEach(function(pv){ cards.filter(function(c){ return c.v === pv; }).forEach(function(c){ bestCards.push(c); }); });
      sortedCards.filter(function(c){ return pairs.indexOf(c.v) === -1; }).forEach(function(c){ bestCards.push(c); });
    } else if (pairs.length === 1) {
      level = 2;
      score = [2, pairs[0]].concat(singles);
      bestCards = cards.filter(function(c){ return c.v === pairs[0]; }).concat(sortedCards.filter(function(c){ return c.v !== pairs[0]; }));
    } else {
      level = 1;
      score = [1].concat(descVals);
      bestCards = sortedCards;
    }
    return { level: level, name: LEVEL_NAMES[level], score: score, cards: bestCards, desc: LEVEL_DESC[level] };
  }

  // Универсальная лучшая рука для любого количества карт (1..7)
  // Для >=5 использует полный перебор по 5, для <5 — evaluatePartial
  function bestHandAny(cards) {
    if (!cards || !cards.length) return { level: 0, name: '—', score: [0], cards: [], desc: '' };
    if (cards.length >= 5) return bestHand(cards);
    return evaluatePartial(cards);
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
  // сводит в показдаун и сравнивает. В «Дуэли лжи» банк не делится:
  // при полностью равных комбинациях удача выбирает одного из N равных игроков.
  // Поэтому winChance = 1/N — шанс героя стать единственным победителем в
  // таком равном противостоянии, а не доля банка.
  function playOnce(heroHole, community, numOpponents, rng) {
    rng = rng || Math.random;
    const opponents = Number.isInteger(numOpponents) ? numOpponents : 1;
    if (opponents < 1) throw new Error('Нужен хотя бы один соперник');
    if (!heroHole || heroHole.length !== 2) throw new Error('У героя должно быть ровно 2 карты');
    if (!community || community.length > 5) throw new Error('На столе должно быть от 0 до 5 карт');

    const usedCards = heroHole.concat(community);
    const used = new Set(usedCards.map(cardKey));
    if (used.size !== usedCards.length) throw new Error('Одна и та же известная карта указана дважды');

    const cardsNeeded = (5 - community.length) + opponents * 2;
    const remaining = buildDeck().filter(c => !used.has(cardKey(c)));
    if (cardsNeeded > remaining.length) throw new Error('В колоде недостаточно карт для всех соперников');
    shuffle(remaining, rng);

    let p = 0;
    const need = 5 - community.length;
    const drawn = remaining.slice(p, p + need); p += need;
    const fullCommunity = community.concat(drawn);

    const heroScore = bestHand(heroHole.concat(fullCommunity)).score;
    const scores = [heroScore];
    for (let i = 0; i < opponents; i++) {
      const oppHole = remaining.slice(p, p + 2); p += 2;
      scores.push(bestHand(oppHole.concat(fullCommunity)).score);
    }

    let bestScore = scores[0];
    for (let i = 1; i < scores.length; i++) {
      if (compareScore(scores[i], bestScore) > 0) bestScore = scores[i];
    }
    const winners = scores.filter(score => compareScore(score, bestScore) === 0);
    const heroIsWinner = compareScore(heroScore, bestScore) === 0;
    const tiedPlayers = heroIsWinner ? winners.length : 0;

    let result, winChance;
    if (!heroIsWinner) {
      result = 'lose';
      winChance = 0;
    } else if (tiedPlayers === 1) {
      result = 'win';
      winChance = 1;
    } else {
      // Это не делёж: удача в игре выбирает одного победителя из равных рук.
      result = 'tie';
      winChance = 1 / tiedPlayers;
    }

    return { result, winChance, tiedPlayers, heroLevel: heroScore[0], heroScore };
  }

  // --- Полная симуляция (синхронно) -----------------------------------------
  function simulate(opts) {
    opts = opts || {};
    const heroHole = opts.heroHole || [];
    const community = opts.community || [];
    const numOpponents = Number.isInteger(opts.numOpponents) ? opts.numOpponents : 1;
    const iterations = Number.isInteger(opts.iterations) && opts.iterations > 0 ? opts.iterations : 20000;
    const rng = opts.rng || Math.random;

    let win = 0, tie = 0, lose = 0, winChanceTotal = 0;
    const levelHist = {};
    const levelWins = {}; // чистые победы по уровню финальной руки героя

    for (let i = 0; i < iterations; i++) {
      const r = playOnce(heroHole, community, numOpponents, rng);
      if (r.result === 'win') { win++; levelWins[r.heroLevel] = (levelWins[r.heroLevel] || 0) + 1; }
      else if (r.result === 'tie') tie++;
      else lose++;
      winChanceTotal += r.winChance;
      levelHist[r.heroLevel] = (levelHist[r.heroLevel] || 0) + 1;
    }

    // При равных руках один победитель выбирается удачей. Например, при
    // равенстве героя с двумя соперниками его шанс победить в этом исходе — 1/3.
    const winChance = winChanceTotal / iterations;
    return {
      iterations,
      win, tie, lose,
      winPct: win / iterations,       // победа более сильной комбинацией
      tiePct: tie / iterations,       // равные комбинации до случайной дуэли
      losePct: lose / iterations,
      winChance,
      // Оставляем alias для совместимости с предыдущими версиями API.
      equity: winChance,
      levelHist,
      levelWins,
    };
  }

  // --- Рекомендация по ставке -----------------------------------------------
  // winChance — шанс стать единственным победителем (0..1). betToCall — сумма
  // колла, pot — банк до колла. Возвращает текст и класс для подсветки.
  function recommend(winChance, betToCall, pot) {
    let oddsNote = '';
    if (typeof betToCall === 'number' && betToCall > 0 &&
        typeof pot === 'number' && pot >= 0 && pot + betToCall > 0) {
      const need = betToCall / (pot + betToCall);
      oddsNote = ` (нужно ≥ ${(need * 100).toFixed(0)}% по пот-оддсам)`;
      if (winChance >= need) {
        if (winChance >= 0.66) {
          return { text: 'ПОДНИМАЙ СТАВКУ', cls: 'raise', emoji: '🔥', note: oddsNote };
        }
        return { text: 'УРАВНИВАЙ ПО ПОТ-ОДДСАМ', cls: 'call', emoji: '✅', note: oddsNote };
      }
      return { text: 'ПАСУЙ — не хватает шанса', cls: 'fold', emoji: '🛑', note: oddsNote };
    }
    if (winChance >= 0.66) return { text: 'ПОДНИМАЙ СТАВКУ', cls: 'raise', emoji: '🔥', note: oddsNote };
    if (winChance >= 0.5)  return { text: 'УРАВНИВАЙ (Call)', cls: 'call', emoji: '✅', note: oddsNote };
    if (winChance >= 0.33) return { text: 'Малая ставка / рискованный блеф', cls: 'warn', emoji: '⚠️', note: oddsNote };
    return { text: 'ПАСУЙ (Fold)', cls: 'fold', emoji: '🛑', note: oddsNote };
  }

  return {
    COLORS, LEVEL_NAMES, LEVEL_DESC,
    buildDeck, cardKey, cardLabel, shuffle, combinations, compareScore,
    evaluate5, evaluatePartial, bestHand, bestHandAny, playOnce, simulate, recommend,
  };
});
