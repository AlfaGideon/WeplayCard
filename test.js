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
  exactFinal.exact === true && exactFinal.iterations === 142506);
check('Ф8 К4 / С4 С7 С8 К3 Ф2 vs2: точный шанс победить 70.84%',
  Math.abs(exactFinal.winChance - 0.7084286509573866) < 1e-12 &&
  Math.abs(exactFinal.losePct - 0.28332842125945573) < 1e-12);

// --- равные руки: дележа нет, удача выбирает одного из равных ---------------
// На столе уже максимальный Дракон 5-9 одного цвета. Личные карты его не
// улучшают, поэтому трое равны; шанс героя выиграть случайную дуэль = 1/3.
const sharedDragonBoard = [C(0,5), C(0,6), C(0,7), C(0,8), C(0,9)];
const sharedHero = [C(1,1), C(2,2)];
const sharedOnce = E.playOnce(sharedHero, sharedDragonBoard, 2, () => 0.5);
check('равная комбинация с двумя соперниками = 3 кандидата на удачу',
  sharedOnce.result === 'tie' && sharedOnce.tiedPlayers === 3);
check('шанс выиграть случайную дуэль на троих = 1/3',
  Math.abs(sharedOnce.winChance - 1 / 3) < 1e-12);
const sharedSim = E.simulate({ heroHole: sharedHero, community: sharedDragonBoard, numOpponents: 2, iterations: 12, rng: () => 0.5 });
check('simulate даёт 1/3 шанса при равной дуэли на троих',
  sharedSim.win === 0 && sharedSim.tie === 12 && Math.abs(sharedSim.winChance - 1 / 3) < 1e-12);

// --- bestHand из 7 карт: собирает лучшую 5-ку -------------------------------
// 2 карманные + 5 общих, где есть флеш-дро
const seven = [C(0,2), C(1,9), C(2,1), C(2,3), C(2,5), C(2,7), C(2,9)];
const best = E.bestHand(seven);
check('bestHand из 7 находит Медведя(7)', best.level === 7);

// --- playOnce / simulate: пара девяток префлоп против 1 соперника > 50% ------
const hero = [C(0,9), C(1,9)];
const sim = E.simulate({ heroHole: hero, community: [], numOpponents: 1, iterations: 40000 });
console.log('\n  Пара 99 префлоп vs 1: win% =', (sim.winPct*100).toFixed(1),
            'шанс =', (sim.winChance*100).toFixed(1) + '%');
check('пара 99 префлоп vs1 имеет шанс победить > 50%', sim.winChance > 0.5);

// --- симуляция с известным флопом: герой уже собрал каре -> почти всегда выигрывает
const hero2 = [C(0,4), C(1,4)];
const flop = [C(2,4), C(3,4), C(0,1)]; // четыре четвёрки на столе+руке
const sim2 = E.simulate({ heroHole: hero2, community: flop, numOpponents: 3, iterations: 20000 });
console.log('  Каре на флопе vs3: шанс =', (sim2.winChance*100).toFixed(1) + '%');
check('каре на флопе vs3 -> шанс победить > 90%', sim2.winChance > 0.9);

// --- пот-оддсы: колл выгоден и при шансе ниже 50%, если цена колла мала -----
const potOddsCall = E.recommend(0.40, 10, 100);
check('40% шанса при колле 10 в банк 100 -> колл по пот-оддсам', potOddsCall.cls === 'call');
const potOddsFold = E.recommend(0.05, 10, 100);
check('5% шанса при колле 10 в банк 100 -> пас по пот-оддсам', potOddsFold.cls === 'fold');

console.log(`\nИтого: ${pass} прошло, ${fail} упало.`);
process.exit(fail ? 1 : 0);
