/* app.js — современный интерфейс помощника WeplayCard (живой скоринг) */
(function () {
  'use strict';

  // --- Ловитель ошибок: показываем баннер вместо «молча сломанной» страницы ---
  function showErr(msg) {
    const b = document.getElementById('errBanner');
    if (b) { b.hidden = false; b.textContent = '⚠ Ошибка интерфейса: ' + msg; }
    console.error('[WeplayCard]', msg);
  }
  window.addEventListener('error', (e) => showErr(e.message + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : '')));
  window.addEventListener('unhandledrejection', (e) => showErr('Promise: ' + ((e.reason && e.reason.message) || e.reason)));

  try {
    const E = window.WeplayEngine;
    if (!E) throw new Error('движок engine.js не загрузился');

    const $ = (id) => document.getElementById(id);
    // Безопасный аналог addEventListener: не падает, если элемент не найден
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    // В интерфейсе выбирается общее число игроков за столом (2–4).
    // В движок передаём только число соперников: всего игроков минус герой.
    const state = { mode: 'hero', hero: [], table: [], opponents: 1 };
    const MAX_HERO = 2, MAX_TABLE = 5;
    const comboPctEls = {}; const comboBarEls = {}; const comboItemEls = {};
    let lastWinChance = null, lastHist = null, lastTotal = 0, lastComputing = false;
    let lastExact = false, lastExactDeals = 0, lastExactNotice = '';

    // --- Карточка (.pcard) ---------------------------------------------------
    function pcardEl(card, asButton) {
      const el = asButton ? document.createElement('button') : document.createElement('div');
      el.className = 'pcard' + (asButton ? ' card-cell' : '');
      el.style.setProperty('--c', E.COLORS[card.c].css);
      el.title = E.COLORS[card.c].name + ' ' + card.v;
      el.innerHTML =
        '<span class="corner"><span class="pip"></span>' + card.v + '</span>' +
        '<span class="center">' + card.v + '</span>' +
        '<span class="corner br"><span class="pip"></span>' + card.v + '</span>';
      return el;
    }

    // --- Сетка колоды --------------------------------------------------------
    function renderGrid() {
      const grid = $('cardGrid');
      grid.innerHTML = '';
      const heroKeys = new Set(state.hero.map(E.cardKey));
      const tableKeys = new Set(state.table.map(E.cardKey));
      for (let c = 0; c < 4; c++) {
        for (let v = 1; v <= 9; v++) {
          const card = { c, v };
          const cell = pcardEl(card, true);
          if (heroKeys.has(E.cardKey(card))) cell.classList.add('hero');
          if (tableKeys.has(E.cardKey(card))) cell.classList.add('table');
          cell.addEventListener('click', () => toggleCard(card));
          grid.appendChild(cell);
        }
      }
      $('heroCount').textContent = state.hero.length + '/' + MAX_HERO;
      $('tableCount').textContent = state.table.length + '/' + MAX_TABLE;
    }

    let hintTimer = null;
    function flashHint(msg) {
      const h = $('modeHint'); const old = h.innerHTML;
      h.innerHTML = '<b style="color:#ffd27a">' + msg + '</b>';
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { h.innerHTML = old; }, 1800);
    }

    function setMode(mode) {
      state.mode = mode;
      const mh = $('modeHero'), mt = $('modeTable');
      const hint = $('modeHint');
      if (mode === 'hero') {
        if (mh) mh.classList.add('active');
        if (mt) mt.classList.remove('active');
        if (hint) hint.innerHTML = 'Кликай карты на колоде, чтобы добавить их в <b>свои</b> (максимум 2).';
      } else {
        if (mt) mt.classList.add('active');
        if (mh) mh.classList.remove('active');
        if (hint) hint.innerHTML = 'Кликай карты на колоде, чтобы отметить <b>общие</b> на столе (максимум 5).';
      }
    }

    function toggleCard(card) {
      const key = E.cardKey(card);
      let switchToTable = false;
      if (state.mode === 'hero') {
        const i = state.hero.findIndex(x => E.cardKey(x) === key);
        if (i >= 0) state.hero.splice(i, 1);
        else {
          if (state.table.some(x => E.cardKey(x) === key)) { flashHint('Эта карта уже на столе — нельзя дважды.'); return; }
          if (state.hero.length >= MAX_HERO) { flashHint('У тебя уже 2 карты. Сними одну, чтобы заменить.'); return; }
          state.hero.push(card);
          // После второй своей карты сразу переключаем на ввод стола.
          switchToTable = state.hero.length === MAX_HERO;
        }
      } else {
        const i = state.table.findIndex(x => E.cardKey(x) === key);
        if (i >= 0) state.table.splice(i, 1);
        else {
          if (state.hero.some(x => E.cardKey(x) === key)) { flashHint('Эта карта уже у тебя в руке — нельзя дважды.'); return; }
          if (state.table.length >= MAX_TABLE) { flashHint('На столе уже 5 карт.'); return; }
          state.table.push(card);
        }
      }
      if (switchToTable) setMode('table');
      renderGrid(); renderSelection(); renderComboNow(); scheduleRecompute();
    }

    function renderSelection() {
      const hc = $('heroCards'); hc.innerHTML = '';
      if (!state.hero.length) hc.innerHTML = '<span class="placeholder">отметь 2 карты на колоде ниже</span>';
      else state.hero.forEach(c => hc.appendChild(pcardEl(c, false)));

      const tc = $('tableCards'); tc.innerHTML = '';
      if (!state.table.length) tc.innerHTML = '<span class="placeholder">пока пусто</span>';
      else state.table.forEach(c => tc.appendChild(pcardEl(c, false)));
    }

    function highlightCurrent(level) {
      for (let lvl = 1; lvl <= 9; lvl++) {
        const item = comboItemEls[lvl];
        if (!item) continue;
        if (level && lvl === level) item.classList.add('is-current');
        else item.classList.remove('is-current');
      }
    }

    // --- Текущая комбинация (мгновенно + шанс победы) --------------------------
    function renderComboNow() {
      const box = $('comboNow');
      box.innerHTML = '';
      const lab = document.createElement('span'); lab.className = 'cn-label'; lab.textContent = 'Текущая комбинация';

      if (!state.hero.length) {
        const m = document.createElement('span'); m.className = 'cn-value muted'; m.textContent = 'отметь свои 2 карты';
        box.append(lab, m);
        highlightCurrent(null);
        return;
      }

      const all = state.hero.concat(state.table);
      // Универсальная оценка: для <5 карт показываем Барашка/Кабана и т.п.
      let best;
      if (typeof E.bestHandAny === 'function') best = E.bestHandAny(all);
      else if (all.length >= 5) best = E.bestHand(all);
      else best = { level: 0, name: '—', cards: all.slice() };

      if (!best || best.level === 0) {
        const m = document.createElement('span'); m.className = 'cn-value muted';
        m.textContent = state.hero.length === 1 ? 'выбрана 1 карта — добавь ещё одну' : 'выбери карты';
        box.append(lab, m);
        highlightCurrent(null);
        return;
      }

      const name = document.createElement('span'); name.className = 'cn-value'; name.textContent = best.name;
      const lvl = document.createElement('span'); lvl.className = 'cn-level'; lvl.textContent = 'ур. ' + best.level;

      // Шанс победить — вероятность стать единственным победителем. При
      // полностью равных комбинациях игра выбирает победителя удачей, поэтому
      // этому исходу даётся 1/N шанса, а не показывается несуществующий делёж.
      const eqEl = document.createElement('span'); eqEl.className = 'cn-equity';
      if (state.hero.length < 2) {
        eqEl.classList.add('muted');
        eqEl.textContent = '· выбери 2 карты для расчёта';
      } else if (lastComputing) {
        eqEl.textContent = '· считаю…';
        eqEl.style.color = 'var(--muted)';
      } else if (lastWinChance != null) {
        const chancePct = (lastWinChance * 100).toFixed(1);
        eqEl.textContent = '· шанс победить ' + chancePct + '%';
        eqEl.title = 'Шанс стать единственным победителем. Если лучшие комбинации равны, удача выбирает одного из равных игроков.';
        if (lastExact) {
          const exact = document.createElement('span'); exact.className = 'cn-freq muted';
          exact.textContent = ' · точно';
          exact.title = 'Полный перебор всех ' + lastExactDeals.toLocaleString('ru') + ' вариантов закрытых карт соперников, включая пары 5+6.';
          eqEl.appendChild(exact);
        }
        if (lastWinChance >= 0.66) eqEl.style.color = '#74f0a8';
        else if (lastWinChance >= 0.5) eqEl.style.color = '#9ec0ff';
        else if (lastWinChance >= 0.33) eqEl.style.color = '#ffcf8a';
        else eqEl.style.color = '#ff9aa9';
        // Это вероятность именно уровня твоей ФИНАЛЬНОЙ комбинации, не победы.
        if (lastHist && lastTotal) {
          const freq = ((lastHist[best.level] || 0) / lastTotal * 100);
          const fr = document.createElement('span'); fr.className = 'cn-freq muted';
          fr.textContent = ' · этот уровень в финале ' + freq.toFixed(1) + '%';
          fr.style.marginLeft = '4px';
          fr.title = 'Вероятность, что твоя лучшая комбинация закончится этим уровнем. Это не шанс победить.';
          eqEl.appendChild(fr);
        }
      } else if (lastExactNotice) {
        eqEl.textContent = '· ' + lastExactNotice;
        eqEl.classList.add('muted');
        eqEl.title = 'Приложение не подменяет точный ответ случайными итерациями.';
      } else {
        eqEl.textContent = '· —';
        eqEl.classList.add('muted');
      }

      // подсказка про количество карт, если рука ещё неполная
      let noteEl = null;
      if (all.length < 5) {
        noteEl = document.createElement('span'); noteEl.className = 'cn-note muted';
        noteEl.textContent = '· ' + all.length + '/7 карт';
      }

      box.append(lab, name, lvl, eqEl);
      if (noteEl) box.append(noteEl);

      // показываем карты, формирующие комбинацию (для <5 — все, для 5+ — лучшая пятёрка)
      const cardsToShow = (best.cards && best.cards.length) ? best.cards.slice(0, 5) : all.slice(0, 5);
      cardsToShow.forEach(function(c){ box.appendChild(pcardEl(c, false)); });

      highlightCurrent(best.level);
    }

    // --- Точный скоринг (перебор, дебаунс + отмена) --------------------------
    // runGen увеличивается сразу при любом изменении. Поэтому старый расчёт
    // не успеет на миг нарисовать проценты для прежних карт/числа игроков.
    let runGen = 0, debounceTimer = null;

    function setWinChanceDisplay(winChance, computing) {
      const txt = computing ? '…' : (winChance == null ? '—' : (winChance * 100).toFixed(1) + '%');
      $('ebValue').textContent = txt;
      $('topVal').textContent = txt;
    }

    function clearOutcomeDisplay() {
      const summary = $('outcomeBreakdown');
      if (summary) summary.hidden = true;
    }

    function paintOutcome(w, t, l) {
      const summary = $('outcomeBreakdown');
      if (!summary) return;
      summary.hidden = false;
      $('outWin').textContent = 'сильнее ' + (w * 100).toFixed(1) + '%';
      $('outTie').textContent = 'равная → удача ' + (t * 100).toFixed(1) + '%';
      $('outLose').textContent = 'слабее ' + (l * 100).toFixed(1) + '%';
    }

    function resetLiveResult() {
      lastWinChance = null;
      lastHist = null; lastTotal = 0;
      lastExact = false; lastExactDeals = 0; lastExactNotice = '';
      updateComboPcts(null, 0);
      clearOutcomeDisplay();
      const callMath = $('callMath'); if (callMath) callMath.hidden = true;
    }

    function scheduleRecompute() {
      clearTimeout(debounceTimer);
      const myGen = ++runGen; // отменяет уже запущенный расчёт немедленно
      resetLiveResult();

      if (state.hero.length < 2) {
        lastComputing = false;
        setWinChanceDisplay(null, false);
        const chip = $('recoChip'); chip.className = 'reco-chip'; chip.textContent = 'отметь 2 карты';
        $('segBar').hidden = true;
      } else {
        lastComputing = true;
        setWinChanceDisplay(null, true);
        $('segBar').hidden = true;
      }
      renderComboNow();
      debounceTimer = setTimeout(() => runLive(myGen), 160);
    }

    function updateComboPcts(hist, total) {
      for (let lvl = 1; lvl <= 9; lvl++) {
        const cnt = (hist && hist[lvl]) || 0;
        const pct = total ? (cnt / total) * 100 : 0;
        const pEl = comboPctEls[lvl]; if (pEl) pEl.textContent = total ? pct.toFixed(1) + '%' : '—';
        const bEl = comboBarEls[lvl]; if (bEl) bEl.style.width = pct + '%';
      }
    }

    function callInputs() {
      const potRaw = $('potInput').value, betRaw = $('betInput').value;
      const pot = Number(potRaw), bet = Number(betRaw);
      return {
        pot: potRaw !== '' && isFinite(pot) && pot >= 0 ? pot : null,
        bet: betRaw !== '' && isFinite(bet) && bet > 0 ? bet : null,
      };
    }

    function formatChips(value) {
      const abs = Math.abs(value);
      const digits = abs >= 100 ? 0 : (abs >= 10 ? 1 : 2);
      return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(abs);
    }

    // Показывает не только вердикт, но и границу окупаемости с ожидаемым
    // результатом. Так игрок видит, насколько решение устойчиво к ошибке в %.
    function renderCallMath(winChance) {
      const panel = $('callMath');
      if (!panel) return;
      const input = callInputs();
      const math = input.pot != null && input.bet != null && typeof E.analyzeCall === 'function'
        ? E.analyzeCall(winChance, input.bet, input.pot) : null;
      panel.hidden = !math;
      if (!math) return;

      const edgePp = math.equityEdge * 100;
      const ev = math.expectedValue;
      $('callNeed').textContent = (math.requiredEquity * 100).toFixed(1) + '%';
      $('callEdge').textContent = (edgePp >= 0 ? '+' : '−') + Math.abs(edgePp).toFixed(1) + ' п.п.';
      $('callEv').textContent = (ev >= 0 ? '+' : '−') + formatChips(ev);
      $('callEdge').className = edgePp >= 0 ? 'positive' : 'negative';
      $('callEv').className = ev >= 0 ? 'positive' : 'negative';
      $('callMathNote').textContent = ev >= 0
        ? 'Колл выгоден в среднем: при банке ' + formatChips(input.pot) + ' и колле ' + formatChips(input.bet) + ' его EV положительный.'
        : 'Колл убыточен в среднем: для нулевого EV нужно минимум ' + (math.requiredEquity * 100).toFixed(1) + '%.';
    }

    function updateRecommendation(winChance) {
      const input = callInputs();
      // recommend(шанс_победить, сумма_колла, банк); раньше аргументы были переставлены.
      const rec = E.recommend(winChance,
        input.bet != null ? input.bet : undefined,
        input.pot != null ? input.pot : undefined);
      const chip = $('recoChip');
      chip.className = 'reco-chip ' + rec.cls;
      chip.textContent = rec.emoji + ' ' + rec.text;
      renderCallMath(winChance);
    }

    function finishLiveResult(result) {
      const winChance = result.winChance;
      lastWinChance = winChance;
      const outcomes = result.outcomes;
      lastHist = result.levelHist;
      lastTotal = outcomes;
      lastExact = !!result.exact;
      lastExactDeals = result.exact ? outcomes : 0;
      lastComputing = false;
      updateComboPcts(result.levelHist, outcomes);
      setWinChanceDisplay(winChance, false);
      paintSeg(result.winPct, result.tiePct, result.losePct);
      paintOutcome(result.winPct, result.tiePct, result.losePct);
      renderComboNow();
      updateRecommendation(winChance);
    }

    function showExactLimit(err) {
      const estimate = err && err.estimate;
      const count = estimate && estimate.totalDeals ? estimate.totalDeals.toLocaleString('ru') : 'слишком много';
      lastComputing = false;
      lastExact = false; lastExactDeals = 0;
      lastExactNotice = count + ' раскладов — открой ещё общие карты';
      setWinChanceDisplay(null, false);
      $('segBar').hidden = true;
      clearOutcomeDisplay();
      updateComboPcts(null, 0);
      const chip = $('recoChip');
      chip.className = 'reco-chip warn';
      chip.textContent = '⚠ нужен точный перебор после открытия карт';
      renderComboNow();
    }

    async function runLive(myGen) {
      if (myGen !== runGen) return;
      if (state.hero.length < 2) {
        lastComputing = false;
        renderComboNow();
        return;
      }

      lastComputing = true;
      $('segBar').hidden = true;
      renderComboNow();
      // Даём браузеру отрисовать «считаю», после чего запускаем полный перебор.
      await new Promise(res => setTimeout(res, 0));
      if (myGen !== runGen) return;

      try {
        const exact = E.simulateExact({
          heroHole: state.hero,
          community: state.table,
          numOpponents: state.opponents,
        });
        if (myGen !== runGen) return;
        $('segBar').hidden = false;
        finishLiveResult(exact);
      } catch (err) {
        if (myGen !== runGen) return;
        if (err && err.code === 'EXACT_TOO_LARGE') {
          showExactLimit(err);
          return;
        }
        lastComputing = false;
        showErr(err && err.message ? err.message : String(err));
      }
    }

    function paintSeg(w, t, l) {
      $('segWin').style.width = (w * 100) + '%';
      $('segTie').style.width = (t * 100) + '%';
      $('segLose').style.width = (l * 100) + '%';
      $('segBar').title = 'сильнее ' + (w*100).toFixed(1) + '% · равная комбинация (удача) ' +
        (t*100).toFixed(1) + '% · слабее ' + (l*100).toFixed(1) + '%';
    }

    // --- Сайдбар с комбинациями (+ точные % по перебору) ----------------------
    function buildRules() {
      const wrap = $('rulesBody');
      [9,8,7,6,5,4,3,2,1].forEach(lvl => {
        const item = document.createElement('div');
        item.className = 'combo-item';
        item.dataset.lvl = lvl;
        item.innerHTML =
          '<div class="combo-lvl">' + lvl + '</div>' +
          '<div class="combo-meta">' +
            '<div class="combo-name">' + E.LEVEL_NAMES[lvl] + '</div>' +
            '<div class="combo-desc">' + E.LEVEL_DESC[lvl] + '</div>' +
            '<div class="combo-bar"><div class="combo-bar-fill"></div></div>' +
          '</div>' +
          '<div class="combo-pct">—</div>';
        wrap.appendChild(item);
        comboPctEls[lvl] = item.querySelector('.combo-pct');
        comboBarEls[lvl] = item.querySelector('.combo-bar-fill');
        comboItemEls[lvl] = item;
      });
    }

    // --- События (с защитой от отсутствующих элементов) ----------------------
    on('rulesToggle', 'click', () => { const r = $('rules'); if (r) r.classList.toggle('collapsed'); });
    on('modeHero', 'click', () => setMode('hero'));
    on('modeTable', 'click', () => setMode('table'));
    on('clearBtn', 'click', () => {
      state.hero = []; state.table = [];
      // Очистка всегда возвращает к выбору своих карт.
      setMode('hero');
      renderGrid(); renderSelection(); renderComboNow(); scheduleRecompute();
    });
    function opponentLabel(n) {
      if (n === 1) return 'соперник';
      if (n >= 2 && n <= 4) return 'соперника';
      return 'соперников';
    }

    function updatePlayerNote() {
      const note = $('playerNote');
      if (!note) return;
      note.textContent = 'Вы + ' + state.opponents + ' ' + opponentLabel(state.opponents);
      note.title = 'В расчёт добавлено ' + state.opponents + ' ' + opponentLabel(state.opponents) + '.';
    }

    document.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const players = Number(btn.dataset.players);
        if (!Number.isInteger(players) || players < 2) return;
        state.opponents = players - 1;
        document.querySelectorAll('.stepper-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        updatePlayerNote();
        scheduleRecompute();
      });
    });
    // --- Современные степперы вместо системных стрелок -----------------------
    function stepInput(input, dir) {
      const step = Number(input.step) || 1;
      const min = input.min !== '' ? Number(input.min) : -Infinity;
      const max = input.max !== '' ? Number(input.max) : Infinity;
      let cur = input.value === '' ? NaN : Number(input.value);
      if (!isFinite(cur)) {
        cur = isFinite(min) ? min : 0;
        // для банка/колла пустое + клик вверх -> первый шаг, а не 0
        if (input.value === '' && dir > 0) cur = Math.max(cur, step);
      } else {
        cur = cur + dir * step;
      }
      const dec = (step.toString().split('.')[1] || '').length;
      cur = Number(cur.toFixed(dec));
      if (cur < min) cur = min;
      if (cur > max) cur = max;
      input.value = String(cur);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (input.animate) {
        try { input.animate([{ transform: 'scale(1.02)' }, { transform: 'scale(1)' }], { duration: 120, easing: 'ease-out' }); } catch(_){}
      }
    }
    function initNumberSteppers() {
      document.querySelectorAll('.num-input').forEach(wrap => {
        const input = wrap.querySelector('input');
        if (!input) return;
        wrap.querySelectorAll('.num-btn').forEach(btn => {
          const dir = Number(btn.dataset.dir) || 0;
          btn.addEventListener('click', () => stepInput(input, dir));
          // удержание для быстрого прокрута
          let holdTimer = null, holdInt = null;
          const startHold = () => {
            holdTimer = setTimeout(() => {
              holdInt = setInterval(() => stepInput(input, dir), 110);
            }, 320);
          };
          const stopHold = () => { clearTimeout(holdTimer); clearInterval(holdInt); };
          btn.addEventListener('mousedown', startHold);
          btn.addEventListener('touchstart', startHold, { passive: true });
          ['mouseup','mouseleave','touchend','touchcancel'].forEach(ev => btn.addEventListener(ev, stopHold));
        });
        // блокируем случайное изменение колесом
        input.addEventListener('wheel', (e) => { if (document.activeElement === input) e.preventDefault(); }, { passive: false });
        // стрелки клавиатуры — делаем через наш степпер для консистентности
        input.addEventListener('keydown', (e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); stepInput(input, 1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); stepInput(input, -1); }
        });
      });
      // Банк и колл не меняют карты, поэтому пересчитывать миллионы раскладов
      // не нужно: мгновенно обновляем только решение и EV.
      ['potInput', 'betInput'].forEach(id => on(id, 'input', () => {
        if (lastWinChance != null) updateRecommendation(lastWinChance);
      }));
    }
    initNumberSteppers();

    // --- Старт ---------------------------------------------------------------
    buildRules();
    updatePlayerNote();
    renderGrid();
    renderSelection();
    renderComboNow();
    setWinChanceDisplay(null, false);
  } catch (err) {
    showErr(err && err.message ? err.message : String(err));
  }
})();
