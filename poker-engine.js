/*
 * poker-engine.js — ядро покера (Техасский Холдем, колода 52 карты).
 *
 * Это чистая логика без DOM, работает и в браузере, и в Node.js.
 * В браузере доступно как window.PokerEngine, в Node — через require('./poker-engine.js').
 *
 * Колода: 4 масти (Пики, Червы, Бубны, Крести) × 13 рангов (2..A) = 52 карты.
 * Раздача как в Холдеме: 2 карты в руки + 5 общих (3, потом 1, потом 1).
 * Комбинации ранжируются стандартно для покера (уровень 1 — слабейшая, 9 — сильнейшая):
 *  1 Старшая карта · 2 Пара · 3 Две пары · 4 Сет · 5 Стрит ·
 *  6 Флеш · 7 Фулл-хаус · 8 Каре · 9 Стрит-флеш (роял-флеш — его вершина).
 *
 * Математика та же, что в engine.js (версия «Дуэли лжи»): когда полный перебор
 * умещается в возможности браузера — считаем все допустимые расклады точно,
 * иначе честно помеченную статистическую оценку с 95% доверительным интервалом.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PokerEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- Справочники -----------------------------------------------------------
  const SUITS = [
    { id: 0, name: 'Пики',     glyph: '♠', color: 'black' },
    { id: 1, name: 'Червы',    glyph: '♥', color: 'red' },
    { id: 2, name: 'Бубны',    glyph: '♦', color: 'red' },
    { id: 3, name: 'Крести',   glyph: '♣', color: 'black' },
  ];

  // Ранг 2..14 (14 = туз). Названия для интерфейса.
  const RANK_NAMES = {
    2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'В', 12: 'Д', 13: 'К', 14: 'Т',
  };
  const RANK_FULL = {
    2: 'двойка', 3: 'тройка', 4: 'четвёрка', 5: 'пятёрка', 6: 'шестёрка',
    7: 'семёрка', 8: 'восьмёрка', 9: 'девятка', 10: 'десятка',
    11: 'валет', 12: 'дама', 13: 'король', 14: 'туз',
  };

  // Уровень = сила комбинации (чем выше, тем сильнее), стандартный покерный порядок.
  const LEVEL_NAMES = {
    1: 'Старшая карта',
    2: 'Пара',
    3: 'Две пары',
    4: 'Сет (тройка)',
    5: 'Стрит',
    6: 'Флеш',
    7: 'Фулл-хаус',
    8: 'Каре',
    9: 'Стрит-флеш',
  };

  const LEVEL_DESC = {
    1: 'Нет комбинаций — решает старшая карта',
    2: 'Две карты одного ранга',
    3: 'Две пары',
    4: 'Три карты одного ранга',
    5: 'Пять последовательных карт (А-2-3-4-5 — младший стрит)',
    6: 'Пять карт одной масти',
    7: 'Тройка + пара',
    8: 'Четыре карты одного ранга',
    9: 'Пять последовательных карт одной масти; А-К-Д-В-10 — роял-флеш',
  };

  // --- Базовые утилиты -------------------------------------------------------
  function buildDeck() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ s, r });
    return d;
  }

  // Уникальный ключ карты (масть*100 + ранг), чтобы быстро сравнивать/исключать.
  function cardKey(card) { return card.s * 100 + card.r; }

  function cardLabel(card) {
    return (SUITS[card.s] ? SUITS[card.s].glyph : '?') + (RANK_NAMES[card.r] || card.r);
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

  // Старший стрит по битовой маске рангов. Возвращает старшую карту стрита
  // или 0. А-2-3-4-5 («колесо») считается младшим стритом со старшей пятёркой.
  function straightHigh(mask) {
    for (let high = 14; high >= 6; high--) {
      let ok = true;
      for (let r = high - 4; r <= high; r++) {
        if ((mask & (1 << r)) === 0) { ok = false; break; }
      }
      if (ok) return high;
    }
    // Колесо: биты 2,3,4,5 + туз (14) как младший.
    if ((mask & (1 << 14)) && (mask & 0b111100) === 0b111100) return 5;
    return 0;
  }

  // --- Оценка ровно 5 карт ---------------------------------------------------
  // Возвращает { level, name, score:[level, ...тайбрейк], cards }.
  function evaluate5(cards) {
    const rankCounts = {};
    const suitCounts = {};
    cards.forEach(x => {
      rankCounts[x.r] = (rankCounts[x.r] || 0) + 1;
      suitCounts[x.s] = (suitCounts[x.s] || 0) + 1;
    });

    const isFlush = Object.keys(suitCounts).some(s => suitCounts[s] === 5);
    let mask = 0;
    Object.keys(rankCounts).forEach(r => { mask |= (1 << Number(r)); });
    const straight = straightHigh(mask);

    // Группируем по рангам: сначала по количеству, потом по старшинству.
    const groups = Object.keys(rankCounts)
      .map(r => ({ r: +r, n: rankCounts[r] }))
      .sort((a, b) => (b.n - a.n) || (b.r - a.r));

    let quad = null, trip = null, pairs = [];
    groups.forEach(g => {
      if (g.n === 4) quad = g.r;
      else if (g.n === 3) trip = g.r;
      else if (g.n === 2) pairs.push(g.r);
    });
    pairs.sort((a, b) => b - a);
    const singles = groups.filter(g => g.n === 1).map(g => g.r).sort((a, b) => b - a);
    const desc = cards.map(x => x.r).sort((a, b) => b - a);

    let level, score;

    if (isFlush && straight) {
      level = 9;                                  // Стрит-флеш (роял при старшей A)
      score = [9, straight];
    } else if (quad !== null) {
      level = 8;                                  // Каре
      score = [8, quad, singles[0]];
    } else if (trip !== null && pairs.length >= 1) {
      level = 7;                                  // Фулл-хаус
      score = [7, trip, pairs[0]];
    } else if (isFlush) {
      level = 6;                                  // Флеш
      score = [6, ...desc];
    } else if (straight) {
      level = 5;                                  // Стрит
      score = [5, straight];
    } else if (trip !== null) {
      level = 4;                                  // Сет
      score = [4, trip, ...singles];
    } else if (pairs.length === 2) {
      level = 3;                                  // Две пары
      score = [3, pairs[0], pairs[1], singles[0]];
    } else if (pairs.length === 1) {
      level = 2;                                  // Пара
      score = [2, pairs[0], ...singles];
    } else {
      level = 1;                                  // Старшая карта
      score = [1, ...desc];
    }

    return { level, name: LEVEL_NAMES[level], score, cards: cards.slice() };
  }

  // --- Быстрый счёт для 5..7 карт ------------------------------------------
  // В точном расчёте важен только массив score, а не сами пять карт. Полный
  // перебор 21 пятёрки в bestHand() удобен для интерфейса, но слишком дорог
  // для точного расчёта всех раскладов. Эта функция получает тот же score
  // за один проход.
  function scoreHand(cards) {
    if (!cards || cards.length < 5) return bestHandAny(cards || []).score;

    const rankCounts = new Array(15).fill(0);       // индексы 2..14
    const suitMasks = [0, 0, 0, 0];
    const suitCounts = [0, 0, 0, 0];
    for (const card of cards) {
      rankCounts[card.r]++;
      suitCounts[card.s]++;
      suitMasks[card.s] |= (1 << card.r);
    }

    // Стрит-флеш: высший стрит в каждой масти (там, где 5+ карт одной масти).
    let straightFlushHigh = 0;
    for (let s = 0; s < 4; s++) {
      if (suitCounts[s] >= 5) straightFlushHigh = Math.max(straightFlushHigh, straightHigh(suitMasks[s]));
    }
    if (straightFlushHigh) return [9, straightFlushHigh];

    let quad = 0;
    for (let r = 14; r >= 2; r--) if (rankCounts[r] === 4) { quad = r; break; }
    if (quad) {
      for (let r = 14; r >= 2; r--) if (r !== quad && rankCounts[r]) return [8, quad, r];
    }

    // Фулл-хаус: высшая тройка + лучшая пара (вторая тройка тоже годится).
    let trip = 0, pairForFull = 0;
    for (let r = 14; r >= 2; r--) if (rankCounts[r] >= 3) { trip = r; break; }
    if (trip) {
      for (let r = 14; r >= 2; r--) {
        if (r !== trip && rankCounts[r] >= 2) { pairForFull = r; break; }
      }
    }
    if (trip && pairForFull) return [7, trip, pairForFull];

    // Флеш: пять старших карт масти (порядок: флеш младше фулл-хауса — стандарт).
    for (let s = 0; s < 4; s++) {
      if (suitCounts[s] >= 5) {
        const values = [];
        for (let r = 14; r >= 2 && values.length < 5; r--) if (suitMasks[s] & (1 << r)) values.push(r);
        return [6].concat(values);
      }
    }

    const straight = straightHigh(suitMasks[0] | suitMasks[1] | suitMasks[2] | suitMasks[3]);
    if (straight) return [5, straight];

    if (trip) {
      const kickers = [];
      for (let r = 14; r >= 2 && kickers.length < 2; r--) if (r !== trip && rankCounts[r]) kickers.push(r);
      return [4, trip].concat(kickers);
    }

    const pairs = [];
    for (let r = 14; r >= 2; r--) if (rankCounts[r] >= 2) pairs.push(r);
    if (pairs.length >= 2) {
      for (let r = 14; r >= 2; r--) if (r !== pairs[0] && r !== pairs[1] && rankCounts[r]) return [3, pairs[0], pairs[1], r];
    }
    if (pairs.length === 1) {
      const kickers = [];
      for (let r = 14; r >= 2 && kickers.length < 3; r--) if (r !== pairs[0] && rankCounts[r]) kickers.push(r);
      return [2, pairs[0]].concat(kickers);
    }

    const highs = [];
    for (let r = 14; r >= 2 && highs.length < 5; r--) if (rankCounts[r]) highs.push(r);
    return [1].concat(highs);
  }

  // --- Оценка для <5 карт (префлоп / неполный борд) ------------------------
  // Нужна чтобы показать пару/сет/старшую сразу после выбора 1-2 карманных.
  // Для <5 стрит/флеш невозможны, остаются только сет/пары/старшая.
  function evaluatePartial(cards) {
    const n = cards ? cards.length : 0;
    if (!n) return { level: 0, name: '—', score: [0], cards: [], desc: '' };
    if (n === 1) {
      return { level: 1, name: LEVEL_NAMES[1], score: [1, cards[0].r], cards: cards.slice(), desc: LEVEL_DESC[1] };
    }
    const rankCounts = {};
    cards.forEach(c => { rankCounts[c.r] = (rankCounts[c.r] || 0) + 1; });
    const groups = Object.keys(rankCounts).map(r => ({ r: +r, n: rankCounts[r] }))
      .sort((a, b) => (b.n - a.n) || (b.r - a.r));
    let quad = null, trip = null, pairs = [];
    groups.forEach(g => {
      if (g.n === 4) quad = g.r;
      else if (g.n === 3) trip = g.r;
      else if (g.n === 2) pairs.push(g.r);
    });
    pairs.sort((a, b) => b - a);
    const singles = groups.filter(g => g.n === 1).map(g => g.r).sort((a, b) => b - a);
    const descVals = cards.map(c => c.r).sort((a, b) => b - a);
    const sortedCards = cards.slice().sort((a, b) => b.r - a.r);
    let level, score, bestCards;
    if (quad !== null) {
      level = 8;
      score = [8, quad].concat(singles);
      bestCards = cards.filter(c => c.r === quad).concat(sortedCards.filter(c => c.r !== quad));
    } else if (trip !== null) {
      level = 4;
      score = [4, trip].concat(singles);
      bestCards = cards.filter(c => c.r === trip).concat(sortedCards.filter(c => c.r !== trip));
    } else if (pairs.length >= 2) {
      level = 3;
      score = [3, pairs[0], pairs[1]].concat(singles);
      bestCards = [];
      pairs.forEach(pv => cards.filter(c => c.r === pv).forEach(c => bestCards.push(c)));
      sortedCards.filter(c => pairs.indexOf(c.r) === -1).forEach(c => bestCards.push(c));
    } else if (pairs.length === 1) {
      level = 2;
      score = [2, pairs[0]].concat(singles);
      bestCards = cards.filter(c => c.r === pairs[0]).concat(sortedCards.filter(c => c.r !== pairs[0]));
    } else {
      level = 1;
      score = [1].concat(descVals);
      bestCards = sortedCards;
    }
    return { level, name: LEVEL_NAMES[level], score, cards: bestCards, desc: LEVEL_DESC[level] };
  }

  // Универсальная лучшая рука для любого количества карт (1..7).
  function bestHandAny(cards) {
    if (!cards || !cards.length) return { level: 0, name: '—', score: [0], cards: [], desc: '' };
    if (cards.length >= 5) return bestHand(cards);
    return evaluatePartial(cards);
  }

  // --- Лучшая 5-ка из 5..7 карт ---------------------------------------------
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

  // --- Точный расчёт всех допустимых раскладов ------------------------------
  // Для каждой возможной будущей доски считаем все совместимые пары
  // соперников, агрегируя по типу пары. Так же, как в engine.js.
  const EXACT_MAX_SCORE_EVALS = 2500000;
  const EXACT_MAX_MATCH_WORK = 80000000;

  function choose(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let result = 1;
    for (let i = 1; i <= k; i++) result = result * (n - k + i) / i;
    return result;
  }

  // Оценка объёма полного перебора. totalDeals — реальное число раздач;
  // workUnits — число агрегированных операций после оптимизации пар рук.
  // Полный перебор реализован для 1–3 соперников; при большем числе игроков
  // раскладов так много, что честный ответ даёт только статистическая оценка.
  function estimateExact(opts) {
    opts = opts || {};
    const community = opts.community || [];
    const opponents = Number.isInteger(opts.numOpponents) ? opts.numOpponents : 1;
    const knownCommunity = community.length;
    if (knownCommunity < 0 || knownCommunity > 5 || opponents < 1 || opponents > 9) {
      return { supported: false, totalDeals: 0, scoreEvals: 0, matchWork: 0 };
    }
    const unknownBeforeBoard = 50 - knownCommunity; // 52 - 2 карты героя - общие
    const boardToDraw = 5 - knownCommunity;
    const boardWays = choose(unknownBeforeBoard, boardToDraw);
    let cardsAfterBoard = unknownBeforeBoard - boardToDraw; // всегда 45
    let handsWays = 1;
    for (let i = 0; i < opponents; i++) {
      handsWays *= choose(cardsAfterBoard, 2);
      cardsAfterBoard -= 2;
    }
    let supported = opponents <= 3;
    let scoreEvals = 0, matchWork = 0;
    if (supported) {
      const pairsPerBoard = choose(45, 2);
      // Для 2 соперников второй счёт рук агрегируется по первой паре; для 3
      // нужно рассмотреть совместимые первые две пары и агрегировать третью.
      const matchWorkPerBoard = opponents === 3 ? pairsPerBoard * choose(43, 2) : pairsPerBoard;
      scoreEvals = boardWays * pairsPerBoard;
      matchWork = boardWays * matchWorkPerBoard;
      supported = scoreEvals <= EXACT_MAX_SCORE_EVALS && matchWork <= EXACT_MAX_MATCH_WORK;
    }
    return {
      supported,
      totalDeals: boardWays * handsWays,
      boardWays,
      scoreEvals,
      matchWork,
      knownCommunity,
      opponents,
    };
  }

  function exactLimitError(estimate) {
    const err = new Error('Точный перебор слишком велик для мгновенного расчёта');
    err.code = 'EXACT_TOO_LARGE';
    err.estimate = estimate;
    return err;
  }

  function forEachCombination(items, count, callback) {
    if (count === 0) { callback([]); return; }
    const selected = new Array(count);
    (function visit(start, depth) {
      if (depth === count) { callback(selected.slice()); return; }
      for (let i = start; i <= items.length - (count - depth); i++) {
        selected[depth] = i;
        visit(i + 1, depth + 1);
      }
    })(0, 0);
  }

  // Считает результаты для одной полностью открытой доски. В remaining всегда
  // 45 карт; тип пары: 0 — слабее героя, 1 — равна герою, 2 — сильнее героя.
  function countFinalBoard(heroScore, remaining, opponents, board) {
    const n = remaining.length;
    const pairTypes = Array.from({ length: n }, () => new Int8Array(n));
    const degrees = [new Int16Array(n), new Int16Array(n), new Int16Array(n)];
    const typeTotals = [0, 0, 0];
    const pairs = [];

    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        const cmp = compareScore(heroScore, scoreHand([remaining[a], remaining[b]].concat(board)));
        const type = cmp > 0 ? 0 : (cmp === 0 ? 1 : 2);
        pairTypes[a][b] = pairTypes[b][a] = type;
        degrees[type][a]++; degrees[type][b]++; typeTotals[type]++;
        pairs.push([a, b, type]);
      }
    }

    let win = 0, tie = 0, lose = 0, winChanceTotal = 0;
    if (opponents === 1) {
      win = typeTotals[0];
      tie = typeTotals[1];
      lose = typeTotals[2];
      winChanceTotal = win + tie / 2;
    } else if (opponents === 2) {
      for (const first of pairs) {
        const a = first[0], b = first[1], type = first[2];
        const available0 = typeTotals[0] - degrees[0][a] - degrees[0][b] + (type === 0 ? 1 : 0);
        const available1 = typeTotals[1] - degrees[1][a] - degrees[1][b] + (type === 1 ? 1 : 0);
        const available2 = typeTotals[2] - degrees[2][a] - degrees[2][b] + (type === 2 ? 1 : 0);
        if (type === 2) {
          lose += available0 + available1 + available2;
        } else if (type === 0) {
          win += available0;
          tie += available1;
          lose += available2;
          winChanceTotal += available0 + available1 / 2;
        } else {
          tie += available0 + available1;
          lose += available2;
          // Вторая равная пара означает 3 равных монстра: шанс героя 1/3.
          winChanceTotal += available0 / 2 + available1 / 3;
        }
      }
    } else {
      // Три соперника: фиксируем две непересекающиеся пары, а третью считаем
      // по степеням графа.
      for (const first of pairs) {
        const a = first[0], b = first[1], type1 = first[2];
        for (const second of pairs) {
          const c = second[0], d = second[1], type2 = second[2];
          if (a === c || a === d || b === c || b === d) continue;

          const internal0 = (type1 === 0 ? 1 : 0) + (type2 === 0 ? 1 : 0) +
            (pairTypes[a][c] === 0 ? 1 : 0) + (pairTypes[a][d] === 0 ? 1 : 0) +
            (pairTypes[b][c] === 0 ? 1 : 0) + (pairTypes[b][d] === 0 ? 1 : 0);
          const internal1 = (type1 === 1 ? 1 : 0) + (type2 === 1 ? 1 : 0) +
            (pairTypes[a][c] === 1 ? 1 : 0) + (pairTypes[a][d] === 1 ? 1 : 0) +
            (pairTypes[b][c] === 1 ? 1 : 0) + (pairTypes[b][d] === 1 ? 1 : 0);
          const internal2 = 6 - internal0 - internal1;
          const available0 = typeTotals[0] - degrees[0][a] - degrees[0][b] - degrees[0][c] - degrees[0][d] + internal0;
          const available1 = typeTotals[1] - degrees[1][a] - degrees[1][b] - degrees[1][c] - degrees[1][d] + internal1;
          const available2 = typeTotals[2] - degrees[2][a] - degrees[2][b] - degrees[2][c] - degrees[2][d] + internal2;

          if (type1 === 2 || type2 === 2) {
            lose += available0 + available1 + available2;
            continue;
          }
          const baseTies = (type1 === 1 ? 1 : 0) + (type2 === 1 ? 1 : 0);
          if (baseTies === 0) {
            win += available0;
            tie += available1;
            lose += available2;
            winChanceTotal += available0 + available1 / 2;
          } else if (baseTies === 1) {
            tie += available0 + available1;
            lose += available2;
            winChanceTotal += available0 / 2 + available1 / 3;
          } else {
            tie += available0 + available1;
            lose += available2;
            winChanceTotal += available0 / 3 + available1 / 4;
          }
        }
      }
    }
    return { win, tie, lose, winChanceTotal };
  }

  // Перебирает все будущие общие карты и все совместимые руки 1–3 соперников.
  function simulateExact(opts) {
    opts = opts || {};
    const heroHole = opts.heroHole || [];
    const community = opts.community || [];
    const opponents = Number.isInteger(opts.numOpponents) ? opts.numOpponents : 1;
    if (!heroHole || heroHole.length !== 2) throw new Error('У героя должно быть ровно 2 карты');
    if (!community || community.length > 5) throw new Error('На столе должно быть от 0 до 5 карт');
    if (opponents < 1 || opponents > 9) throw new Error('Расчёт доступен для 1–9 соперников');

    const usedCards = heroHole.concat(community);
    const used = new Set(usedCards.map(cardKey));
    if (used.size !== usedCards.length) throw new Error('Одна и та же известная карта указана дважды');
    const estimate = estimateExact({ community, numOpponents: opponents });
    if (!estimate.supported) throw exactLimitError(estimate);

    const unknown = buildDeck().filter(c => !used.has(cardKey(c)));
    const boardToDraw = 5 - community.length;
    let win = 0, tie = 0, lose = 0, winChanceTotal = 0, total = 0;
    const levelHist = {};
    const levelWins = {};
    const selected = new Uint8Array(unknown.length);

    forEachCombination(unknown, boardToDraw, function (drawnIndexes) {
      const fullBoard = community.slice();
      for (const index of drawnIndexes) { selected[index] = 1; fullBoard.push(unknown[index]); }
      const remaining = [];
      for (let i = 0; i < unknown.length; i++) if (!selected[i]) remaining.push(unknown[i]);
      const heroScore = scoreHand(heroHole.concat(fullBoard));
      const counted = countFinalBoard(heroScore, remaining, opponents, fullBoard);
      const boardTotal = counted.win + counted.tie + counted.lose;
      win += counted.win;
      tie += counted.tie;
      lose += counted.lose;
      winChanceTotal += counted.winChanceTotal;
      total += boardTotal;
      const level = heroScore[0];
      levelHist[level] = (levelHist[level] || 0) + boardTotal;
      levelWins[level] = (levelWins[level] || 0) + counted.win;
      for (const index of drawnIndexes) selected[index] = 0;
    });

    // Проверка инварианта: агрегирование обязано покрыть ровно всё пространство
    // раздач, без пропусков и повторных карт.
    if (total !== estimate.totalDeals) {
      throw new Error('Внутренняя ошибка точного перебора: число раскладов не совпало');
    }

    const winChance = winChanceTotal / total;
    return {
      outcomes: total,
      exact: true,
      estimate,
      win, tie, lose,
      winPct: win / total,
      tiePct: tie / total,
      losePct: lose / total,
      winChance,
      equity: winChance, // совместимость со старым API
      levelHist,
      levelWins,
    };
  }

  // --- Математика колла ------------------------------------------------------
  // Банк указан ДО колла, betToCall — цена решения. winChance уже учитывает
  // случайную дуэль при равной комбинации, поэтому это честная вероятность
  // забрать банк единолично. EV показывает результат нового решения, без
  // ранее вложенных фишек: выигрыш = банк, проигрыш = цена колла.
  function analyzeCall(winChance, betToCall, pot) {
    if (typeof winChance !== 'number' || !isFinite(winChance) || winChance < 0 || winChance > 1 ||
        typeof betToCall !== 'number' || !isFinite(betToCall) || betToCall <= 0 ||
        typeof pot !== 'number' || !isFinite(pot) || pot < 0) return null;
    const requiredEquity = betToCall / (pot + betToCall);
    const expectedValue = winChance * (pot + betToCall) - betToCall;
    return {
      requiredEquity,
      expectedValue,
      equityEdge: winChance - requiredEquity,
      finalPot: pot + betToCall,
    };
  }

  // --- Быстрая оценка для ранней стадии -------------------------------------
  // До флопа полное пространство раздач слишком велико. Вместо отсутствующего
  // ответа используем честную случайную выборку и возвращаем её погрешность.
  function simulateEstimate(opts) {
    opts = opts || {};
    const heroHole = opts.heroHole || [];
    const community = opts.community || [];
    const opponents = Number.isInteger(opts.numOpponents) ? opts.numOpponents : 1;
    const samples = Number.isInteger(opts.samples) ? opts.samples : 30000;
    const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
    if (heroHole.length !== 2) throw new Error('У героя должно быть ровно 2 карты');
    if (community.length > 5) throw new Error('На столе должно быть от 0 до 5 карт');
    if (opponents < 1 || opponents > 9) throw new Error('Оценка доступна для 1–9 соперников');
    if (samples < 1000) throw new Error('Для оценки нужно минимум 1 000 раздач');

    const usedCards = heroHole.concat(community);
    const used = new Set(usedCards.map(cardKey));
    if (used.size !== usedCards.length) throw new Error('Одна и та же известная карта указана дважды');
    const unknown = buildDeck().filter(c => !used.has(cardKey(c)));
    const boardToDraw = 5 - community.length;
    let win = 0, tie = 0, lose = 0, equitySum = 0, equitySquares = 0;
    const levelHist = {};

    // Частичный Fisher–Yates: берём только нужные карты, не создавая колоду
    // заново на каждую раздачу.
    const pool = unknown.slice();
    const drawCount = boardToDraw + opponents * 2;
    for (let n = 0; n < samples; n++) {
      for (let i = 0; i < drawCount; i++) {
        const j = i + Math.floor(rng() * (pool.length - i));
        const swap = pool[i]; pool[i] = pool[j]; pool[j] = swap;
      }
      const board = community.concat(pool.slice(0, boardToDraw));
      const heroScore = scoreHand(heroHole.concat(board));
      let bestScore = heroScore, equalBest = 1, heroBest = true;
      for (let o = 0; o < opponents; o++) {
        const at = boardToDraw + o * 2;
        const oppScore = scoreHand([pool[at], pool[at + 1]].concat(board));
        const cmp = compareScore(oppScore, bestScore);
        if (cmp > 0) { bestScore = oppScore; equalBest = 1; heroBest = false; }
        else if (cmp === 0) { equalBest++; }
      }
      let equity = 0;
      if (heroBest) {
        if (equalBest === 1) { win++; equity = 1; }
        else { tie++; equity = 1 / equalBest; }
      } else lose++;
      equitySum += equity;
      equitySquares += equity * equity;
      levelHist[heroScore[0]] = (levelHist[heroScore[0]] || 0) + 1;
    }
    const winChance = equitySum / samples;
    const variance = Math.max(0, equitySquares / samples - winChance * winChance);
    return {
      outcomes: samples, samples, exact: false, method: 'estimate',
      win, tie, lose, winPct: win / samples, tiePct: tie / samples, losePct: lose / samples,
      winChance, equity: winChance,
      // Нормальное приближение 95% доверительного интервала для средней equity.
      confidence95: 1.96 * Math.sqrt(variance / samples),
      levelHist,
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
    SUITS, RANK_NAMES, RANK_FULL, LEVEL_NAMES, LEVEL_DESC,
    buildDeck, cardKey, cardLabel, shuffle, combinations, compareScore,
    evaluate5, evaluatePartial, scoreHand, bestHand, bestHandAny, estimateExact, simulateExact, simulateEstimate, analyzeCall, recommend,
  };
});
