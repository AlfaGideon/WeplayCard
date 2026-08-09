/* test-poker.js — проверка ядра poker-engine.js (node test-poker.js) */
const P = require('./poker-engine.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok  -', name); }
  else { fail++; console.log('  FAIL-', name); }
}
function C(s, r) { return { s, r }; }

// --- колода ---------------------------------------------------------------
const deck = P.buildDeck();
check('колода: 52 уникальные карты', deck.length === 52 && new Set(deck.map(P.cardKey)).size === 52);

// --- evaluate5: конкретные руки -------------------------------------------
// Роял-флеш: Т К Д В 10 пик
const royal = [C(0,14), C(0,13), C(0,12), C(0,11), C(0,10)];
check('роял-флеш = уровень 9', P.evaluate5(royal).level === 9 && P.evaluate5(royal).score[1] === 14);
// Стрит-флеш 5-6-7-8-9
const sf = [C(1,5), C(1,6), C(1,7), C(1,8), C(1,9)];
check('стрит-флеш = уровень 9', P.evaluate5(sf).level === 9 && P.evaluate5(sf).score[1] === 9);
// Каре
const quads = [C(0,4), C(1,4), C(2,4), C(3,4), C(0,11)];
check('каре = уровень 8', P.evaluate5(quads).level === 8);
// Фулл-хаус
const full = [C(0,14), C(1,14), C(2,14), C(0,8), C(1,8)];
check('фулл-хаус = уровень 7', P.evaluate5(full).level === 7);
// Флеш
const flush = [C(2,2), C(2,4), C(2,6), C(2,9), C(2,12)];
check('флеш = уровень 6', P.evaluate5(flush).level === 6);
// Стрит
const straight = [C(0,10), C(1,11), C(2,12), C(3,13), C(0,14)];
check('стрит = уровень 5', P.evaluate5(straight).level === 5 && P.evaluate5(straight).score[1] === 14);
// Колесо А-2-3-4-5 — младший стрит
const wheel = [C(0,14), C(1,2), C(2,3), C(3,4), C(0,5)];
check('А-2-3-4-5 = стрит со старшей пятёркой',
  P.evaluate5(wheel).level === 5 && P.evaluate5(wheel).score[1] === 5);
check('А-2-3-4-5 проигрывает 6-стриту',
  P.compareScore(P.evaluate5(wheel).score, P.evaluate5([C(0,6), C(1,3), C(2,4), C(3,5), C(0,2)]).score) < 0);
// Сет / две пары / пара / старшая
const trips = [C(0,7), C(1,7), C(2,7), C(0,2), C(1,14)];
check('сет = уровень 4', P.evaluate5(trips).level === 4);
const twoPair = [C(0,9), C(1,9), C(0,5), C(3,5), C(2,14)];
check('две пары = уровень 3', P.evaluate5(twoPair).level === 3);
const pair = [C(0,3), C(2,3), C(0,10), C(1,12), C(3,8)];
check('пара = уровень 2', P.evaluate5(pair).level === 2);
const high = [C(0,14), C(1,12), C(2,10), C(3,7), C(0,4)];
check('старшая карта = уровень 1', P.evaluate5(high).level === 1);

// --- иерархия (стандартный покерный порядок) --------------------------------
check('стрит-флеш > каре', P.compareScore(P.evaluate5(royal).score, P.evaluate5(quads).score) > 0);
check('каре > фулл-хаус', P.compareScore(P.evaluate5(quads).score, P.evaluate5(full).score) > 0);
check('фулл-хаус > флеш', P.compareScore(P.evaluate5(full).score, P.evaluate5(flush).score) > 0);
check('флеш > стрит', P.compareScore(P.evaluate5(flush).score, P.evaluate5(straight).score) > 0);
check('стрит > сет', P.compareScore(P.evaluate5(straight).score, P.evaluate5(trips).score) > 0);
check('сет > две пары', P.compareScore(P.evaluate5(trips).score, P.evaluate5(twoPair).score) > 0);
check('две пары > пара', P.compareScore(P.evaluate5(twoPair).score, P.evaluate5(pair).score) > 0);
check('пара > старшая', P.compareScore(P.evaluate5(pair).score, P.evaluate5(high).score) > 0);
// Кикер решает при равных парах
check('пара 3 с тузом сильнее пары 3 с дамой',
  P.compareScore(P.evaluate5([C(0,3), C(1,3), C(0,14), C(1,5), C(2,7)]).score,
                 P.evaluate5([C(0,3), C(1,3), C(0,12), C(1,5), C(2,7)]).score) > 0);

// --- scoreHand совпадает с полным bestHand на случайных наборах ------------
let directMatches = true, seed = 123456789;
function rng() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
for (let i = 0; i < 2000; i++) {
  const cards = P.shuffle(P.buildDeck(), rng).slice(0, 5 + (i % 3));
  if (P.compareScore(P.scoreHand(cards), P.bestHand(cards).score) !== 0) { directMatches = false; break; }
}
check('быстрый scoreHand совпадает с полным bestHand на 2 000 наборах', directMatches);

// --- bestHand из 7 карт: флеш + стрит-дро ----------------------------------
const seven = [C(2,2), C(1,14), C(2,4), C(2,6), C(2,9), C(2,12), C(3,10)];
check('bestHand из 7 находит флеш (уровень 6)', P.bestHand(seven).level === 6);
// Из 7 карт можно собрать и каре, и стрит-флеш — выигрывает стрит-флеш
const seven2 = [C(0,5), C(0,6), C(0,7), C(0,8), C(0,9), C(1,9), C(2,9)];
check('стрит-флеш из 7 карт перебивает каре', P.bestHand(seven2).level === 9);
// Два сетта в семи картах дают фулл-хаус
const seven3 = [C(0,14), C(1,14), C(2,14), C(0,13), C(1,13), C(2,13), C(0,2)];
check('два сетта из 7 карт дают фулл-хаус', P.bestHand(seven3).level === 7);

// --- точный перебор --------------------------------------------------------
// Ривер: у героя роял-флеш (набор карт полностью известен) — он не проигрывает.
const nutHero = [C(0,14), C(0,13)];
const nutBoard = [C(0,12), C(0,11), C(0,10), C(1,2), C(3,7)];
const exactRiverVs2 = P.simulateExact({ heroHole: nutHero, community: nutBoard, numOpponents: 2 });
check('ривер vs2: перебор всех 893 970 раскладов соперников',
  exactRiverVs2.exact === true && exactRiverVs2.outcomes === 893970);
check('ривер vs2: роял-флеш — 100% шанс победы',
  exactRiverVs2.winChance === 1 && exactRiverVs2.win === exactRiverVs2.outcomes);
const exactRiverVs3 = P.simulateExact({ heroHole: nutHero, community: nutBoard, numOpponents: 3 });
check('ривер vs3: 45C2 × 43C2 × 41C2 = 733 055 400 раскладов',
  exactRiverVs3.exact === true && exactRiverVs3.outcomes === 733055400);

// Флоп: будущие тёрн/ривер + руки соперников учитываются полностью.
const flopHero = [C(0,14), C(0,13)];               // Т♠ К♠
const flopBoard = [C(0,12), C(0,11), C(0,10)];     // Д♠ В♠ 10♠ — готовый роял
const exactFlopVs2 = P.simulateExact({ heroHole: flopHero, community: flopBoard, numOpponents: 2 });
check('флоп vs2: 1081 досок × 45C2 × 43C2 = 966 381 570 раскладов',
  exactFlopVs2.exact === true && exactFlopVs2.outcomes === 966381570);
check('флоп vs2: готовый роял-флеш держит 100% на всех будущих доках',
  exactFlopVs2.winChance === 1);
// Префлоп: полный перебор честно отказывается, а не подменяется выборкой.
const preflopEstimateObj = P.estimateExact({ community: [], numOpponents: 2 });
let preflopRefused = false;
try { P.simulateExact({ heroHole: flopHero, community: [], numOpponents: 2 }); }
catch (err) { preflopRefused = !preflopEstimateObj.supported && err.code === 'EXACT_TOO_LARGE'; }
check('префлоп vs2: точный перебор честно сообщает, что раскладов слишком много', preflopRefused);

// --- оценка (Монте-Карло) ---------------------------------------------------
let estSeed = 987654321;
function estRng() { estSeed = (estSeed * 1664525 + 1013904223) >>> 0; return estSeed / 4294967296; }
const preflopEstimate = P.simulateEstimate({ heroHole: [C(0,14), C(0,13)], community: [], numOpponents: 1, samples: 3000, rng: estRng });
check('префлоп: оценка возвращает заданное число раздач и 95% погрешность',
  preflopEstimate.exact === false && preflopEstimate.outcomes === 3000 &&
  preflopEstimate.win + preflopEstimate.tie + preflopEstimate.lose === 3000 &&
  preflopEstimate.confidence95 >= 0 && preflopEstimate.confidence95 < 0.05);
check('префлоп: оценка выдаёт допустимый шанс победы',
  preflopEstimate.winChance >= 0 && preflopEstimate.winChance <= 1);
// Туз-король пик должен быть заметно сильнее 7-2 разномастных на префлопе.
const aks = P.simulateEstimate({ heroHole: [C(0,14), C(0,13)], community: [], numOpponents: 1, samples: 8000, rng: estRng });
const trash = P.simulateEstimate({ heroHole: [C(1,7), C(2,2)], community: [], numOpponents: 1, samples: 8000, rng: estRng });
check('префлоп: A-K одномастные сильнее 7-2 разномастных',
  aks.winChance > trash.winChance + 0.25);

// --- равные руки: удача выбирает одного --------------------------------------
// На столе готовый роял-флеш, личные карты ничего не меняют → 3 равных монстра.
const sharedBoard = [C(0,14), C(0,13), C(0,12), C(0,11), C(0,10)];
const sharedExact = P.simulateExact({ heroHole: [C(1,2), C(2,3)], community: sharedBoard, numOpponents: 2 });
check('равная комбинация с двумя соперниками = 3 кандидата на удачу',
  sharedExact.win === 0 && sharedExact.tie === sharedExact.outcomes && sharedExact.lose === 0);
check('шанс выиграть случайную дуэль на троих = 1/3',
  Math.abs(sharedExact.winChance - 1 / 3) < 1e-12);

// --- пот-оддсы и EV ----------------------------------------------------------
const callMathGood = P.analyzeCall(0.40, 10, 100);
check('анализ колла: порог 10/110 = 9.09%',
  Math.abs(callMathGood.requiredEquity - 10 / 110) < 1e-12);
check('анализ колла: 40% в банк 100 за 10 даёт EV +34',
  Math.abs(callMathGood.expectedValue - 34) < 1e-12 && callMathGood.equityEdge > 0);
const callMathBad = P.analyzeCall(0.05, 10, 100);
check('анализ колла: 5% в банк 100 за 10 даёт отрицательный EV',
  Math.abs(callMathBad.expectedValue + 4.5) < 1e-12 && callMathBad.equityEdge < 0);
check('анализ колла отклоняет некорректные данные',
  P.analyzeCall(0.5, 0, 100) === null && P.analyzeCall(1.1, 10, 100) === null);
check('рекомендация: 40% при колле 10 в банк 100 -> колл по пот-оддсам', P.recommend(0.40, 10, 100).cls === 'call');
check('рекомендация: 5% при колле 10 в банк 100 -> пас по пот-оддсам', P.recommend(0.05, 10, 100).cls === 'fold');
check('рекомендация: 70% без пот-оддсов -> поднимай', P.recommend(0.70).cls === 'raise');
check('рекомендация: 20% без пот-оддсов -> пасуй', P.recommend(0.20).cls === 'fold');

console.log(`\nИтого: ${pass} прошло, ${fail} упало.`);
process.exit(fail ? 1 : 0);
