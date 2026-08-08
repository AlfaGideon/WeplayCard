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
    const state = { mode: 'hero', hero: [], table: [], opponents: 1 };
    const MAX_HERO = 2, MAX_TABLE = 5;
    const comboPctEls = {}; const comboBarEls = {};

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

    function toggleCard(card) {
      const key = E.cardKey(card);
      if (state.mode === 'hero') {
        const i = state.hero.findIndex(x => E.cardKey(x) === key);
        if (i >= 0) state.hero.splice(i, 1);
        else {
          if (state.table.some(x => E.cardKey(x) === key)) { flashHint('Эта карта уже на столе — нельзя дважды.'); return; }
          if (state.hero.length >= MAX_HERO) { flashHint('У тебя уже 2 карты. Сними одну, чтобы заменить.'); return; }
          state.hero.push(card);
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

    // --- Текущая комбинация (мгновенно) --------------------------------------
    function renderComboNow() {
      const box = $('comboNow');
      const all = state.hero.concat(state.table);
      if (state.hero.length < 2) {
        box.innerHTML = '<span class="cn-label">Текущая комбинация</span><span class="cn-value muted">отметь свои 2 карты</span>';
        return;
      }
      if (all.length < 5) {
        box.innerHTML = '<span class="cn-label">Текущая комбинация</span><span class="cn-value muted">нужно минимум 3 общих (сейчас ' + all.length + ' из 7)</span>';
        return;
      }
      const best = E.bestHand(all);
      box.innerHTML = '';
      const lab = document.createElement('span'); lab.className = 'cn-label'; lab.textContent = 'Текущая комбинация';
      const name = document.createElement('span'); name.className = 'cn-value'; name.textContent = best.name;
      const lvl = document.createElement('span'); lvl.className = 'cn-level'; lvl.textContent = 'ур. ' + best.level;
      box.append(lab, name, lvl);
      best.cards.forEach(c => box.appendChild(pcardEl(c, false)));
    }

    // --- Живой скоринг (Monte-Carlo, дебаунс + отмена) ----------------------
    let runGen = 0, debounceTimer = null;

    function setEquityDisplay(equity, computing) {
      const txt = computing ? '…' : (equity == null ? '—' : (equity * 100).toFixed(1) + '%');
      $('ebValue').textContent = txt;
      $('topVal').textContent = txt;
    }

    function scheduleRecompute() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(runLive, 160);
    }

    function updateComboPcts(hist, total) {
      for (let lvl = 1; lvl <= 9; lvl++) {
        const cnt = (hist && hist[lvl]) || 0;
        const pct = total ? (cnt / total) * 100 : 0;
        const pEl = comboPctEls[lvl]; if (pEl) pEl.textContent = total ? pct.toFixed(1) + '%' : '—';
        const bEl = comboBarEls[lvl]; if (bEl) bEl.style.width = pct + '%';
      }
    }

    async function runLive() {
      const myGen = ++runGen;
      updateComboPcts(null, 0);
      if (state.hero.length < 2) {
        setEquityDisplay(null, false);
        const chip = $('recoChip'); chip.className = 'reco-chip'; chip.textContent = 'отметь 2 карты';
        $('segBar').hidden = true;
        return;
      }
      const iterations = Math.max(2000, Math.floor(Number($('iterInput').value) || 15000));
      setEquityDisplay(null, true);
      $('segBar').hidden = false;

      let win = 0, tie = 0, lose = 0, levelHist = {};
      const BATCH = 2000;
      const batches = Math.ceil(iterations / BATCH);

      for (let b = 0; b < batches; b++) {
        if (myGen !== runGen) return; // отменено новым действием
        const n = Math.min(BATCH, iterations - b * BATCH);
        for (let i = 0; i < n; i++) {
          const r = E.playOnce(state.hero, state.table, state.opponents);
          if (r.result === 'win') win++; else if (r.result === 'tie') tie++; else lose++;
          levelHist[r.heroLevel] = (levelHist[r.heroLevel] || 0) + 1;
        }
        if (myGen !== runGen) return;
        const done = Math.min(iterations, (b + 1) * BATCH);
        setEquityDisplay((win + tie / 2) / done, false);
        paintSeg(win / done, tie / done, lose / done);
        updateComboPcts(levelHist, done);
        await new Promise(res => setTimeout(res, 0)); // не блокируем UI
      }
      if (myGen !== runGen) return;

      updateComboPcts(levelHist, iterations);
      const equity = (win + tie / 2) / iterations;
      paintSeg(win / iterations, tie / iterations, lose / iterations);
      const pot = Number($('potInput').value), bet = Number($('betInput').value);
      const rec = E.recommend(equity,
        isFinite(pot) && pot > 0 ? pot : undefined,
        isFinite(bet) && bet > 0 ? bet : undefined);
      const chip = $('recoChip');
      chip.className = 'reco-chip ' + rec.cls;
      chip.textContent = rec.emoji + ' ' + rec.text;
    }

    function paintSeg(w, t, l) {
      $('segWin').style.width = (w * 100) + '%';
      $('segTie').style.width = (t * 100) + '%';
      $('segLose').style.width = (l * 100) + '%';
      $('segBar').title = 'победа ' + (w*100).toFixed(1) + '% · ничья ' + (t*100).toFixed(1) + '% · проигрыш ' + (l*100).toFixed(1) + '%';
    }

    // --- Сайдбар с комбинациями (+ живые % по симуляции) --------------------
    function buildRules() {
      const wrap = $('rulesBody');
      [9,8,7,6,5,4,3,2,1].forEach(lvl => {
        const item = document.createElement('div');
        item.className = 'combo-item';
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
      });
    }

    // --- События (с защитой от отсутствующих элементов) ----------------------
    on('rulesToggle', 'click', () => { const r = $('rules'); if (r) r.classList.toggle('collapsed'); });
    on('modeHero', 'click', () => {
      state.mode = 'hero';
      const mh = $('modeHero'), mt = $('modeTable');
      if (mh) mh.classList.add('active'); if (mt) mt.classList.remove('active');
      const h = $('modeHint'); if (h) h.innerHTML = 'Кликай карты на колоде, чтобы добавить их в <b>свои</b> (максимум 2).';
    });
    on('modeTable', 'click', () => {
      state.mode = 'table';
      const mh = $('modeHero'), mt = $('modeTable');
      if (mt) mt.classList.add('active'); if (mh) mh.classList.remove('active');
      const h = $('modeHint'); if (h) h.innerHTML = 'Кликай карты на колоде, чтобы отметить <b>общие</b> на столе (максимум 5).';
    });
    on('clearBtn', 'click', () => {
      state.hero = []; state.table = [];
      renderGrid(); renderSelection(); renderComboNow(); scheduleRecompute();
    });
    document.querySelectorAll('.stepper-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.opponents = Number(btn.dataset.opp);
        document.querySelectorAll('.stepper-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); scheduleRecompute();
      });
    });
    ['iterInput', 'potInput', 'betInput'].forEach(id => on(id, 'input', scheduleRecompute));

    // --- Старт ---------------------------------------------------------------
    buildRules();
    renderGrid();
    renderSelection();
    renderComboNow();
    setEquityDisplay(null, false);
  } catch (err) {
    showErr(err && err.message ? err.message : String(err));
  }
})();
