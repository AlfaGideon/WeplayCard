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

// --- bestHand из 7 карт: собирает лучшую 5-ку -------------------------------
// 2 карманные + 5 общих, где есть флеш-дро
const seven = [C(0,2), C(1,9), C(2,1), C(2,3), C(2,5), C(2,7), C(2,9)];
const best = E.bestHand(seven);
check('bestHand из 7 находит Медведя(7)', best.level === 7);

// --- playOnce / simulate: пара девяток префлоп против 1 соперника > 50% ------
const hero = [C(0,9), C(1,9)];
const sim = E.simulate({ heroHole: hero, community: [], numOpponents: 1, iterations: 40000 });
console.log('\n  Пара 99 префлоп vs 1: win% =', (sim.winPct*100).toFixed(1),
            'equity =', (sim.equity*100).toFixed(1) + '%');
check('пара 99 префлоп vs1 имеет equity > 50%', sim.equity > 0.5);

// --- симуляция с известным флопом: герой уже собрал каре -> почти всегда выигрывает
const hero2 = [C(0,4), C(1,4)];
const flop = [C(2,4), C(3,4), C(0,1)]; // четыре четвёрки на столе+руке
const sim2 = E.simulate({ heroHole: hero2, community: flop, numOpponents: 3, iterations: 20000 });
console.log('  Каре на флопе vs3: equity =', (sim2.equity*100).toFixed(1) + '%');
check('каре на флопе vs3 -> equity > 90%', sim2.equity > 0.9);

console.log(`\nИтого: ${pass} прошло, ${fail} упало.`);
process.exit(fail ? 1 : 0);
