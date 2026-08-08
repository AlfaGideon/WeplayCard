/* test.js — проверка ядра engine.js (node test.js) */
const E = require('./engine.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok  -', name); }
  else { fail++; console.log('  FAIL-', name); }
}
function C(c, v) { return { c, v }; }

// --- evaluate5: конкретные руки ---------------------------------------------
// Дракон (стрит-флеш) 5-6-7-8-9 одного цвета
const dragon = [C(0,5), C(0,6), C(0,7), C(0,8), C(0,9)];
check('Дракон = уровень 9', E.evaluate5(dragon).level === 9);

// Титан (каре) четвёрки разных цветов
const titan = [C(0,4), C(1,4), C(2,4), C(3,4), C(0,1)];
check('Титан = уровень 8', E.evaluate5(titan).level === 8);

// Медведь (флеш) — 5 одного цвета, НЕ последовательные
const flush = [C(2,1), C(2,3), C(2,5), C(2,7), C(2,9)];
check('Медведь = уровень 7', E.evaluate5(flush).level === 7);

// Носорог (фулл-хаус)
const full = [C(0,3), C(1,3), C(2,3), C(0,8), C(1,8)];
check('Носорог = уровень 6', E.evaluate5(full).level === 6);

// Морал (стрит) 1-2-3-4-5 разных цветов
const straight = [C(0,1), C(1,2), C(2,3), C(3,4), C(0,5)];
check('Морал = уровень 5', E.evaluate5(straight).level === 5);

// Буревестник (сет)
const trips = [C(0,7), C(1,7), C(2,7), C(0,2), C(1,9)];
check('Буревестник = уровень 4', E.evaluate5(trips).level === 4);

// Волк (две пары)
const twop = [C(0,2), C(1,2), C(0,5), C(3,5), C(2,9)];
check('Волк = уровень 3', E.evaluate5(twop).level === 3);

// Кабан (пара)
const pair = [C(0,6), C(2,6), C(0,1), C(1,3), C(3,8)];
check('Кабан = уровень 2', E.evaluate5(pair).level === 2);

// Барашек (старшая)
const high = [C(0,1), C(1,3), C(2,5), C(3,7), C(0,9)];
check('Барашек = уровень 1', E.evaluate5(high).level === 1);

// --- иерархия по ТЗ: Медведь(7) > Носорог(6) --------------------------------
check('флеш(7) > фулл-хаус(6)', E.compareScore(E.evaluate5(flush).score, E.evaluate5(full).score) > 0);
check('каре(8) > флеш(7)', E.compareScore(E.evaluate5(titan).score, E.evaluate5(flush).score) > 0);
check('дракон(9) > каре(8)', E.compareScore(E.evaluate5(dragon).score, E.evaluate5(titan).score) > 0);
check('Морал(5) > Волк(3)', E.compareScore(E.evaluate5(straight).score, E.evaluate5(twop).score) > 0);
// Регрессия для ситуации 8-4 / 4-7-8: у героя Волк, но соперник с 5-6
// уже собирает Морал 4-5-6-7-8 и обязан победить.
const hero84478 = E.bestHand([C(0,8), C(1,4), C(2,4), C(3,7), C(2,8)]);
const opponent45678 = E.bestHand([C(0,5), C(1,6), C(2,4), C(3,7), C(2,8)]);
check('8-4-4-7-8 (Волк) проигрывает 4-5-6-7-8 (Моралу)',
  hero84478.level === 3 && opponent45678.level === 5 &&
  E.compareScore(hero84478.score, opponent45678.score) < 0);

// Все пять карт стола известны: против двух соперников считаем не выборкой,
// а полный набор 29C2 × 27C2 вариантов. Это ситуация из отчёта: Ф8, К4 /
// С4, С7, С8, К3, Ф2. Морал 5-6 у соперника уже входит в проигрышные варианты.
const finalHero = [C(3,8), C(1,4)];
const finalBoard = [C(0,4), C(0,7), C(0,8), C(1,3), C(3,2)];
const exactFinal = E.simulateExact({ heroHole: finalHero, community: finalBoard, numOpponents: 2 });
check('готовый стол vs2 перебирает все 142 506 раскладов соперников',
  exactFinal.exact === true && exactFinal.outcomes === 142506);
check('Ф8 К4 / С4 С7 С8 К3 Ф2 vs2: точный шанс победить 70.84%',
  Math.abs(exactFinal.winChance - 0.7084286509573866) < 1e-12 &&
  Math.abs(exactFinal.losePct - 0.28332842125945573) < 1e-12);

// На флопе полный перебор включает будущие тёрн/ривер и все руки соперников.
const exactFlopVs2 = E.simulateExact({ heroHole: finalHero, community: finalBoard.slice(0, 3), numOpponents: 2 });
check('Ф8 К4 / С4 С7 С8 на флопе vs2: точный шанс 46.06%',
  exactFlopVs2.outcomes === 66265290 && Math.abs(exactFlopVs2.winChance - 0.4605953433539629) < 1e-12);
const exactFlopVs3 = E.simulateExact({ heroHole: finalHero, community: finalBoard.slice(0, 3), numOpponents: 3 });
check('флоп vs3: точный перебор всех 19 879 587 000 раскладов',
  exactFlopVs3.exact === true && exactFlopVs3.outcomes === 19879587000 &&
  Math.abs(exactFlopVs3.winChance - 0.3431742533685419) < 1e-12);
const preflopExactEstimate = E.estimateExact({ community: [], numOpponents: 2 });
let preflopRefused = false;
try { E.simulateExact({ heroHole: finalHero, community: [], numOpponents: 2 }); }
catch (err) { preflopRefused = !preflopExactEstimate.supported && err.code === 'EXACT_TOO_LARGE'; }
check('префлоп vs2 не подменяется Монте-Карло при слишком большом переборе', preflopRefused);

// Быстрый scoreHand обязан совпадать с полным перебором каждой лучшей пятёрки.
let directScoreMatches = true, scoreSeed = 123456789;
function seededRandom() { scoreSeed = (scoreSeed * 1664525 + 1013904223) >>> 0; return scoreSeed / 4294967296; }
for (let i = 0; i < 2000; i++) {
  const cards = E.shuffle(E.buildDeck(), seededRandom).slice(0, 5 + (i % 3));
  if (E.compareScore(E.scoreHand(cards), E.bestHand(cards).score) !== 0) { directScoreMatches = false; break; }
}
check('быстрый scoreHand совпадает с полным bestHand на 2 000 наборах', directScoreMatches);

// --- равные руки: дележа нет, удача выбирает одного из равных ---------------
// На столе уже максимальный Дракон 5-9 одного цвета. Личные карты его не
// улучшают, поэтому трое равны; шанс героя выиграть случайную дуэль = 1/3.
const sharedDragonBoard = [C(0,5), C(0,6), C(0,7), C(0,8), C(0,9)];
const sharedHero = [C(1,1), C(2,2)];
const sharedExact = E.simulateExact({ heroHole: sharedHero, community: sharedDragonBoard, numOpponents: 2 });
check('равная комбинация с двумя соперниками = 3 кандидата на удачу',
  sharedExact.win === 0 && sharedExact.tie === sharedExact.outcomes && sharedExact.lose === 0);
check('шанс выиграть случайную дуэль на троих = 1/3',
  Math.abs(sharedExact.winChance - 1 / 3) < 1e-12);
check('точный перебор сохраняет 100% равных комбинаций', sharedExact.tiePct === 1);

// --- bestHand из 7 карт: собирает лучшую 5-ку -------------------------------
// 2 карманные + 5 общих, где есть флеш-дро
const seven = [C(0,2), C(1,9), C(2,1), C(2,3), C(2,5), C(2,7), C(2,9)];
const best = E.bestHand(seven);
check('bestHand из 7 находит Медведя(7)', best.level === 7);

// --- пот-оддсы: колл выгоден и при шансе ниже 50%, если цена колла мала -----
const potOddsCall = E.recommend(0.40, 10, 100);
check('40% шанса при колле 10 в банк 100 -> колл по пот-оддсам', potOddsCall.cls === 'call');
const potOddsFold = E.recommend(0.05, 10, 100);
check('5% шанса при колле 10 в банк 100 -> пас по пот-оддсам', potOddsFold.cls === 'fold');

// Решение должно показывать не только вердикт, но и денежную цену ошибки.
const callMathGood = E.analyzeCall(0.40, 10, 100);
check('анализ колла: порог 10/110 = 9.09%',
  Math.abs(callMathGood.requiredEquity - 10 / 110) < 1e-12);
check('анализ колла: 40% в банк 100 за 10 даёт EV +34',
  Math.abs(callMathGood.expectedValue - 34) < 1e-12 && callMathGood.equityEdge > 0);
const callMathBad = E.analyzeCall(0.05, 10, 100);
check('анализ колла: 5% в банк 100 за 10 даёт отрицательный EV',
  Math.abs(callMathBad.expectedValue + 4.5) < 1e-12 && callMathBad.equityEdge < 0);
check('анализ колла отклоняет неполные или некорректные данные',
  E.analyzeCall(0.5, 0, 100) === null && E.analyzeCall(1.1, 10, 100) === null);

// На префлопе точный перебор слишком велик, поэтому доступна честно помеченная
// оценка. Фиксированный генератор делает проверку воспроизводимой.
let estimateSeed = 987654321;
function estimateRng() { estimateSeed = (estimateSeed * 1664525 + 1013904223) >>> 0; return estimateSeed / 4294967296; }
const preflopEstimate = E.simulateEstimate({ heroHole: finalHero, community: [], numOpponents: 1, samples: 3000, rng: estimateRng });
check('префлоп: оценка возвращает заданное число раздач и 95% погрешность',
  preflopEstimate.exact === false && preflopEstimate.outcomes === 3000 &&
  preflopEstimate.win + preflopEstimate.tie + preflopEstimate.lose === 3000 &&
  preflopEstimate.confidence95 >= 0 && preflopEstimate.confidence95 < 0.05);
check('префлоп: оценка выдаёт допустимый шанс победы',
  preflopEstimate.winChance >= 0 && preflopEstimate.winChance <= 1);

console.log(`\nИтого: ${pass} прошло, ${fail} упало.`);
process.exit(fail ? 1 : 0);
