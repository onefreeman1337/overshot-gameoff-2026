/* OVERSHOT - the screens, the input and the loop. The rules are in sim.js and nothing here duplicates one; everything drawn is read back from the state
 * the headless simulation owns. A control acts when the finger or the button lifts, on the control it went down on, so a thumb that slides away has not
 * done anything.
 */
(function () {
  'use strict';
  const R = window.RENDER, SIM = window.SIM, A = window.AUDIO;
  const P = R.PAL, T = R.text, B = R.button;
  const SAVE_KEY = 'overshot-v1', MUTE_KEY = 'overshot-mute';
  const canvas = document.getElementById('game');
  R.init(canvas);
  let G = null, demo = null;
  const ui = { screen: 'title', tab: 'mill', sel: 0, page: 0, shopPage: 0, speed: 1, paused: false, menu: false, helpPage: 0, hasSave: false, armNew: 0, toasts: [], lastLog: 0, lastSave: 0, reason: null, keys: 0, awayNote: null, seenEnd: null };
  const TABS = [['mill', 'MILL'], ['shop', 'SHOP'], ['ledger', 'LEDGER']];
  /* ---------- shape and size ---------- */
  let shapeName = 'wide', logicalScale = 1;
  function chooseShape() {
    const vv = window.visualViewport;
    const w = (vv && vv.width) || window.innerWidth, h = (vv && vv.height) || window.innerHeight;
    let name = 'tall', tallH = 800;
    if (w >= 860 && h >= 520) name = 'wide';
    else if (w > h) name = 'short';
    else tallH = Math.round(480 * h / w);
    return { name, tallH, w, h };
  }
  function applyShape() {
    const c = chooseShape();
    shapeName = c.name;
    const S = R.setShape(c.name, c.tallH);
    const scale = Math.min(c.w / S.W, c.h / S.H);
    logicalScale = scale;
    R.setCssScale(scale);
    const dpr = window.devicePixelRatio || 1;
    const bk = Math.max(1, Math.min(3, Math.ceil(scale * dpr - 0.01)));
    canvas.width = S.W * bk; canvas.height = S.H * bk;
    canvas.style.width = Math.floor(S.W * scale) + 'px';
    canvas.style.height = Math.floor(S.H * scale) + 'px';
    R.setBackstore(bk);
  }
  window.addEventListener('resize', applyShape);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', applyShape);
  applyShape();

  /* ---------- save ---------- */
  function save() {
    if (!G) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(Object.assign({}, G, { savedAt: Date.now(), speedUi: ui.speed }))); ui.saveFailed = false; } catch (e) { ui.saveFailed = true; }
  }
  function readSave() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { ui.reason = 'This browser is blocking storage, so the mill cannot be kept between visits.'; return null; }
    if (!raw) return null;
    let o = null;
    try { o = JSON.parse(raw); } catch (e) { ui.reason = 'A saved mill was found and could not be read. A new mill will start clean.'; return null; }
    if (!SIM.validSave(o)) { ui.reason = 'A saved mill was found that this version cannot open. A new mill will start clean.'; return null; }
    return o;
  }
  function loadGame() {
    const o = readSave();
    if (!o) return false;
    G = o;
    if (o.speedUi) ui.speed = o.speedUi;
    delete G.savedAt; delete G.speedUi;
    ui.lastLog = G.seq;
    ui.awayNote = 'The mill stood still while you were away. Nothing turned, nothing wore, nothing was lost.';
    return true;
  }
  function newGame() {
    const sd = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    G = SIM.newGame(sd);
    ui.lastLog = 0; ui.seenEnd = null;
    resetPlay();
    save();
  }
  function resetPlay() { ui.tab = 'mill'; ui.sel = 0; ui.page = 0; ui.shopPage = 0; ui.toasts = []; ui.paused = false; ui.menu = false; ui.awayNote = null; }
  ui.hasSave = !!readSave();
  try { if (localStorage.getItem(MUTE_KEY) === '1') A.setMuted(true); } catch (e) { /* storage blocked: sound stays on */ }

  /* the title's mill: a demo state with three machines working, stepped quietly in the background */
  function makeDemo() {
    const d = SIM.newGame(424242);
    d.coins = 5000; d.year = 2; d.season = 2; d.owned = { pond1: true, crown: true, breast: true }; d.pond = 1; d.wheel = 'breast'; d.level = 80;
    SIM.build(d, 'saw'); SIM.build(d, 'stocks');
    d.slots[0].gear = 4; d.slots[1].gear = 4; d.slots[1].on = true; d.slots[2].gear = 3; d.slots[2].on = true;
    d.stock = { grain: 50, logs: 50, wool: 50, bloom: 0, rags: 0 };
    /* the title's mill keeps itself: governors on every machine, and a millwright who mends anything for free */
    d.slots.forEach((m) => { if (m) m.gov = true; });
    d.log = [];
    return d;
  }

  /* ---------- toasts and the log ---------- */
  function toast(text, color, life) { ui.toasts.push({ text, color: color || P.ink, until: performance.now() + (life || 3.2) * 1000 }); if (ui.toasts.length > 3) ui.toasts.shift(); }
  function refuse(r) { if (r && !r.ok && r.why) { toast(r.why, P.bad, 3); A.play('refuse'); } }
  function fromSim() {
    if (!G) return;
    for (const e of G.log) {
      if (e.seq <= ui.lastLog) continue;
      ui.lastLog = e.seq;
      if (/ broke /.test(' ' + e.text + ' ') || /broke (racing|running)/.test(e.text)) A.play('break');
      else if (/rent, .* is paid/.test(e.text)) A.play('bell');
      else if (/paid\. .* owed/.test(e.text)) A.play('refuse');
      else if (/^Today: a spate/.test(e.text)) A.play('spate');
      if (e.kind === 'bad') toast(e.text, P.bad, 4.5);
      else if (e.kind === 'warn') toast(e.text, P.warn, 3.5);
      /* a phone has no log lines on screen, so the news a desktop player reads in the foot arrives as a short toast (review_010 #6) */
      else if (R.S.name !== 'wide' && !/^Today:|is over\.$/.test(e.text)) toast(e.text, e.kind === 'good' ? P.good : P.ink, 3);
    }
  }
  function drawToasts(now) {
    ui.toasts = ui.toasts.filter((t) => t.until > now);
    if (!ui.toasts.length) return;
    const S = R.S, sc = R.sceneRect();
    let y = sc.y + sc.h - 8;
    for (let i = ui.toasts.length - 1; i >= 0; i--) {
      const t = ui.toasts[i];
      const lines = R.wrap(t.text, sc.w - 40, { s: S.ts, w: 600 });
      const h = lines.length * (R.size({ s: S.ts }) + 4) + 12;
      y -= h;
      R.box(sc.x + 12, y, sc.w - 24, h, 'rgba(20,16,13,0.92)', t.color);
      lines.forEach((l, k) => T(l, sc.x + 22, y + 6 + (k + 1) * (R.size({ s: S.ts }) + 4) - 4, { s: S.ts, w: 600, c: t.color }));
      y -= 6;
    }
  }

  /* ---------- advice: one line, read off the state, that tells a new miller what the dials mean ---------- */
  function advice(sh) {
    if (!G) return null;
    const racing = [], slow = [], empty = [], broken = [], mended = [];
    G.slots.forEach((m, i) => {
      if (!m) return;
      if (m.broken && m.repair <= 0) { broken.push(i); return; }
      if (!m.on && m.mended && m.repair <= 0) { mended.push(i); return; }
      if (!m.on || m.repair > 0) return;
      if (m.gov) { if (SIM.band(m.type, sh.rpm[i]) === 'racing') racing.push(i); return; }
      const b = SIM.band(m.type, sh.rpm[i]);
      if (b === 'racing') { racing.push(i); return; }
      if (m.work !== undefined && m.work < 0.8 && sh.rpm[i] > 0) { empty.push(i); return; }
      if (b === 'slow') slow.push(i);
    });
    const nm = (i) => (i + 1) + ' ' + SIM.MACHINES[G.slots[i].type].short;
    if (racing.length) return { c: P.bad, t: 'RACING: bay ' + nm(racing[0]) + ' is over its band and wearing. Shift it DOWN a gear, or close the sluice a notch.' };
    if (broken.length) return { c: P.bad, t: 'Bay ' + nm(broken[0]) + ' is broken. MEND it from its row.' };
    if (mended.length) return { c: P.good, t: 'Bay ' + nm(mended[0]) + ' is mended and out of gear. Pick a gear that keeps it in its band, then put it IN.' };
    if (G.arrears > 0) return { c: P.bad, t: 'You owe the manor ' + SIM.money(G.arrears) + '. Miss a second quarter day and the lease ends.' };
    if (empty.length) { const m = G.slots[empty[0]], M = SIM.MACHINES[m.type]; return { c: P.warn, t: 'Bay ' + nm(empty[0]) + ' works faster than the carts bring ' + SIM.STOCKS[M.stock].name + ', and running short wears it. Take it OUT of gear till the store fills, or fit a governor.' }; }
    if (slow.length) { const m = G.slots[slow[0]], top = m.gear >= SIM.gearsAvail(G).slice(-1)[0]; return { c: P.slow, t: top ? 'SLOW: bay ' + nm(slow[0]) + ' is in its top gear and still under its band. Take another machine out to free the shaft, or open the sluice.' : 'SLOW: bay ' + nm(slow[0]) + ' is under its band. Shift it UP a gear, or take another machine out to free the shaft.' }; }
    if (G.next && G.next.id === 'spate') {
      /* a spate only reaches the shaft when the wheel is short of water and the pond is empty (review_010 #5 measured the old warning wrong in 15 of 24 cases) */
      const want = (G.sluice / 4) * SIM.WHEELS[G.wheel].intake;
      if (G.level < 1 && SIM.inflow(G) < want * 0.95) return { c: P.warn, t: 'A spate tomorrow: the wheel will get more water and the shaft will speed up. Be ready to shift down.' };
      return { c: P.water, t: 'A spate tomorrow: more water than your wheel can drink. The pond fills and the rest goes over the weir.' };
    }
    if (G.year === 1 && G.season === 0 && G.day < 8) return { c: P.ink, t: 'Your millstones turn inside the green arc on their dial: their band. When the river shifts, shift their gear (+ and \u2212) to stay in it.' };
    if (!G.owned.pond1 && G.coins >= 250) return { c: P.good, t: 'You can afford a mill pond (SHOP): it stores the spring flood for the summer drought.' };
    const can = SIM.ORDER.find((t) => SIM.canBuild(G, t).ok && !G.slots.some((m) => m && m.type === t));
    if (can) return { c: P.good, t: 'A ' + SIM.MACHINES[can].name.toLowerCase() + ' is for sale (SHOP). It ' + SIM.MACHINES[can].verb + '.' };
    if (G.coins >= SIM.FREEHOLD) return { c: P.gold, t: 'You can buy the freehold. SHOP, at the top.' };
    return null;
  }

  /* ---------- the top bar ---------- */
  function drawTop(sh) {
    const S = R.S, tp = S.top;
    R.box(tp.x, tp.y, tp.w, tp.h, '#1a1512');
    const s = SIM.SEASONS[G.season];
    const day = Math.min(SIM.SEASON_DAYS, Math.floor(G.day) + 1);
    const left = 'YEAR ' + G.year + '  ·  ' + s.name.toUpperCase() + '  ·  DAY ' + day;
    const due = SIM.rent(G) + G.arrears;
    const daysLeft = Math.max(0, Math.ceil(SIM.SEASON_DAYS - G.day));
    const rentTxt = s.quarter.toUpperCase() + ': ' + SIM.money(due) + ' IN ' + daysLeft + ' DAY' + (daysLeft === 1 ? '' : 'S');
    const coins = SIM.money(G.coins);
    if (S.name === 'tall') {
      T(left, 12, 26, { s: S.ts, w: 700, c: P.ink });
      T(coins, tp.w - 12, 28, { s: S.head + 4, f: 'head', a: 'right', c: P.gold, w: 400 });
      T(rentTxt, 12, 52, { s: S.tsS, w: 600, c: G.arrears > 0 ? P.bad : P.dim });
      T(G.coins >= due ? 'COVERED' : 'SHORT ' + SIM.money(due - G.coins), tp.w - 12, 52, { s: S.tsS, w: 700, a: 'right', c: G.coins >= due ? P.good : P.warn });
    } else {
      const y = Math.round(tp.h * 0.62);
      T(left, 12, y, { s: S.ts, w: 700 });
      T(coins, tp.w / 2 + (S.name === 'wide' ? -40 : -10), y + 2, { s: S.head + 4, f: 'head', a: 'center', c: P.gold, w: 400 });
      T(rentTxt, tp.w - 12, y, { s: S.tsS, w: 600, a: 'right', c: G.arrears > 0 ? P.bad : G.coins >= due ? P.dim : P.warn });
    }
    const frac = G.day / SIM.SEASON_DAYS;
    const ctx = R.ctx;
    ctx.fillStyle = '#2e2620'; ctx.fillRect(tp.x, tp.y + tp.h - 3, tp.w, 3);
    ctx.fillStyle = P.brass; ctx.fillRect(tp.x, tp.y + tp.h - 3, Math.round(tp.w * frac), 3);
  }

  /* ---------- the foot: advice, the log, and the clock controls ---------- */
  function speedButtons(x, y, h, compact) {
    const S = R.S;
    const w = compact ? 46 : 50;
    B('pause', ui.paused ? 'GO' : 'STOP', x, y, w + 6, h, { on: ui.paused, s: S.tsS });
    x += w + 10;
    if (compact) { B('speed', ui.speed + '×', x, y, w, h, { s: S.tsS }); x += w + 4; }
    else for (const v of [1, 2, 4]) { B('speedset', v + '×', x, y, 40, h, { on: ui.speed === v && !ui.paused, data: v, s: S.tsS }); x += 44; }
    return x;
  }
  function drawFoot(sh) {
    const S = R.S, f = S.foot;
    R.box(f.x, f.y, f.w, f.h, '#16120f');
    const adv = advice(sh);
    if (S.name === 'wide') {
      const bx = f.x + f.w - 268;
      let y = f.y + 18;
      const line1 = adv ? adv : { c: P.dim, t: SIM.forecast(G) };
      y += R.para(line1.t, f.x + 12, y, bx - f.x - 24, { s: S.ts, w: 600, c: line1.c }, S.lh) + 2;
      if (adv) { T(R.fit(SIM.forecast(G), bx - f.x - 24, { s: S.tsS }), f.x + 12, y, { s: S.tsS, c: P.water }); y += S.lh; }
      const recent = G.log.slice(-6).reverse();
      for (const e of recent) { if (y > f.y + f.h - 6) break; T(R.fitE(e.day + '  ' + e.text, bx - f.x - 24, { s: S.tsS }), f.x + 12, y, { s: S.tsS, c: e.kind === 'bad' ? P.bad : e.kind === 'good' ? P.good : P.faint }); y += S.lh - 1; }
      const x = speedButtons(bx, f.y + 10, 30, false);
      B('menu', 'MENU', bx, f.y + 52, 104, 30, { s: S.tsS });
      B('help', 'HOW TO PLAY', bx + 112, f.y + 52, 150, 30, { s: S.tsS });
      void x;
    } else if (S.name === 'short') {
      const bx = f.x + f.w - 120;
      const t = adv ? adv : { c: P.dim, t: SIM.forecast(G) };
      const lines = R.wrap(t.t, bx - f.x - 14, { s: S.tsS, w: 600 }).slice(0, adv ? 2 : 3);
      lines.forEach((l, k) => T(l, f.x + 8, f.y + 17 + k * 17, { s: S.tsS, w: 600, c: t.c }));
      if (adv) T(R.fit(SIM.forecast(G), bx - f.x - 14, { s: S.tsS }), f.x + 8, f.y + 17 + 2 * 17, { s: S.tsS, c: P.water });
      B('pause', ui.paused ? 'GO' : 'STOP', bx, f.y + 1, 62, 31, { on: ui.paused, s: S.tsS });
      B('speed', ui.speed + '×', bx + 66, f.y + 1, 52, 31, { s: S.tsS });
      B('menu', 'MENU', bx, f.y + 33, 62, 31, { s: S.tsS });
      B('help', '?', bx + 66, f.y + 33, 52, 31, { s: S.tsS });
    } else {
      const t = adv ? adv : { c: P.dim, t: SIM.forecast(G) };
      const lines = R.wrap(t.t, f.w - 20, { s: S.tsS, w: 600 });
      /* two lines: the advice, and the forecast when the advice fits in one (review_010 #6: the forecast was never drawn on a phone) */
      if (adv && lines.length === 1) lines.push(null);
      lines.slice(0, 2).forEach((l, k) => { if (l === null) T(R.fit(SIM.forecast(G), f.w - 20, { s: S.tsS }), f.x + 10, f.y + 18 + k * 18, { s: S.tsS, c: P.water }); else T(k === 1 && lines.length > 2 ? R.fit(l + ' ' + lines.slice(2).join(' '), f.w - 20, { s: S.tsS, w: 600 }) : l, f.x + 10, f.y + 18 + k * 18, { s: S.tsS, w: 600, c: t.c }); });
    }
  }
  function drawBottom() {
    const S = R.S, b = S.bottom;
    if (!b) return;
    R.box(b.x, b.y, b.w, b.h, '#1a1512');
    let x = 6;
    for (const [id, label] of TABS) { B('tab', label, x, b.y + 10, 86, 38, { on: ui.tab === id, data: id, s: S.tsS }); x += 89; }
    B('pause', ui.paused ? 'GO' : 'STOP', x + 2, b.y + 10, 58, 38, { on: ui.paused, s: S.tsS });
    B('speed', ui.speed + '×', x + 63, b.y + 10, 46, 38, { s: S.tsS });
    B('menu', 'MENU', b.w - 68, b.y + 10, 62, 38, { s: S.tsS });
  }

  /* ---------- the panel ---------- */
  function panelTabs(pn) {
    const S = R.S;
    if (S.name === 'tall') return pn.y + 6;
    const w = Math.floor((pn.w - 16) / 3);
    TABS.forEach(([id, label], k) => B('tab', label, pn.x + 6 + k * (w + 2), pn.y + 6, w, S.tap, { on: ui.tab === id, data: id, s: S.tsS }));
    return pn.y + 6 + S.tap + 6;
  }
  function pager(id, page, pages, x, y, w) {
    const S = R.S;
    if (pages <= 1) return 0;
    B(id, '◀', x, y, 44, S.tap, { data: -1, off: page <= 0, s: S.tsS });
    T('PAGE ' + (page + 1) + ' OF ' + pages, x + w / 2, y + S.tap / 2 + 5, { s: S.tsS, a: 'center', c: P.dim, w: 600 });
    B(id, '▶', x + w - 44, y, 44, S.tap, { data: 1, off: page >= pages - 1, s: S.tsS });
    return S.tap + 6;
  }
  function stateWord(m, rpm) {
    if (m.repair > 0) return ['MENDING', P.warn];
    if (m.broken) return ['BROKEN', P.bad];
    if (!m.on) return [m.govOut ? 'WAITING' : 'OUT OF GEAR', P.faint];
    const b = SIM.band(m.type, rpm);
    if (b === 'racing') return ['RACING', P.bad];
    const w = m.work === undefined ? 1 : m.work;
    if (rpm > 0 && w < 0.05) return ['EMPTY', P.warn];
    if (rpm > 0 && w < 0.8) return ['SHORT ' + Math.round(w * 100) + '%', P.warn];
    return b === 'good' ? ['IN BAND', P.good] : b === 'racing' ? ['RACING', P.bad] : b === 'slow' ? ['SLOW', P.slow] : ['STOPPED', P.faint];
  }
  function panelMill(pn, y, sh) {
    const S = R.S, x = pn.x + 8, w = pn.w - 16;
    const ctx = R.ctx;
    /* the river, the pond and the sluice */
    const cap = SIM.pondCap(G);
    const R0 = SIM.inflow(G);
    T('RIVER ' + R0.toFixed(2) + '  ·  WHEEL TAKES ' + sh.f.toFixed(2), x, y + 13, { s: S.tsS, w: 700, c: P.water });
    /* on the upright phone the pond figure sits on the river line, so two machines fit a page at 360x560 (review_010 #12) */
    const tallC = S.name === 'tall';
    if (tallC) T((G.pond ? 'POND ' : 'RACE ') + Math.round(G.level) + '/' + cap, x + w, y + 13, { s: S.tsS, w: 600, a: 'right', c: P.dim });
    y += S.lh + 2;
    const lv = Math.max(0, Math.min(1, G.level / cap));
    ctx.fillStyle = '#0e2a33'; ctx.fillRect(x, y, w, 10);
    ctx.fillStyle = '#3f8ea0'; ctx.fillRect(x, y, Math.round(w * lv), 10);
    if (REC.on()) R.REC.panels.push({ x, y, w, h: 10, at: R.REC.text.length });
    y += 14;
    if (!tallC) { T((G.pond ? 'POND ' : 'MILL RACE ') + Math.round(G.level) + ' OF ' + cap + (G.level >= cap - 0.01 && R0 > sh.f ? '  ·  SPILLING' : ''), x, y + 12, { s: S.tsS, c: P.dim, w: 600 }); y += S.lh + 2; }
    const sw = S.name === 'tall' ? 56 : 40;
    B('sluice', '−', x, y, sw, S.tap, { data: -1, off: G.sluice <= 0, s: S.head + 2 });
    const mid = x + sw + 4, midW = w - 2 * sw - 8;
    R.box(mid, y, midW, S.tap, '#241e19', P.edge);
    for (let k = 0; k < 4; k++) { ctx.fillStyle = k < G.sluice ? '#6cc0d0' : '#3a322b'; ctx.fillRect(mid + 8 + k * 12, y + 8, 9, S.tap - 16); }
    T('SLUICE ' + G.sluice + '/4', mid + 62, y + S.tap / 2 + 5, { s: S.tsS, w: 700 });
    B('sluice', '+', x + w - sw, y, sw, S.tap, { data: 1, off: G.sluice >= 4, s: S.head + 2 });
    y += S.tap + 6;
    T(SIM.WHEELS[G.wheel].short + '  ' + sh.P.toFixed(1) + ' HP', x, y + 12, { s: S.tsS, w: 600, c: P.dim });
    T('SHAFT ' + sh.S.toFixed(1), x + w, y + 12, { s: S.tsS, w: 700, a: 'right', c: P.ink });
    y += S.lh + 6;
    ctx.fillStyle = P.edge; ctx.fillRect(x, y - 3, w, 1);
    /* the machines, paged */
    const rowH = S.lh * 2 + S.tap + (S.name === 'tall' ? 6 : 12);
    const pagerH = S.tap + 6;
    const avail = pn.y + pn.h - y - 4;
    const n = G.slots.length;
    let per = Math.max(1, Math.floor(avail / rowH));
    if (per < n) per = Math.max(1, Math.floor((avail - pagerH) / rowH));
    const pages = Math.ceil(n / per);
    if (ui.sel !== null && ui.sel !== undefined) ui.page = Math.floor(ui.sel / per);
    ui.page = Math.max(0, Math.min(pages - 1, ui.page));
    for (let k = 0; k < per; k++) {
      const i = ui.page * per + k;
      if (i >= n) break;
      drawRow(i, x, y, w, rowH, sh);
      y += rowH;
    }
    if (pages > 1) pager('millpage', ui.page, pages, x, pn.y + pn.h - pagerH, w);
  }
  function drawRow(i, x, y, w, rowH, sh) {
    const S = R.S, m = G.slots[i];
    const ctx = R.ctx;
    if (ui.sel === i) { ctx.fillStyle = 'rgba(232,184,74,0.10)'; ctx.fillRect(x - 4, y, w + 8, rowH - 4); ctx.fillStyle = P.gold; ctx.fillRect(x - 4, y, 2, rowH - 4); }
    R.zone('select', x - 4, y, w + 8, S.lh + 4, i);
    if (!m) {
      T((i + 1) + '  EMPTY BAY', x, y + 14, { s: S.ts, w: 700, c: P.faint });
      B('tab', 'BUILD A MACHINE', x, y + S.lh + 4, Math.min(w, 200), S.tap, { data: 'shop', s: S.tsS });
      return;
    }
    const M = SIM.MACHINES[m.type], rpm = sh.rpm[i] || 0;
    const [word, col] = stateWord(m, rpm);
    T((i + 1) + '  ' + M.name.toUpperCase(), x, y + 14, { s: S.ts, w: 700 });
    T(word, x + w, y + 14, { s: S.tsS, w: 700, a: 'right', c: col });
    let by = y + S.lh + 4;
    const st = G.stock[M.stock], sup = SIM.STOCKS[M.stock].supply[G.season];
    const info = Math.round(rpm) + ' RPM  ·  BAND ' + M.lo + '–' + M.hi + '  ·  ' + SIM.STOCKS[M.stock].name.toUpperCase() + ' ' + Math.floor(st) + ' (+' + (Math.round(sup * 10) / 10) + '/DAY)';
    T(R.fit(info, w, { s: S.tsS, w: 600 }), x, by + 11, { s: S.tsS, c: P.dim, w: 600 });
    by += S.lh;
    const big = S.name === 'tall';
    const bw = big ? 52 : 32, gw = big ? 44 : 30;
    let bx = x;
    const locked = m.broken || m.repair > 0;
    B('shift', '−', bx, by, bw, S.tap, { data: { i, d: -1 }, off: locked || m.gear <= SIM.gearsAvail(G)[0], s: S.head + 2 });
    bx += bw + 2;
    R.box(bx, by, gw, S.tap, '#241e19', P.edge);
    T('G' + m.gear, bx + gw / 2, by + S.tap / 2 + 5, { s: S.tsS, w: 700, a: 'center', c: P.gold });
    bx += gw + 2;
    B('shift', '+', bx, by, bw, S.tap, { data: { i, d: 1 }, off: locked || m.gear >= SIM.gearsAvail(G).slice(-1)[0], s: S.head + 2 });
    bx += bw + 6;
    const cw = big ? 108 : 66;
    if (m.broken && m.repair <= 0) B('repair', 'MEND ' + SIM.money(SIM.repairCost(m)), bx, by, cw + (big ? 0 : 50), S.tap, { data: i, warn: true, s: S.tsS, off: G.coins < SIM.repairCost(m) });
    else if (m.repair > 0) { R.box(bx, by, cw, S.tap, '#241e19', P.edge); T('MENDING', bx + cw / 2, by + S.tap / 2 + 5, { s: S.tsS, a: 'center', c: P.warn, w: 700 }); }
    else B('clutch', m.on ? 'IN GEAR' : 'OUT', bx, by, cw, S.tap, { data: i, on: m.on, s: S.tsS });
    bx += cw + 4;
    const rest = x + w - bx;
    if (!(m.broken && m.repair <= 0) && rest >= 40) {
      if (m.gov) {
        /* the label that fits the box it sits in: GOVERNOR on a wide row, GOV ON on a narrow one (GOVERNOR overflowed a 50 px box on the desktop panel) */
        R.box(bx, by, rest, S.tap, '#2a3020', P.good);
        const gs = { s: S.tsS - 1, w: 700 }, lab = R.width('GOVERNOR', gs) <= rest - 8 ? 'GOVERNOR' : R.width('GOV ON', gs) <= rest - 8 ? 'GOV ON' : 'ON';
        T(lab, bx + rest / 2, by + S.tap / 2 + 5, { s: S.tsS - 1, a: 'center', c: P.good, w: 700 });
      }
      else B('governor', SIM.unlockIndex(G) < 3 ? 'GOV' : 'GOV ' + SIM.money(SIM.GOVERNOR_COST), bx, by, rest, S.tap, { data: i, off: SIM.unlockIndex(G) < 3 || G.coins < SIM.GOVERNOR_COST, s: S.tsS - 1 });
    }
  }
  function shopItems() {
    const out = [];
    out.push({ kind: 'freehold', name: 'BUY THE FREEHOLD', cost: SIM.FREEHOLD, says: 'The mill, the pond and the water rights, yours for ever. This ends the game.' });
    const rest = [];
    for (const t of SIM.ORDER) { const M = SIM.MACHINES[t]; rest.push({ kind: 'machine', id: t, name: M.name.toUpperCase(), cost: M.cost, says: 'It ' + M.verb + '. Band ' + M.lo + '–' + M.hi + ' rpm. ' + SIM.money(M.price) + ' a ' + M.goodUnit.replace(/s$/, '') + '.' }); }
    for (const U of SIM.UPGRADES) if (!G.owned[U.id]) rest.push({ kind: 'upgrade', id: U.id, name: U.name.toUpperCase(), cost: U.cost, says: U.says });
    /* what you could buy today first, cheapest first; what the year has not brought yet after it, soonest first */
    const lockOf = (it) => { const c = it.kind === 'machine' ? SIM.canBuild(G, it.id) : SIM.canBuy(G, it.id); return !c.ok && /comes to market|can be done|First:/.test(c.why || '') ? 1 : 0; };
    const unl = (it) => (it.kind === 'machine' ? SIM.MACHINES[it.id].unlock : SIM.UPGRADES.find((u) => u.id === it.id).unlock);
    rest.sort((a, b) => lockOf(a) - lockOf(b) || (lockOf(a) ? unl(a) - unl(b) : 0) || a.cost - b.cost);
    return out.concat(rest);
  }
  function panelShop(pn, y) {
    const S = R.S, x = pn.x + 8, w = pn.w - 16;
    const items = shopItems();
    const done = SIM.UPGRADES.filter((u) => G.owned[u.id]).length;
    T(R.fit(done + ' OF ' + SIM.UPGRADES.length + ' WORKS DONE  ·  ' + G.slots.filter(Boolean).length + ' OF ' + G.slots.length + ' BAYS USED', w, { s: S.tsS, w: 600 }), x, y + 12, { s: S.tsS, c: P.dim, w: 600 });
    y += S.lh + 4;
    const pagerH = S.tap + 6;
    const rows = [];
    for (const it of items) {
      const h = S.lh + 2 + R.paraHeight(it.says, w, { s: S.tsS }, S.lh - 2) + S.tap + 14;
      rows.push({ it, h });
    }
    const avail = pn.y + pn.h - y - pagerH - 4;
    const pages = [];
    let cur = [], used = 0;
    for (const r of rows) { if (used + r.h > avail && cur.length) { pages.push(cur); cur = []; used = 0; } cur.push(r); used += r.h; }
    if (cur.length) pages.push(cur);
    ui.shopPage = Math.max(0, Math.min(pages.length - 1, ui.shopPage));
    for (const { it, h } of pages[ui.shopPage] || []) {
      const ok = it.kind === 'freehold' ? { ok: G.coins >= SIM.FREEHOLD, why: 'The freehold is ' + SIM.money(SIM.FREEHOLD) + '.' } : it.kind === 'machine' ? SIM.canBuild(G, it.id) : SIM.canBuy(G, it.id);
      T(it.name, x, y + 14, { s: S.ts, w: 700, c: it.kind === 'freehold' ? P.gold : P.ink });
      T(SIM.money(it.cost), x + w, y + 14, { s: S.ts, w: 700, a: 'right', c: G.coins >= it.cost ? P.good : P.faint });
      let yy = y + S.lh + 2;
      yy += R.para(it.says, x, yy + 10, w, { s: S.tsS, c: P.dim }, S.lh - 2);
      if (it.kind === 'freehold') {
        const ctx = R.ctx, f = Math.min(1, G.coins / SIM.FREEHOLD);
        ctx.fillStyle = '#2e2620'; ctx.fillRect(x, yy + 12, w - 120, 8); ctx.fillStyle = P.gold; ctx.fillRect(x, yy + 12, Math.round((w - 120) * f), 8);
        B('freehold', 'BUY IT', x + w - 112, yy + 2, 112, S.tap, { gold: ok.ok, off: !ok.ok, s: S.tsS });
      } else {
        const locked = !ok.ok && /comes to market|can be done|First:/.test(ok.why || '');
        /* lead with WHEN: the season is the whole point of the line (review_010 #10 measured every lock line cut before its season) */
        const unl = it.kind === 'machine' ? SIM.MACHINES[it.id].unlock : SIM.UPGRADES.find((u) => u.id === it.id).unlock;
        const lockTxt = /First:/.test(ok.why || '') ? ok.why : 'FROM ' + SIM.whenIdx(unl).toUpperCase();
        if (locked) T(R.fit(lockTxt.toUpperCase(), w, { s: S.tsS, w: 700 }), x, yy + 14, { s: S.tsS, c: P.faint, w: 700 });
        else B(it.kind === 'machine' ? 'build' : 'buy', it.kind === 'machine' ? 'BUILD' : 'BUY', x + w - 112, yy + 2, 112, S.tap, { data: it.id, off: !ok.ok, s: S.tsS });
      }
      y += h;
      R.ctx.fillStyle = P.edge; R.ctx.fillRect(x, y - 5, w, 1);
    }
    pager('shoppage', ui.shopPage, pages.length, x, pn.y + pn.h - pagerH, w);
  }
  function panelLedger(pn, y) {
    const S = R.S, x = pn.x + 8, w = pn.w - 16, ctx = R.ctx;
    T('WHAT EACH BAY HAS EARNED', x, y + 13, { s: S.tsS, w: 700, c: P.gold });
    y += S.lh + 2;
    const max = Math.max(1, ...G.slots.map((m) => (m ? m.earned : 0)));
    G.slots.forEach((m, i) => {
      if (!m) return;
      const M = SIM.MACHINES[m.type];
      T((i + 1) + ' ' + M.short, x, y + 12, { s: S.tsS, w: 600 });
      const bx = x + 78, bw = w - 78 - 70;
      ctx.fillStyle = '#2e2620'; ctx.fillRect(bx, y + 3, bw, 9); ctx.fillStyle = P.brass; ctx.fillRect(bx, y + 3, Math.round(bw * m.earned / max), 9);
      T(SIM.money(m.earned), x + w, y + 12, { s: S.tsS, a: 'right', c: P.dim, w: 600 });
      y += S.lh;
    });
    y += 6;
    T('THE RIVER, LAST ' + G.flowHist.length + ' DAYS', x, y + 13, { s: S.tsS, w: 700, c: P.water });
    y += S.lh + 2;
    const ch = S.name === 'short' ? 34 : 46;
    ctx.fillStyle = '#0e1d22'; ctx.fillRect(x, y, w, ch);
    if (R.REC.on) R.REC.panels.push({ x, y, w, h: ch, at: R.REC.text.length });
    const hist = G.flowHist, n = hist.length;
    if (n > 1) {
      ctx.strokeStyle = '#6cc0d0'; ctx.lineWidth = 1.5; ctx.beginPath();
      hist.forEach((v, k) => { const px = x + (k / (n - 1)) * w, py = y + ch - Math.min(1, v / 3) * (ch - 4) - 2; if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.stroke();
      const wy = y + ch - Math.min(1, SIM.WHEELS[G.wheel].intake / 3) * (ch - 4) - 2;
      ctx.fillStyle = 'rgba(232,184,74,0.6)'; ctx.fillRect(x, Math.round(wy), w, 1);
    }
    y += ch + 4;
    T('gold line: what your wheel can drink', x, y + 11, { s: S.tsS, c: P.faint });
    y += S.lh + 2;
    const t = G.totals;
    const lines = [
      'Made: ' + Math.round(t.flour) + ' sacks of flour, ' + Math.round(t.planks) + ' planks, ' + Math.round(t.cloth) + ' bolts, ' + Math.round(t.iron) + ' bars, ' + Math.round(t.paper) + ' reams.',
      'Rent paid ' + SIM.money(G.rentPaid) + ' over ' + G.quarters + ' quarter day' + (G.quarters === 1 ? '' : 's') + '. Breaks ' + t.breaks + '. Gear changes ' + t.shifts + '.',
      'If the steward ends the lease you go back to Michaelmas, Year ' + (G.checkpoint ? G.checkpoint.year : G.year) + ', with the mill as it stood then.',
    ];
    for (const l of lines) { if (y > pn.y + pn.h - S.lh) break; y += R.para(l, x, y + 12, w, { s: S.tsS, c: P.dim }, S.lh - 1) + 4; }
  }
  const REC = { on: () => R.REC.on };
  function drawPanel(sh) {
    const S = R.S, pn = S.panel;
    R.box(pn.x, pn.y, pn.w, pn.h, P.panel);
    R.ctx.fillStyle = P.edge; R.ctx.fillRect(pn.x, pn.y, S.name === 'tall' ? pn.w : 1, S.name === 'tall' ? 1 : pn.h);
    const y = panelTabs(pn);
    if (ui.tab === 'mill') panelMill(pn, y, sh);
    else if (ui.tab === 'shop') panelShop(pn, y);
    else panelLedger(pn, y);
  }
  function liveShaft(g) { const sh = SIM.shaft(g); sh.R = SIM.inflow(g); return sh; }
  function drawPlay(now) {
    const sh = liveShaft(G);
    R.drawScene(G, sh, now, { sel: ui.sel, running: !ui.paused && !ui.menu });
    for (let i = 0; i < G.slots.length; i++) { const r = R.bayRect(i); R.zone('select', r.x, r.y + r.h * 0.25, r.w, r.h * 0.75, i); }
    drawTop(sh);
    drawPanel(sh);
    drawFoot(sh);
    drawBottom();
    if (ui.paused && !ui.menu) { const sc = R.sceneRect(); T('STOPPED  ·  PRESS GO', sc.x + sc.w / 2, sc.y + 26, { s: R.S.head, f: 'head', a: 'center', c: P.gold, shadow: '#000', shadowD: 2 }); }
    if (ui.awayNote) { const sc = R.sceneRect(); toast(ui.awayNote, P.water, 5); ui.awayNote = null; void sc; }
    drawToasts(now);
    let racing = 0;
    G.slots.forEach((m, i) => { if (m && m.on && !m.broken && SIM.band(m.type, sh.rpm[i]) === 'racing') racing = Math.max(racing, sh.rpm[i] - SIM.MACHINES[m.type].hi); });
    A.setShaft(sh.S, racing, !ui.paused && !ui.menu);
    if (ui.menu) drawMenu();
  }

  /* ---------- overlays ---------- */
  /* a brass gear drawn at full size: the seal on every sheet, turning slowly; broken teeth for the eviction */
  function seal(cx, cy, r, ang, broken) {
    const ctx = R.ctx, teeth = 14;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(ang);
    ctx.fillStyle = broken ? '#7a6a5a' : '#b88a3e';
    ctx.beginPath();
    for (let k = 0; k < teeth; k++) {
      if (broken && k % 4 === 1) { const a = k * Math.PI * 2 / teeth; ctx.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82); continue; }
      const a0 = (k - 0.25) * Math.PI * 2 / teeth, a1 = (k + 0.25) * Math.PI * 2 / teeth;
      ctx.lineTo(Math.cos(a0) * r * 0.82, Math.sin(a0) * r * 0.82); ctx.lineTo(Math.cos(a0) * r, Math.sin(a0) * r); ctx.lineTo(Math.cos(a1) * r, Math.sin(a1) * r); ctx.lineTo(Math.cos(a1) * r * 0.82, Math.sin(a1) * r * 0.82);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = broken ? '#5a4c40' : '#8a6424'; ctx.beginPath(); ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = P.paper; for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.arc(Math.cos(k * Math.PI / 2 + 0.78) * r * 0.36, Math.sin(k * Math.PI / 2 + 0.78) * r * 0.36, r * 0.13, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = '#2b2017'; ctx.beginPath(); ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  /* an opaque sheet sized to what it holds: the screen behind is dimmed, its controls are dead (render.cover) */
  function sheet(title, sub, contentH, broken) {
    const S = R.S;
    R.ctx.fillStyle = 'rgba(10,8,6,0.78)'; R.ctx.fillRect(0, 0, S.W, S.H);
    const w = Math.min(S.W - 24, S.name === 'wide' ? 620 : 460);
    const h = Math.min(S.H - 24, Math.max(220, 92 + (contentH || 200) + 24));
    const x = Math.round((S.W - w) / 2), y = Math.round((S.H - h) / 2);
    R.cover(0, 0, S.W, S.H);
    R.box(x, y, w, h, P.paper, '#8a6a40');
    R.ctx.fillStyle = '#e2d1ab'; R.ctx.fillRect(x + 6, y + 6, w - 12, 2); R.ctx.fillRect(x + 6, y + h - 8, w - 12, 2);
    const ts = { s: S.head + 12, f: 'head', a: 'center', c: P.paperInk, w: 400 };
    const tw = R.width(title, ts);
    const t = performance.now() / 4000;
    if (x + w / 2 - tw / 2 - 40 > x + 8) { seal(x + w / 2 - tw / 2 - 24, y + 36, 15, t, broken); seal(x + w / 2 + tw / 2 + 24, y + 36, 15, -t + 0.2, broken); }
    T(title, x + w / 2, y + 44, ts);
    if (sub) T(R.fit(sub, w - 24, { s: S.tsS, w: 600 }), x + w / 2, y + 68, { s: S.tsS, a: 'center', c: P.paperDim, w: 600 });
    return { x, y, w, h };
  }
  function drawMenu() {
    const S = R.S, b = sheet('THE MILL STANDS', 'Nothing turns while this is open.', 5 * (S.tap + 16));
    const bw = Math.min(260, b.w - 40), bx = b.x + (b.w - bw) / 2;
    let y = b.y + 96;
    B('menuclose', 'BACK TO THE MILL', bx, y, bw, S.tap + 6, { gold: true }); y += S.tap + 16;
    B('help', 'HOW TO PLAY', bx, y, bw, S.tap + 6); y += S.tap + 16;
    B('mute', A.muted ? 'SOUND: OFF' : 'SOUND: ON', bx, y, bw, S.tap + 6); y += S.tap + 16;
    B('credits', 'CREDITS', bx, y, bw, S.tap + 6); y += S.tap + 16;
    B('totitle', 'SAVE AND LEAVE', bx, y, bw, S.tap + 6);
  }
  const HELP = [
    ['THE SHAFT', 'One water wheel turns one shaft, and every machine on it takes its turn from that shaft through its own gearbox.\n\nEach machine has a BAND, the green arc on its dial. Inside the band it works. Under it, it drags and makes little. Over it, it RACES: it wears, and if you leave it racing it breaks.\n\nEvery machine you put IN GEAR slows the whole shaft a little, the busier ones more. So a new machine can pull its neighbours under their bands.'],
    ['SHIFTING', 'Shift a machine UP (+) to make it turn faster, DOWN (−) to slow it. Put it OUT of gear and it rests, wears nothing and frees the shaft for the others.\n\nThe river SHIFTS under you. Autumn rains, a thin winter, a spring flood that races everything, a dry summer that drags it all. A spate is forecast a day ahead.\n\nThe SLUICE sets how much water reaches the wheel. Close it a notch in a flood and every machine slows together.'],
    ['THE YEAR', 'The carts bring work by season: grain after the harvest in autumn, logs in winter, loom cloth after the shearing in summer, bloom and rags all year. A machine with nothing to work wears running empty: take it out of gear.\n\nThe manor wants its rent on every quarter day, rising each year. Miss two quarter days in a row and the steward ends the lease: you go back to Michaelmas of that year with the mill as it stood, the arrears forgiven and every machine mended.\n\nA mill POND stores the spring flood for the summer. GOVERNORS shift for you. Buy the FREEHOLD and the mill is yours.'],
  ];
  function drawHelp() {
    const S = R.S, pg = HELP[ui.helpPage];
    const pad = 24, w = Math.min(S.W - 24, S.name === 'wide' ? 620 : 460);
    const ph = R.paraHeight(pg[1], w - pad * 2, { s: S.ts, w: 500 }, S.lh + 2);
    const b = sheet('HOW TO PLAY', (ui.helpPage + 1) + ' of ' + HELP.length + '  ·  ' + pg[0], ph + S.tap + 36);
    R.para(pg[1], b.x + pad, b.y + 104, b.w - pad * 2, { s: S.ts, c: P.paperInk, w: 500 }, S.lh + 2);
    const by = b.y + b.h - S.tap - 18;
    B('helppage', 'BACK', b.x + pad, by, 100, S.tap, { data: -1, off: ui.helpPage === 0 });
    B('helpclose', 'DONE', b.x + b.w / 2 - 60, by, 120, S.tap, { gold: true });
    B('helppage', 'NEXT', b.x + b.w - pad - 100, by, 100, S.tap, { data: 1, off: ui.helpPage >= HELP.length - 1 });
  }
  function drawCredits() {
    const S = R.S;
    const pad = 24, w = Math.min(S.W - 24, S.name === 'wide' ? 620 : 460);
    const txt ='A game by Core Systems Asset Factory, made for GitHub Game Off 2026 (theme: SHIFT).\n\n' +
      'Made with AI. The code, the pixel art drawers, the words and the tune were written with Claude, an AI model, working for the studio. The music and every sound are synthesised by the game’s own code; no recorded samples.\n\n' +
      'Type: Alfa Slab One and Zilla Slab, both under the SIL Open Font License (texts in the fonts folder).\n\n' +
      'Mill materials made with the studio’s own pixel generator. No third-party art.';
    const b = sheet('CREDITS', 'OVERSHOT  ·  version ' + SIM.VERSION, R.paraHeight(txt, w - pad * 2, { s: S.tsS, w: 500 }, S.lh) + S.tap + 36);
    R.para(txt, b.x + pad, b.y + 100, b.w - pad * 2, { s: S.tsS, c: P.paperInk, w: 500 }, S.lh);
    B('creditsclose', 'DONE', b.x + b.w / 2 - 60, b.y + b.h - S.tap - 18, 120, S.tap, { gold: true });
  }
  function summaryLines() {
    const t = G.totals;
    return [
      'Year ' + G.year + ', ' + SIM.SEASONS[G.season].name.toLowerCase() + '.  ' + G.quarters + ' quarter day' + (G.quarters === 1 ? '' : 's') + '.',
      Math.round(t.flour) + ' sacks of flour  ·  ' + Math.round(t.planks) + ' planks  ·  ' + Math.round(t.cloth) + ' bolts',
      Math.round(t.iron) + ' bars of iron  ·  ' + Math.round(t.paper) + ' reams of paper',
      'Earned ' + SIM.money(t.coins) + '  ·  rent paid ' + SIM.money(G.rentPaid),
      t.shifts + ' gear changes  ·  ' + t.breaks + ' breaks',
    ];
  }
  function drawEnding(now) {
    const S = R.S;
    const sh = liveShaft(G);
    /* the whole mill screen as it stood, dimmed under the sheet: never a black panel beside the picture */
    R.drawScene(G, sh, now, { running: true, dials: false });
    drawTop(sh); drawPanel(sh); drawFoot(sh); drawBottom();
    A.setShaft(0, 0, false);
    if (ui.seenEnd !== G.ended) { ui.seenEnd = G.ended; A.play(G.ended === 'freehold' ? 'freehold' : 'evicted'); save(); }
    const won = G.ended === 'freehold';
    const b = sheet(won ? 'THE FREEHOLD' : 'THE LEASE IS ENDED', won ? 'The mill belongs to the miller.' : 'Two quarter days unpaid. The steward has the keys.', 5 * (S.lh + 4) + 2 * (S.tap + 14) + 40, !won);
    let y = b.y + 100;
    for (const l of summaryLines()) { T(R.fit(l, b.w - 40, { s: S.ts }), b.x + b.w / 2, y, { s: S.ts, a: 'center', c: P.paperInk, w: 600 }); y += S.lh + 4; }
    const bw = Math.min(300, b.w - 40), bx = b.x + (b.w - bw) / 2;
    y = b.y + b.h - (S.tap + 12) * 2 - 14;
    if (won) { B('newmill', 'A NEW MILL', bx, y, bw, S.tap + 4, { gold: true }); }
    else B('checkpoint', 'BACK TO MICHAELMAS, YEAR ' + (G.checkpoint ? G.checkpoint.year : 1), bx, y, bw, S.tap + 4, { gold: true });
    B('totitle', 'TITLE', bx, y + S.tap + 14, bw, S.tap + 4);
  }
  function drawTitle(now) {
    const S = R.S;
    if (!demo) demo = makeDemo();
    /* the title's mill runs on the clock (2x), not one step per frame: at 60 Hz it strobed through a season every 1.5 s (review_010 #22) */
    const dms = ui.demoAt ? Math.min(1000, now - ui.demoAt) : 0; ui.demoAt = now; ui.demoAcc = (ui.demoAcc || 0) + dms * 2;
    while (ui.demoAcc >= SIM.TICK * 1000) { SIM.step(demo); ui.demoAcc -= SIM.TICK * 1000; }
    demo.slots.forEach((m) => { if (m && m.broken) { m.broken = false; m.wear = 0; m.on = true; } });
    demo.coins = 5000; demo.arrears = 0; demo.strikes = 0;
    if (demo.ended || demo.year > 3) demo = makeDemo();
    const sh = liveShaft(demo);
    R.drawScene(demo, sh, now, { running: true });
    const ctx = R.ctx;
    let px, py, pw, ph;
    if (S.name === 'tall') { px = 0; py = S.scene.y + R.NH * S.scene.s; pw = S.W; ph = S.H - py; R.box(0, 0, S.W, S.scene.y, '#1a1512'); }
    else { px = S.panel.x; py = 0; pw = S.panel.w; ph = S.H; R.box(0, 0, S.panel.x, S.scene.y, '#1a1512'); R.box(0, S.scene.y + R.NH * S.scene.s, S.panel.x, S.H - S.scene.y - R.NH * S.scene.s, '#16120f'); }
    R.box(px, py, pw, ph, P.panel);
    ctx.fillStyle = P.edge; ctx.fillRect(px, py, S.name === 'tall' ? pw : 1, S.name === 'tall' ? 1 : ph);
    const cx = px + pw / 2;
    let y = py + (S.name === 'tall' ? 52 : S.name === 'short' ? 50 : 86);
    let tsz = S.name === 'tall' ? 50 : S.name === 'short' ? 34 : 40;
    while (tsz > 20 && R.width('OVERSHOT', { s: tsz, f: 'head', w: 400 }) > pw - 24) tsz -= 1;
    T('OVERSHOT', cx, y, { s: tsz, f: 'head', a: 'center', c: P.gold, w: 400, shadow: '#000', shadowD: 3 });
    y += S.name === 'short' ? 22 : 30;
    for (const l of R.wrap('a water mill on a shifting river', pw - 24, { s: S.ts, w: 600 })) { T(l, cx, y, { s: S.ts, a: 'center', c: P.dim, w: 600 }); y += S.lh; }
    y += S.name === 'short' ? 2 : 12;
    if (S.name !== 'short') {
      const blurb = 'Shift every machine’s gears to hold it in its band while the seasons shift the river under you. Pay the rent. Buy the freehold.';
      y += R.para(blurb, px + 18, y, pw - 36, { s: S.tsS, c: P.ink, w: 500 }, S.lh) + 10;
    }
    const bw = Math.min(pw - 36, 280), bx = cx - bw / 2;
    const gap = S.name === 'short' ? 6 : 12;
    if (ui.hasSave) { B('continue', 'CONTINUE', bx, y, bw, S.tap + 4, { gold: true }); y += S.tap + 4 + gap; }
    B('new', ui.armNew > performance.now() ? 'START OVER? TAP AGAIN' : 'NEW MILL', bx, y, bw, S.tap + 4, { gold: !ui.hasSave, warn: ui.armNew > performance.now() }); y += S.tap + 4 + gap;
    B('help', 'HOW TO PLAY', bx, y, bw, S.tap + 4); y += S.tap + 4 + gap;
    B('credits', 'CREDITS', bx, y, (bw - 6) / 2, S.tap + 4); B('mute', A.muted ? 'SOUND OFF' : 'SOUND ON', bx + (bw + 6) / 2, y, (bw - 6) / 2, S.tap + 4); y += S.tap + 4 + gap;
    if (ui.reason) R.para(ui.reason, px + 18, y + 12, pw - 36, { s: S.tsS, c: P.warn }, S.lh);
    T('GitHub Game Off 2026  ·  theme SHIFT', cx, py + ph - 14, { s: S.tsS, a: 'center', c: P.faint, w: 600 });
    A.setShaft(sh.S, 0, false);
  }

  /* ---------- acting ---------- */
  function act(id, data) {
    A.init();
    if (id === 'new') {
      if (ui.hasSave && ui.armNew < performance.now()) { ui.armNew = performance.now() + 3000; A.play('tick'); return; }
      newGame(); ui.screen = 'play'; ui.hasSave = true; A.music(true); A.play('build'); return;
    }
    if (id === 'continue') { if (loadGame()) { ui.screen = G.ended ? 'ending' : 'play'; ui.seenEnd = G.ended; resetPlay(); ui.awayNote = 'The mill stood still while you were away. Nothing turned, nothing wore, nothing was lost.'; A.music(true); A.play('tick'); } else { ui.hasSave = false; } return; }
    if (id === 'help') { ui.prev = ui.screen; ui.screen = 'help'; ui.helpPage = 0; A.play('tick'); return; }
    if (id === 'helppage') { ui.helpPage = Math.max(0, Math.min(HELP.length - 1, ui.helpPage + data)); A.play('tick'); return; }
    if (id === 'helpclose') { ui.screen = ui.prev && ui.prev !== 'help' ? ui.prev : (G ? 'play' : 'title'); A.play('tick'); return; }
    if (id === 'credits') { ui.prev = ui.screen; ui.screen = 'credits'; A.play('tick'); return; }
    if (id === 'creditsclose') { ui.screen = ui.prev && ui.prev !== 'credits' ? ui.prev : 'title'; A.play('tick'); return; }
    if (id === 'mute') { A.setMuted(!A.muted); try { localStorage.setItem(MUTE_KEY, A.muted ? '1' : '0'); } catch (e) { /* ignore */ } if (!A.muted) { A.music(true); A.play('tick'); } return; }
    if (id === 'totitle') { save(); ui.screen = 'title'; ui.menu = false; ui.hasSave = !!readSave(); A.play('tick'); return; }
    if (id === 'menu') { ui.menu = true; A.play('tick'); return; }
    if (id === 'menuclose') { ui.menu = false; A.play('tick'); return; }
    if (id === 'newmill') { G = null; try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } ui.hasSave = false; newGame(); ui.screen = 'play'; ui.hasSave = true; A.play('build'); return; }
    if (id === 'checkpoint') { const r = SIM.restoreCheckpoint(G); if (r.ok) { ui.screen = 'play'; ui.seenEnd = null; resetPlay(); ui.lastLog = G.seq - 1; save(); A.play('bell'); } else refuse(r); return; }
    if (!G) return;
    if (id === 'pause') { ui.paused = !ui.paused; A.play('tick'); return; }
    if (id === 'speed') { ui.speed = ui.speed === 1 ? 2 : ui.speed === 2 ? 4 : 1; ui.paused = false; A.play('tick'); return; }
    if (id === 'speedset') { ui.speed = data; ui.paused = false; A.play('tick'); return; }
    if (id === 'tab') { ui.tab = data; A.play('tick'); return; }
    if (id === 'millpage') { ui.sel = null; ui.page += data; A.play('tick'); return; }
    if (id === 'shoppage') { ui.shopPage += data; A.play('tick'); return; }
    if (id === 'select') { ui.sel = data; if (R.S.name === 'tall' && ui.tab !== 'mill') ui.tab = 'mill'; A.play('tick'); return; }
    if (id === 'shift') { const r = SIM.shift(G, data.i, data.d); ui.sel = data.i; if (r.ok) A.play(data.d > 0 ? 'shift' : 'shiftdown'); else refuse(r); return; }
    if (id === 'clutch') { const r = SIM.clutch(G, data); ui.sel = data; if (r.ok) A.play(r.on ? 'clutchin' : 'clutchout'); else refuse(r); return; }
    if (id === 'repair') { const r = SIM.repair(G, data); if (r.ok) A.play('coin'); else refuse(r); return; }
    if (id === 'governor') { const r = SIM.buyGovernor(G, data); if (r.ok) A.play('build'); else refuse(r); return; }
    if (id === 'sluice') { const r = SIM.setSluice(G, G.sluice + data); if (r.ok) A.play('sluice'); else refuse(r); return; }
    if (id === 'build') { const r = SIM.build(G, data); if (r.ok) { A.play('build'); ui.tab = 'mill'; ui.sel = r.slot; toast(SIM.MACHINES[data].name + ' is in bay ' + (r.slot + 1) + ', out of gear. Pick a gear, then IN GEAR.', P.good, 4); } else refuse(r); save(); return; }
    if (id === 'buy') { const r = SIM.buy(G, data); if (r.ok) { A.play('build'); toast(SIM.UPGRADES.find((u) => u.id === data).name + ': done.', P.good, 3); } else refuse(r); save(); return; }
    if (id === 'freehold') { const r = SIM.buyFreehold(G); if (r.ok) { ui.screen = 'ending'; save(); } else refuse(r); return; }
  }
  /* ---------- input: one door, and a control acts on the lift, on the control it went down on ---------- */
  function toLogical(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * R.S.W / r.width, y: (ev.clientY - r.top) * R.S.H / r.height };
  }
  let down = null;
  canvas.addEventListener('pointerdown', (ev) => {
    try { window.focus(); } catch (e) { /* ignore */ }
    try { canvas.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    A.init();
    A.music(true);
    if (!ev.isPrimary) return;
    const p = toLogical(ev);
    down = { hit: R.hitAt(p.x, p.y), x: p.x, y: p.y, id: ev.pointerId };
    ev.preventDefault();
  });
  canvas.addEventListener('pointerup', (ev) => {
    if (!down || ev.pointerId !== down.id) return;
    const p = toLogical(ev);
    const h = R.hitAt(p.x, p.y);
    const d = down; down = null;
    if (!d.hit || !h) return;
    if (h.id !== d.hit.id || JSON.stringify(h.data) !== JSON.stringify(d.hit.data)) return;
    if (h.off) { if (h.id === 'shift' || h.id === 'build' || h.id === 'buy' || h.id === 'freehold' || h.id === 'governor' || h.id === 'repair' || h.id === 'sluice') act(h.id, h.data); return; }
    act(h.id, h.data);
  });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());
  canvas.addEventListener('pointermove', (ev) => { const p = toLogical(ev); const h = R.hitAt(p.x, p.y); canvas.style.cursor = h && !h.off ? 'pointer' : 'default'; });
  const held = new Set();
  window.addEventListener('blur', () => held.clear());
  window.addEventListener('keyup', (ev) => held.delete(ev.key));
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Tab') return;
    ui.keys++;
    A.init(); A.music(true);
    const key = ev.key.toLowerCase();
    if (held.has(ev.key) && !ev.repeat) held.delete(ev.key);
    held.add(ev.key);
    if (key === 'm') { act('mute'); return; }
    if (ui.screen === 'help') { if (key === 'arrowright') act('helppage', 1); else if (key === 'arrowleft') act('helppage', -1); else if (key === 'escape' || key === 'enter') act('helpclose'); return; }
    if (ui.screen === 'credits') { if (key === 'escape' || key === 'enter') act('creditsclose'); return; }
    if (ui.screen === 'ending' && G) { if (key === 'enter' || key === ' ') { ev.preventDefault(); act(G.ended === 'freehold' ? 'newmill' : 'checkpoint'); } else if (key === 'escape') act('totitle'); return; }
    if (ui.screen === 'title') { if (key === 'enter' || key === ' ') { ev.preventDefault(); act(ui.hasSave ? 'continue' : 'new'); } return; }
    if (ui.screen !== 'play' || !G) return;
    if (ui.menu) { if (key === 'escape' || key === 'enter') act('menuclose'); return; }
    if (key === 'escape') { act('menu'); return; }
    if (key === 'p') { act('pause'); return; }
    if (key === 'f') { act('speed'); return; }
    if (key >= '1' && key <= '6') { const i = +key - 1; if (i < G.slots.length) act('select', i); return; }
    const i = ui.sel;
    if (key === 'arrowup' || key === 'w' || key === '+' || key === '=') { ev.preventDefault(); if (i !== null && G.slots[i]) act('shift', { i, d: 1 }); return; }
    if (key === 'arrowdown' || key === 's' || key === '-') { ev.preventDefault(); if (i !== null && G.slots[i]) act('shift', { i, d: -1 }); return; }
    if (key === 'arrowleft') { ev.preventDefault(); act('select', Math.max(0, (i || 0) - 1)); return; }
    if (key === 'arrowright') { ev.preventDefault(); act('select', Math.min(G.slots.length - 1, (i === null ? -1 : i) + 1)); return; }
    if (key === ' ' || key === 'enter') { ev.preventDefault(); if (i !== null && G.slots[i]) act('clutch', i); return; }
    if (key === '[') { act('sluice', -1); return; }
    if (key === ']') { act('sluice', 1); return; }
    if (key === 'q') { act('tab', 'mill'); return; }
    if (key === 'e') { act('tab', 'shop'); return; }
    if (key === 'l') { act('tab', 'ledger'); return; }
  });
  /* ---------- the loop ---------- */
  let last = 0, acc = 0, frozen = false;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { save(); A._stopMusic && A._stopMusic(); A.setShaft(0, 0, false); }
    else { last = 0; if (!A.muted && (ui.screen === 'play' || ui.screen === 'title')) A.music(true); }
  });
  window.addEventListener('pagehide', save);
  function body(now) {
    R.resetHits();
    const S = R.S, g = R.ctx;
    g.setTransform(R.bk, 0, 0, R.bk, 0, 0);
    g.globalAlpha = 1;
    g.fillStyle = '#100d0b'; g.fillRect(0, 0, S.W, S.H);
    if (ui.screen === 'title') drawTitle(now);
    else if (ui.screen === 'play') drawPlay(now);
    else if (ui.screen === 'ending') drawEnding(now);
    else if (ui.screen === 'help' || ui.screen === 'credits') {
      /* the screen it was opened from, whole, under the sheet (the sheet's cover() kills that screen's controls) */
      if (G && ui.prev === 'play') { const sh = liveShaft(G); R.drawScene(G, sh, now, { running: false }); drawTop(sh); drawPanel(sh); drawFoot(sh); drawBottom(); }
      else drawTitle(now);
      if (ui.screen === 'help') drawHelp(); else drawCredits();
      A.setShaft(0, 0, false);
    }
  }
  function simulate(dt) {
    if (ui.screen === 'play' && G && G.ended) { ui.screen = 'ending'; return; }
    if (ui.screen !== 'play' || !G || ui.paused || ui.menu || G.ended) return;
    acc += dt * ui.speed;
    let n = 0;
    while (acc >= SIM.TICK && n < 40) { SIM.step(G); acc -= SIM.TICK; n++; if (G.ended) break; }
    if (n >= 40) acc = 0;
    fromSim();
    if (G.ended) { ui.screen = 'ending'; save(); }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = last ? Math.min(0.25, (now - last) / 1000) : 0;
    last = now;
    if (frozen) return;
    try {
      simulate(dt);
      if (ui.screen === 'play' && G && now - ui.lastSave > 8000) { ui.lastSave = now; save(); }
      body(now);
    } catch (e) {
      R.ctx.setTransform(R.bk, 0, 0, R.bk, 0, 0);
      R.ctx.fillStyle = '#100d0b'; R.ctx.fillRect(0, 0, R.S.W, R.S.H);
      R.ctx.fillStyle = '#ff7a55'; R.ctx.font = '16px sans-serif'; R.ctx.textAlign = 'left';
      R.ctx.fillText('Something went wrong: ' + e.message, 16, 40);
      R.ctx.fillStyle = '#f3e9d2'; R.ctx.fillText('Your mill is saved. Reload the page to carry on.', 16, 66);
      if (!window.__OVERSHOT_ERR) { window.__OVERSHOT_ERR = e; console.error(e); }
    }
  }
  const start = () => requestAnimationFrame(frame);
  const faces = document.fonts && document.fonts.load ? Promise.all([document.fonts.load("400 40px 'Overshot Head'"), document.fonts.load("500 14px 'Overshot Sans'"), document.fonts.load("700 14px 'Overshot Sans'")]) : Promise.resolve();
  let started = false;
  const go = () => { if (started) return; started = true; window.__OVERSHOT_READY = true; start(); };
  faces.then(go, go);
  setTimeout(go, 3000);
  /* a small door for the test harness: never used by the game itself */
  window.OVERSHOT = {
    get G() { return G; }, set G(v) { G = v; }, ui, act, render: (now) => body(now === undefined ? performance.now() : now), save, loadGame, newGame, applyShape, simulate,
    setFrozen(v) { frozen = !!v; }, get shape() { return shapeName; }, get scale() { return logicalScale; }, liveShaft: () => (G ? liveShaft(G) : null), advice: () => (G ? advice(liveShaft(G)) : null),
    begin() { if (!G) newGame(); ui.screen = 'play'; resetPlay(); },
  };
  window.__game = {
    get elapsed() { return G ? G.t : 0; },
    begin() { window.OVERSHOT.begin(); },
    inputProbe: { events: [{ type: 'keydown', init: { key: 'p', bubbles: true } }], read() { return ui.keys || 0; }, settleMs: 120 },
  };
})();
