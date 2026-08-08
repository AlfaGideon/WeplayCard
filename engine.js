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

  // --- Быстрый счёт для 5..7 карт -----------------------------------------
  // В точном расчёте важен только массив score, а не сами пять карт. Полный
  // перебор 21 пятёрки в bestHand() удобен для интерфейса, но слишком дорог для точного
  // расчёта всех раскладов. Эта функция получает тот же score за один проход.
  function scoreHand(cards) {
    if (!cards || cards.length < 5) return bestHandAny(cards || []).score;

    const rankCounts = new Array(10).fill(0);
    const suitMasks = [0, 0, 0, 0];
    const suitCounts = [0, 0, 0, 0];
    for (const card of cards) {
      rankCounts[card.v]++;
      suitCounts[card.c]++;
      suitMasks[card.c] |= (1 << card.v);
    }

    function straightHigh(mask) {
      for (let high = 9; high >= 5; high--) {
        let ok = true;
        for (let v = high - 4; v <= high; v++) {
          if ((mask & (1 << v)) === 0) { ok = false; break; }
        }
        if (ok) return high;
      }
      return 0;
    }

    let rankMask = 0;
    for (let v = 1; v <= 9; v++) if (rankCounts[v]) rankMask |= (1 << v);

    // Дракон: высший стрит в каждом цвете.
    let straightFlushHigh = 0;
    for (let c = 0; c < 4; c++) {
      if (suitCounts[c] >= 5) straightFlushHigh = Math.max(straightFlushHigh, straightHigh(suitMasks[c]));
    }
    if (straightFlushHigh) return [9, straightFlushHigh];

    let quad = 0;
    for (let v = 9; v >= 1; v--) if (rankCounts[v] === 4) { quad = v; break; }
    if (quad) {
      for (let v = 9; v >= 1; v--) if (v !== quad && rankCounts[v]) return [8, quad, v];
    }

    // В этом наборе правил Медведь (флеш, 7) старше Носорога (фулл-хаус, 6).
    for (let c = 0; c < 4; c++) {
      if (suitCounts[c] >= 5) {
        const values = [];
        for (let v = 9; v >= 1 && values.length < 5; v--) if (suitMasks[c] & (1 << v)) values.push(v);
        return [7].concat(values);
      }
    }

    let trip = 0, pairForFull = 0;
    for (let v = 9; v >= 1; v--) if (rankCounts[v] >= 3) { trip = v; break; }
    if (trip) {
      for (let v = 9; v >= 1; v--) {
        if (v !== trip && rankCounts[v] >= 2) { pairForFull = v; break; }
      }
    }
    if (trip && pairForFull) return [6, trip, pairForFull];

    const straight = straightHigh(rankMask);
    if (straight) return [5, straight];

    if (trip) {
      const kickers = [];
      for (let v = 9; v >= 1 && kickers.length < 2; v--) if (v !== trip && rankCounts[v]) kickers.push(v);
      return [4, trip].concat(kickers);
    }

    const pairs = [];
    for (let v = 9; v >= 1; v--) if (rankCounts[v] >= 2) pairs.push(v);
    if (pairs.length >= 2) {
      for (let v = 9; v >= 1; v--) if (v !== pairs[0] && v !== pairs[1] && rankCounts[v]) return [3, pairs[0], pairs[1], v];
    }
    if (pairs.length === 1) {
      const kickers = [];
      for (let v = 9; v >= 1 && kickers.length < 3; v--) if (v !== pairs[0] && rankCounts[v]) kickers.push(v);
      return [2, pairs[0]].concat(kickers);
    }

    const highs = [];
    for (let v = 9; v >= 1 && highs.length < 5; v--) if (rankCounts[v]) highs.push(v);
    return [1].concat(highs);
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

  // --- Точный расчёт всех допустимых раскладов ------------------------------
  // Мы не делаем случайную выборку: для каждой возможной будущей доски считаем
  // все совместимые пары соперников. Вместо перебора триллионов перестановок
  // используем счёт непересекающихся пар по их отношению к руке героя.
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
  function estimateExact(opts) {
    opts = opts || {};
    const community = opts.community || [];
    const opponents = Number.isInteger(opts.numOpponents) ? opts.numOpponents : 1;
    const knownCommunity = community.length;
    if (knownCommunity < 0 || knownCommunity > 5 || opponents < 1 || opponents > 3) {
      return { supported: false, totalDeals: 0, scoreEvals: 0, matchWork: 0 };
    }
    const unknownBeforeBoard = 34 - knownCommunity; // 36 - 2 карты героя - общие
    const boardToDraw = 5 - knownCommunity;
    const boardWays = choose(unknownBeforeBoard, boardToDraw);
    let cardsAfterBoard = unknownBeforeBoard - boardToDraw; // всегда 29
    let handsWays = 1;
    for (let i = 0; i < opponents; i++) {
      handsWays *= choose(cardsAfterBoard, 2);
      cardsAfterBoard -= 2;
    }
    const pairsPerBoard = choose(29, 2);
    // Для 2 соперников второй счёт рук агрегируется по первой паре; для 3
    // нужно рассмотреть совместимые первые две пары и агрегировать третью.
    const matchWorkPerBoard = opponents === 3 ? pairsPerBoard * choose(27, 2) : pairsPerBoard;
    const scoreEvals = boardWays * pairsPerBoard;
    const matchWork = boardWays * matchWorkPerBoard;
    return {
      supported: scoreEvals <= EXACT_MAX_SCORE_EVALS && matchWork <= EXACT_MAX_MATCH_WORK,
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
  // 29 карт; тип пары: 0 — слабее героя, 1 — равна герою, 2 — сильнее героя.
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
      // по степеням графа. Это заменяет 42 751 800 сравнений на ~142 506.
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
  // Если расчёт физически слишком велик для браузера, он честно сообщает об
  // этом, а не подменяет ответ случайными 15 000 итерациями.
  function simulateExact(opts) {
    opts = opts || {};
    const heroHole = opts.heroHole || [];
    const community = opts.community || [];
    const opponents = Number.isInteger(opts.numOpponents) ? opts.numOpponents : 1;
    if (!heroHole || heroHole.length !== 2) throw new Error('У героя должно быть ровно 2 карты');
    if (!community || community.length > 5) throw new Error('На столе должно быть от 0 до 5 карт');
    if (opponents < 1 || opponents > 3) throw new Error('Точный расчёт доступен для 1–3 соперников');

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
    evaluate5, evaluatePartial, scoreHand, bestHand, bestHandAny, estimateExact, simulateExact, recommend,
  };
});
