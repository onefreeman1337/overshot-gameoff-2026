/* OVERSHOT - drawing. The mill is painted at NATIVE pixel scale (240x150) from the art plates and the game's own gear and machine drawers, then blown
 * up with nearest-neighbour; every word and every dial is drawn afterwards at full size so type stays crisp. Every gear turns at a speed read from the
 * shaft the rules computed: shift a machine up and its pinion visibly shrinks; throw it out of gear and its pinion drops clear of the train.
 * Nothing here changes the simulation.
 */
(function (root) {
  'use strict';
  const SIM = root.SIM;
  const NW = 240, NH = 150;
  /* THREE SHAPES. A surface is laid out once per shape, never scaled from another. Sizes are chosen against the smallest window that picks the shape.
   *   wide  960x600  a desktop or the itch embed. Mill at 3x, panel on the right.
   *   short 720x400  a phone held sideways (smallest 640x320 = 0.8). Mill at 2x, panel on the right.
   *   tall  480xH    an upright phone, H follows the window from 800 to 1040 (smallest 360x560 = 0.7). Mill at 2x, panel underneath. */
  const SHAPES = {
    wide: { name: 'wide', W: 960, H: 600, scene: { x: 0, y: 40, s: 3 }, top: { x: 0, y: 0, w: 960, h: 40 }, panel: { x: 720, y: 40, w: 240, h: 560 }, foot: { x: 0, y: 490, w: 720, h: 110 }, ts: 13, tsS: 12, lh: 17, tap: 29, head: 16 },
    short: { name: 'short', W: 720, H: 400, scene: { x: 0, y: 36, s: 2 }, top: { x: 0, y: 0, w: 720, h: 36 }, panel: { x: 480, y: 36, w: 240, h: 364 }, foot: { x: 0, y: 336, w: 480, h: 64 }, ts: 14, tsS: 13, lh: 17, tap: 31, head: 16 },
    tall: { name: 'tall', W: 480, H: 800, scene: { x: 0, y: 66, s: 2 }, top: { x: 0, y: 0, w: 480, h: 66 }, foot: { x: 0, y: 366, w: 480, h: 46 }, panel: { x: 0, y: 412, w: 480, h: 332 }, bottom: { x: 0, y: 744, w: 480, h: 56 }, ts: 17, tsS: 15, lh: 21, tap: 36, head: 20 },
  };
  let S = SHAPES.wide, cv, ctx, bk = 1, cssScale = 1;
  const MIN_CSS = 9.5;
  function setShape(name, tallH) {
    const base = SHAPES[name] || SHAPES.wide;
    S = Object.assign({}, base);
    if (S.name === 'tall') {
      S.H = Math.max(800, Math.min(1040, Math.round(tallH || 800)));
      S.bottom = { x: 0, y: S.H - 56, w: 480, h: 56 };
      S.panel = { x: 0, y: 412, w: 480, h: S.H - 56 - 412 };
    }
    return S;
  }
  function setCssScale(s) { cssScale = s > 0 ? s : 1; }
  const PAL = {
    ink: '#f3e9d2', dim: '#c2b59a', faint: '#8e8571', dark: '#141110', panel: '#1f1a16', panel2: '#2e2620', edge: '#5a4a3a', gold: '#e8b84a', good: '#9bd37a', bad: '#ff7a55', warn: '#f0a040', water: '#6cc0d0', slow: '#8fa8c8', paper: '#efe2c4', paperInk: '#2b2017', paperDim: '#6d5d48', brass: '#c99a4b', iron: '#7d8288',
  };
  /* ---------- the text door. Every word goes through here, so the layout gate can see all of them. A floor in CSS px is applied here, once. ---------- */
  const REC = { on: false, text: [], buttons: [], panels: [] };
  function size(o) { const s = o.s || S.ts; return Math.max(s, Math.ceil(MIN_CSS / cssScale * 2) / 2); }
  function font(o) { return (o.w || 500) + ' ' + size(o) + 'px ' + (o.f === 'head' ? "'Overshot Head', 'Rockwell', Georgia, serif" : "'Overshot Sans', 'Rockwell', Georgia, serif"); }
  function width(str, o) { ctx.font = font(o || {}); return ctx.measureText(String(str)).width; }
  function text(str, x, y, o) {
    o = o || {};
    str = String(str);
    ctx.font = font(o);
    ctx.textAlign = o.a || 'left';
    ctx.textBaseline = 'alphabetic';
    if (o.shadow) { const d = o.shadowD || 1; ctx.fillStyle = o.shadow; ctx.fillText(str, x + d, y + d); }
    ctx.fillStyle = o.c || PAL.ink;
    ctx.fillText(str, x, y);
    const w = ctx.measureText(str).width;
    if (REC.on) {
      const s = size(o);
      const m = ctx.getTransform();
      const left = o.a === 'center' ? x - w / 2 : o.a === 'right' ? x - w : x;
      REC.text.push({ str, x: left + m.e / bk, y: y - s * 0.8 + m.f / bk, w, h: s, s, btn: !!o.btn });
    }
    return w;
  }
  function wrap(str, maxW, o) {
    ctx.font = font(o || {});
    const out = [];
    for (const para of String(str).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const t = line ? line + ' ' + word : word;
        if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word; } else line = t;
      }
      out.push(line);
    }
    return out;
  }
  function para(str, x, y, maxW, o, lh) {
    const lines = wrap(str, maxW, o);
    const step = Math.max(lh || S.lh, size(o || {}) + 3);
    for (let i = 0; i < lines.length; i++) text(lines[i], x, y + i * step, o);
    return lines.length * step;
  }
  function paraHeight(str, maxW, o, lh) { return wrap(str, maxW, o).length * Math.max(lh || S.lh, size(o || {}) + 3); }
  function fit(str, maxW, o) {
    str = String(str);
    if (width(str, o) <= maxW) return str;
    const words = str.split(' ');
    while (words.length > 1) { words.pop(); const s = words.join(' ').replace(/[,:;]$/, ''); if (width(s, o) <= maxW) return s; }
    let s = words[0];
    while (s.length > 1 && width(s, o) > maxW) s = s.slice(0, -1);
    return s;
  }
  /* ---------- boxes and buttons. The tap floor belongs here, at the one door, never at a call site. ---------- */
  let hits = [];
  function box(x, y, w, h, fill, edge) {
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    if (edge) { ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
    if (REC.on) REC.panels.push({ x, y, w, h });
  }
  function button(id, label, x, y, w, h, o) {
    o = o || {};
    h = Math.max(h, S.tap);
    const lit = o.on, off = o.off, gold = o.gold, warn = o.warn;
    const fill = o.fill || (gold ? PAL.gold : warn ? '#6a3020' : lit ? '#3d4a2a' : off ? '#211c18' : PAL.panel2);
    ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = gold ? '#fff0b8' : off ? '#2a241f' : warn ? '#a85038' : '#6e5a44'; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y, 1, h);
    ctx.fillStyle = gold ? '#8a6418' : '#0c0a08'; ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x + w - 1, y, 1, h);
    /* rivets: a millwright's plate, not a web button */
    if (w >= 40 && h >= 24) { ctx.fillStyle = gold ? '#a07a28' : off ? '#3a3129' : '#8a7356'; ctx.fillRect(x + 3, y + 3, 2, 2); ctx.fillRect(x + w - 5, y + 3, 2, 2); ctx.fillRect(x + 3, y + h - 5, 2, 2); ctx.fillRect(x + w - 5, y + h - 5, 2, 2); }
    const c = o.c || (gold ? '#1f160a' : off ? PAL.faint : lit ? PAL.gold : PAL.ink);
    const sz = o.s || S.ts;
    if (label) {
      const f = { s: sz, w: o.w || 700, f: o.f, c, btn: true, a: 'center' };
      text(fit(label, w - 10, f), x + w / 2, y + h / 2 + size(f) * 0.36, f);
    }
    hits.push({ id, x, y, w, h, off: !!off, data: o.data });
    if (REC.on) REC.buttons.push({ id, label, x, y, w, h, off: !!off });
    return h;
  }
  function zone(id, x, y, w, h, data) { hits.push({ id, x, y, w, h, data }); if (REC.on) REC.buttons.push({ id, label: '', x, y, w, h, zone: true }); }
  /* an opaque sheet laid over the screen: everything drawn before it inside its rectangle is hidden, and every control drawn before it is DEAD
   * (the hit list is cleared here, at the one door, so a tap beside a menu can never reach the mill underneath it) */
  function cover(x, y, w, h) { hits = []; if (REC.on) { REC.covers = REC.covers || []; REC.covers.push({ x, y, w, h, at: REC.text.length, atB: REC.buttons.length }); } }
  function resetHits() { hits = []; }
  function hitAt(x, y) { for (let i = hits.length - 1; i >= 0; i--) { const b = hits[i]; if (x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h) return b; } return null; }
  function allHits() { return hits.slice(); }

  /* ---------- the plates ---------- */
  const ART = { names: ['ashlar', 'boards', 'water', 'meadow', 'slate'], data: {}, ready: false, failed: [], loaded: [] };
  function loadArt() {
    for (const name of ART.names) {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const g = c.getContext('2d'); g.drawImage(img, 0, 0);
          ART.data[name] = { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data };
          ART.loaded.push(name);
          if (ART.loaded.length === ART.names.length) ART.ready = true;
        } catch (e) { ART.failed.push(name); }
      };
      img.onerror = () => { ART.failed.push(name); };
      img.src = 'art/' + name + '.png';
    }
  }
  const FALLBACK = { ashlar: [122, 114, 103], boards: [112, 71, 45], water: [24, 78, 96], meadow: [81, 108, 57], slate: [55, 61, 69] };
  function plate(name, x, y, ox, oy) {
    const p = ART.data[name];
    if (!p) return FALLBACK[name];
    const X = (((x + (ox | 0)) % p.w) + p.w) % p.w, Y = (((y + (oy | 0)) % p.h) + p.h) % p.h;
    const o = (Y * p.w + X) * 4;
    return [p.d[o], p.d[o + 1], p.d[o + 2]];
  }

  /* ---------- the native buffer ---------- */
  let nb = null, nctx = null, img = null, pix = null;
  function ensureNative() {
    if (nb) return;
    nb = document.createElement('canvas'); nb.width = NW; nb.height = NH;
    nctx = nb.getContext('2d');
    img = nctx.createImageData(NW, NH); pix = img.data;
  }
  function put(x, y, c, a) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= NW || y >= NH) return;
    const o = (y * NW + x) * 4;
    if (a === undefined || a >= 1) { pix[o] = c[0]; pix[o + 1] = c[1]; pix[o + 2] = c[2]; pix[o + 3] = 255; return; }
    pix[o] = pix[o] + (c[0] - pix[o]) * a; pix[o + 1] = pix[o + 1] + (c[1] - pix[o + 1]) * a; pix[o + 2] = pix[o + 2] + (c[2] - pix[o + 2]) * a; pix[o + 3] = 255;
  }
  function get(x, y) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= NW || y >= NH) return [0, 0, 0]; const o = (y * NW + x) * 4; return [pix[o], pix[o + 1], pix[o + 2]]; }
  function rect(x, y, w, h, c, a) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c, a); }
  function line(x0, y0, x1, y1, c, a) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) put(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c, a);
  }
  function disc(cx, cy, r, c, a) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) put(cx + x, cy + y, c, a); }
  function grade(c, k, tint) { const t = tint || [0, 0, 0], m = tint ? 0.25 : 0; return [Math.min(255, c[0] * k * (1 - m) + t[0] * m), Math.min(255, c[1] * k * (1 - m) + t[1] * m), Math.min(255, c[2] * k * (1 - m) + t[2] * m)]; }
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const IRON = [[44, 47, 52], [72, 77, 84], [104, 110, 118], [146, 152, 158]];
  const BRASS = [[92, 62, 26], [150, 108, 46], [201, 154, 75], [236, 200, 120]];
  const WOOD = [[46, 29, 18], [90, 56, 35], [135, 90, 57], [170, 120, 78]];

  /* a gear face-on: a disc, a darker ring, teeth on the rim at the live angle, spokes on the big ones */
  function gear(cx, cy, r, teeth, ang, ramp, opt) {
    opt = opt || {};
    const R = ramp;
    disc(cx, cy, r - 1, R[1]);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const d = Math.sqrt(x * x + y * y); if (d <= r - 1 && d > r - 2.2) put(cx + x, cy + y, (x + y < 0) ? R[3] : R[2]); }
    for (let k = 0; k < teeth; k++) {
      const a = ang + k * Math.PI * 2 / teeth;
      if (opt.broken && k % 3 === 0) continue;
      const c = Math.cos(a), s = Math.sin(a);
      put(cx + c * r, cy + s * r, R[2]); put(cx + c * (r + 1), cy + s * (r + 1), R[3]);
      if (r >= 6) put(cx + c * (r + 1) - s * 0.8, cy + s * (r + 1) + c * 0.8, R[2]);
    }
    if (r >= 6) for (let k = 0; k < 4; k++) { const a = ang + k * Math.PI / 2; line(cx, cy, cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2), R[0]); }
    else { const a = ang; put(cx + Math.cos(a) * (r - 1.5), cy + Math.sin(a) * (r - 1.5), R[0]); }
    put(cx, cy, R[0]); if (r >= 4) { put(cx + 1, cy, R[0]); put(cx, cy + 1, R[3]); }
  }

  /* ---------- the scene ---------- */
  const L = { POND_X1: 46, POND_TOP: 56, POND_BOT: 92, DAM_X0: 46, DAM_X1: 52, DAM_TOP: 46, DAM_BOT: 100, WX: 66, WY: 112, WR: 17, WALL0: 86, WALL1: 92, FLOOR: 132, TRAIN_Y: 60, BODY: 86, BAY0: 104, BAYW: 22, RIGHT: 236 };
  function bayX(i) { return L.BAY0 + i * L.BAYW + 11; }
  const SEASON_SKY = {
    autumn: [[142, 160, 176], [205, 176, 140]], winter: [[120, 134, 152], [188, 196, 206]], spring: [[118, 166, 206], [196, 222, 232]], summer: [[96, 158, 214], [226, 222, 188]],
  };
  const SEASON_GROUND = { autumn: [1.0, [196, 132, 52]], winter: [0.95, [220, 228, 236]], spring: [1.08, [96, 168, 72]], summer: [1.05, [190, 176, 80]] };
  const ang = { wheel: 0, train: 0, bays: [0, 0, 0, 0, 0, 0], phase: [0, 0, 0, 0, 0, 0], water: 0, t: 0 };
  let lastT = null;
  function advance(G, sh, now, running) {
    const dt = lastT === null ? 0 : Math.min(0.1, Math.max(0, (now - lastT) / 1000));
    lastT = now;
    if (!running) return;
    const vis = (rpm) => (rpm <= 0 ? 0 : Math.min(1.3, 0.22 * Math.sqrt(rpm / 12))) * Math.PI * 2;
    ang.wheel += vis(sh.S0 > 0 ? sh.S * 0.9 : 0) * dt * 0.6;
    ang.train += vis(sh.S) * dt;
    for (let i = 0; i < 6; i++) {
      const r = sh.rpm[i] || 0;
      ang.bays[i] += vis(r) * dt;
      ang.phase[i] += (r / 60) * Math.PI * 2 * dt * 0.35;
    }
    ang.water += dt * (0.4 + sh.f * 0.8);
    ang.t += dt;
  }
  function h2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 1442695040) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  function paintScene(G, sh, opts) {
    ensureNative();
    const season = SIM.SEASONS[G.season].id;
    const sky = SEASON_SKY[season], gr = SEASON_GROUND[season];
    const wx = G.weather ? G.weather.id : null;
    const dim = wx === 'spate' ? 0.82 : wx === 'frost' ? 0.92 : 1;
    /* sky and hills */
    for (let y = 0; y < 48; y++) { const k = y / 48; const c = [sky[0][0] + (sky[1][0] - sky[0][0]) * k, sky[0][1] + (sky[1][1] - sky[0][1]) * k, sky[0][2] + (sky[1][2] - sky[0][2]) * k]; for (let x = 0; x < NW; x++) put(x, y, grade(c, dim)); }
    if (season === 'summer' && wx !== 'spate') disc(30, 14, 5, [250, 236, 180]);
    for (let x = 0; x < NW; x++) {
      const hy = 30 + Math.round(5 * Math.sin(x * 0.045 + 1.3) + 3 * Math.sin(x * 0.11));
      for (let y = hy; y < 48; y++) { const g = plate('meadow', x, y, 7, 3); put(x, y, grade(grade(g, 0.7 * dim * gr[0], gr[1]), 1.0, sky[1])); }
      if (season === 'winter') put(x, hy, [226, 232, 240]);
      /* a hedge line and a few trees on the far hill, the season's colour */
      const tr = h2(x, 1, 9);
      if (tr < 0.06) { const th = 3 + Math.floor(h2(x, 2, 9) * 3); const tc = season === 'autumn' ? [176, 98, 40] : season === 'winter' ? [70, 62, 56] : season === 'spring' ? [120, 170, 90] : [70, 112, 52]; for (let j = 0; j < th; j++) { put(x, hy - j - 1, grade(tc, dim)); put(x + 1, hy - j - 1, grade(tc, 0.8 * dim)); } }
    }
    /* the bank, the pond, the dam */
    for (let y = 46; y < NH; y++) for (let x = 0; x < L.WALL0; x++) { const g = plate('meadow', x, y); put(x, y, grade(g, gr[0] * dim, gr[1])); }
    const cap = SIM.pondCap(G), lv = Math.max(0, Math.min(1, G.level / cap));
    const surf = Math.round(L.POND_BOT - 4 - (L.POND_BOT - L.POND_TOP - 4) * lv);
    for (let y = L.POND_TOP; y < L.POND_BOT + 4; y++) for (let x = 0; x < L.POND_X1; x++) {
      if (y < surf) { const mud = plate('meadow', x, y, 13, 5); const k = (y - L.POND_TOP) / Math.max(1, surf - L.POND_TOP); put(x, y, grade(mud, 0.62 - 0.12 * k, [104, 78, 52])); if (y === surf - 1) put(x, y, [70, 56, 40]); continue; }
      const w = plate('water', x, y, Math.floor(-ang.water * 6), 0);
      put(x, y, grade(w, (y === surf ? 1.35 : 1) * dim));
    }
    if (G.pond === 0) for (let x = 0; x < L.POND_X1; x++) put(x, L.POND_TOP + 1, [96, 80, 60]);
    if (season === 'winter' || wx === 'frost') for (let x = 0; x < L.POND_X1; x++) if (h2(x, 3, 5) < (wx === 'frost' ? 0.7 : 0.25)) put(x, surf, [214, 226, 234]);
    /* the river coming in at the top left */
    for (let y = 50; y < 58; y++) for (let x = 0; x < 14 - (y - 50); x++) { const w = plate('water', x, y, Math.floor(-ang.water * 9), 0); put(x, y, grade(w, 1.1 * dim)); }
    for (let y = L.DAM_TOP; y < L.DAM_BOT; y++) for (let x = L.DAM_X0; x < L.DAM_X1; x++) put(x, y, grade(plate('ashlar', x, y), x === L.DAM_X0 ? 0.8 : 1));
    if (season === 'winter') for (let x = L.DAM_X0; x < L.DAM_X1; x++) put(x, L.DAM_TOP, [230, 236, 242]);
    /* the sluice gate, raised by quarters */
    const open = G.sluice / 4;
    const gateTop = 74 - Math.round(open * 14), gateBot = 96 - Math.round(open * 14);
    for (let y = gateTop; y < gateBot; y++) for (let x = L.DAM_X1; x < L.DAM_X1 + 3; x++) put(x, y, grade(plate('boards', x, y * 2), 1.15));
    line(L.DAM_X1 + 1, 66, L.DAM_X1 + 1, gateTop, IRON[2]);
    rect(L.DAM_X1 - 1, 64, 5, 2, IRON[1]);
    /* the wheel pit: a stone-lined hole the wheel turns in, between the dam and the mill wall */
    for (let y = 90; y < 132; y++) for (let x = L.DAM_X1; x < L.WALL0; x++) { const g = plate('ashlar', x, y, 9, 4); put(x, y, grade(g, y < 93 ? 0.85 : 0.5, [36, 30, 26])); }
    /* the tailrace under everything */
    for (let y = 130; y < NH; y++) for (let x = 0; x < L.WALL0 + 6; x++) { const w = plate('water', x, y, Math.floor(ang.water * 11), 0); put(x, y, grade(w, (y === 130 ? 1.3 : 0.92) * dim)); }
    /* the leat: from the gate to the wheel, by wheel type */
    const flowing = sh.f > 0.02;
    const leatW = (x, y) => { const w = plate('water', x, y, Math.floor(-ang.water * 14), 0); put(x, y, grade(w, flowing ? 1.25 : 0.6)); };
    if (G.wheel === 'under') { for (let x = L.DAM_X1; x < L.WX + 4; x++) { const y0 = 96 + Math.round((x - L.DAM_X1) * 0.6); for (let y = y0; y < Math.min(130, y0 + 4); y++) leatW(x, y); } }
    else if (G.wheel === 'breast') { for (let x = L.DAM_X1; x < L.WX - 12; x++) for (let y = 98; y < 104; y++) leatW(x, y); for (let y = 98; y < 130; y++) for (let x = L.WX - 16; x < L.WX - 13; x++) if (flowing) leatW(x, y); }
    else { for (let x = L.DAM_X1; x < L.WX + 6; x++) { put(x, 90, WOOD[1]); put(x, 89, WOOD[2]); for (let y = 86; y < 89; y++) leatW(x, y); } if (flowing) for (let y = 89; y < 112; y++) for (let x = L.WX + 5; x < L.WX + 8; x++) leatW(x, y); }
    /* the weir, white water when the pond spills */
    const spilling = G.level >= cap - 0.01 && (sh.R || 0) > sh.f;
    if (spilling) for (let y = L.DAM_TOP - 2; y < 130; y++) for (let x = L.DAM_X1 + 3; x < L.DAM_X1 + 6; x++) if (h2(x, y + Math.floor(ang.t * 30), 3) < 0.7) put(x, y, [214, 236, 240]);
    /* the wheel: rim, spokes, paddles or buckets, all turning together */
    const R = L.WR;
    for (let k = 0; k < 8; k++) { const a = ang.wheel + k * Math.PI / 4; line(L.WX, L.WY, L.WX + Math.cos(a) * (R - 2), L.WY + Math.sin(a) * (R - 2), WOOD[1]); }
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) { const d = Math.sqrt(x * x + y * y); if (d <= R && d > R - 2.4) put(L.WX + x, L.WY + y, d > R - 1 ? WOOD[1] : WOOD[2]); if (d <= 4.5 && d > 3.4) put(L.WX + x, L.WY + y, WOOD[1]); }
    const nb2 = G.wheel === 'over' ? 16 : 12;
    for (let k = 0; k < nb2; k++) {
      const a = ang.wheel + k * Math.PI * 2 / nb2, c = Math.cos(a), s = Math.sin(a);
      for (let j = 0; j < 4; j++) put(L.WX + c * (R + j - 1), L.WY + s * (R + j - 1), j === 3 ? WOOD[3] : WOOD[2]);
      if (G.wheel !== 'under') put(L.WX + c * (R + 2) - s, L.WY + s * (R + 2) + c, WOOD[2]);
    }
    /* splash where the water meets the wheel */
    if (flowing) {
      const sx = G.wheel === 'under' ? L.WX : G.wheel === 'breast' ? L.WX - 15 : L.WX + 7;
      const sy = G.wheel === 'under' ? 128 : G.wheel === 'breast' ? 112 : 100;
      for (let k = 0; k < 10; k++) { const a = h2(k, Math.floor(ang.t * 12), 1) * Math.PI * 2, r = h2(k, Math.floor(ang.t * 12), 2) * 4 * Math.min(2, sh.f); put(sx + Math.cos(a) * r, sy + Math.sin(a) * r * 0.6, [220, 240, 244]); }
    }
    gear(L.WX, L.WY, 4, 8, ang.wheel, IRON);
    /* the mill: walls, roof, beam, floor */
    for (let y = 30; y < NH; y++) for (let x = L.WALL0; x < NW; x++) {
      const inside = x >= L.WALL1 && x < L.RIGHT && y >= 36 && y < L.FLOOR;
      const g = plate('ashlar', x, y, 5, 2);
      put(x, y, inside ? grade(g, 0.46, [40, 30, 22]) : grade(g, 1.0 * dim));
    }
    for (let y = 2; y < 34; y++) { const half = Math.round((y - 2) * 2.9); const cx = 163; for (let x = cx - half; x <= cx + half; x++) { if (x < L.WALL0 - 6 || x >= NW) continue; const g = plate('slate', x, y); put(x, y, grade(g, (x - cx) < 0 ? 1.05 * dim : 0.85 * dim)); } }
    for (let x = 75; x < NW; x++) put(x, 33, WOOD[0]);
    if (season === 'winter') for (let y = 2; y < 34; y++) { const half = Math.round((y - 2) * 2.9); for (const x of [163 - half, 163 + half]) { put(x, y, [232, 238, 244]); put(x, y + 1, [210, 220, 230]); } }
    for (let y = 36; y < 40; y++) for (let x = L.WALL1; x < L.RIGHT; x++) put(x, y, grade(plate('boards', x, y * 3), y === 36 ? 1.2 : 0.8));
    for (let y = L.FLOOR; y < L.FLOOR + 5; y++) for (let x = L.WALL1; x < L.RIGHT; x++) put(x, y, grade(plate('boards', x, y * 2), y === L.FLOOR ? 1.25 : 0.95));
    /* the belt from the wheel's hub pulley up through the wall to the drive gear */
    const DX = L.BAY0, DY = L.TRAIN_Y;
    const belt = (x0, y0, x1, y1, off) => { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); for (let i = 0; i <= n; i++) { const on = ((i + Math.floor(ang.train * 3) * off) % 4 + 4) % 4 < 2; put(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), on ? [70, 52, 36] : [110, 84, 58]); } };
    belt(L.WX - 3, L.WY - 3, DX - 4, DY - 3, 1); belt(L.WX + 3, L.WY + 3, DX + 3, DY + 4, -1);
    rect(L.WALL0, 70, L.WALL1 - L.WALL0, 26, [30, 24, 20]);
    gear(DX, DY, 5, 10, ang.train, BRASS);
    /* the train along the beam: one gear per bay, an idler between each pair, alternating direction */
    const nBays = G.slots.length;
    for (let i = 0; i < nBays; i++) {
      const cx = bayX(i);
      gear(cx, DY, 6, 12, (i % 2 ? -1 : 1) * ang.train * 0.83 + 0.2, BRASS);
      if (i < nBays - 1) gear(cx + 11, DY, 5, 10, (i % 2 ? 1 : -1) * ang.train + 0.3, IRON);
    }
    if (nBays < 6) {
      /* the bays the shaft does not reach yet, walled off */
      const x0 = bayX(nBays) - 11;
      for (let y = 40; y < L.FLOOR; y++) for (let x = x0; x < L.RIGHT; x++) put(x, y, grade(plate('ashlar', x, y, 3, 1), 0.7));
      line(x0, 40, x0, L.FLOOR - 1, [30, 24, 20]);
    }
    /* the bays */
    for (let i = 0; i < nBays; i++) paintBay(G, sh, i, opts);
    /* weather over the outside: rain in a spate, snow in winter, leaves in autumn */
    if (wx === 'spate') for (let k = 0; k < 90; k++) { const x = Math.floor(h2(k, 7, 1) * L.WALL0 + ang.t * 40 * (0.5 + h2(k, 8, 1))) % L.WALL0, y = Math.floor(h2(k, 9, 1) * 130 + ang.t * 160) % 130; put(x, y, [190, 210, 226], 0.7); put(x - 1, y - 2, [190, 210, 226], 0.4); }
    if (season === 'winter') for (let k = 0; k < 50; k++) { const x = Math.floor(h2(k, 11, 2) * 86 + Math.sin(ang.t + k) * 3), y = Math.floor(h2(k, 12, 2) * 130 + ang.t * 12 * (0.6 + h2(k, 13, 2))) % 130; put(x, y, [240, 244, 250], 0.85); }
    if (season === 'autumn') for (let k = 0; k < 14; k++) { const x = Math.floor((h2(k, 21, 3) * 86 + ang.t * 10) % 86), y = Math.floor((h2(k, 22, 3) * 90 + 30 + ang.t * 8 * (0.5 + h2(k, 23, 3))) % 100) + 30; put(x, y, k % 2 ? [200, 110, 40] : [170, 70, 30]); }
    if (season === 'spring') for (let k = 0; k < 40; k++) { const x = Math.floor(h2(k, 31, 4) * 86), y = 48 + Math.floor(h2(k, 32, 4) * 80); if (y < L.POND_TOP || x > L.DAM_X1 + 3) put(x, y, k % 3 ? [246, 222, 236] : [255, 248, 210]); }
    nctx.putImageData(img, 0, 0);
  }
  function paintBay(G, sh, i, opts) {
    const m = G.slots[i];
    const cx = bayX(i), x0 = cx - 11, ty = L.TRAIN_Y;
    const sel = opts && opts.sel === i;
    if (!m) {
      for (let y = 66; y < L.FLOOR; y += 3) { put(x0 + 2, y, [90, 74, 60]); put(x0 + 19, y, [90, 74, 60]); }
      for (let x = x0 + 2; x < x0 + 20; x += 3) { put(x, 66, [90, 74, 60]); put(x, L.FLOOR - 1, [90, 74, 60]); }
      if (sel) bracket(x0, 42, 22, L.FLOOR - 42);
      return;
    }
    const M = SIM.MACHINES[m.type];
    const rpm = sh.rpm[i] || 0;
    const engaged = m.on && !m.broken && m.repair <= 0;
    const rM = Math.max(3, Math.min(10, Math.round(6 * Math.pow(1.3, 3 - m.gear))));
    const gy = ty + 6 + rM + (engaged ? 0 : 3);
    const ramp = m.broken ? [[50, 40, 36], [80, 66, 60], [110, 92, 84], [130, 112, 100]] : IRON;
    gear(cx, gy, rM, Math.max(6, rM * 2), engaged ? ang.bays[i] * (i % 2 ? 1 : -1) : 0, ramp, { broken: m.broken });
    line(cx, gy + rM + 1, cx, L.BODY, [52, 40, 30]);
    const ph = ang.phase[i];
    const run = engaged && rpm > 0;
    const band = SIM.band(m.type, rpm);
    const shake = run && band === 'racing' ? (Math.floor(ang.t * 40) % 2 ? 1 : -1) : 0;
    const X = cx + shake;
    if (m.type === 'stones') {
      for (let y = 86; y < 94; y++) { const half = 9 - Math.floor((y - 86) / 2); for (let x = -half; x <= half; x++) put(X + x, y, grade(plate('boards', X + x, y * 3), y === 86 ? 1.2 : 0.95)); }
      for (let x = -7; x <= 7; x++) put(X + x, 87, [196, 170, 92]);
      rect(X - 10, 94, 21, 15, WOOD[1]);
      disc(X, 101, 7, [150, 144, 134]);
      for (let k = 0; k < 6; k++) { const a = ang.bays[i] * 1.6 + k * Math.PI / 3; line(X + Math.cos(a) * 2, 101 + Math.sin(a) * 2, X + Math.cos(a) * 6, 101 + Math.sin(a) * 6, [104, 98, 90]); }
      put(X, 101, [70, 64, 58]);
      rect(X - 1, 109, 3, 6, WOOD[2]);
      const fill = (m.made % 8) / 8;
      const sh2 = 7 + Math.round(fill * 9);
      for (let y = 0; y < sh2; y++) for (let x = -5; x <= 5; x++) if (Math.abs(x) < 5 - (y < 2 ? 2 - y : 0) + 1) put(X + x, L.FLOOR - 1 - y, y === sh2 - 1 ? [236, 228, 206] : (x < 0 ? [222, 210, 182] : [196, 182, 152]));
      if (run && Math.floor(ang.t * 8) % 3 === 0) put(X + 1, 114, [240, 236, 222]);
    } else if (m.type === 'saw') {
      rect(X - 10, 86, 2, 46, WOOD[1]); rect(X + 8, 86, 2, 46, WOOD[1]);
      const sy = 94 + Math.round(5 * Math.sin(ph));
      rect(X - 8, sy, 16, 2, WOOD[2]); rect(X - 8, sy + 12, 16, 2, WOOD[2]);
      line(X, sy + 1, X, sy + 13, [200, 206, 212]);
      for (let k = 0; k < 6; k++) put(X - 1, sy + 2 + k * 2, [150, 156, 162]);
      const lx = Math.round(((m.made * 3) % 8)) - 4;
      rect(X - 9 + lx, 110, 18, 6, WOOD[2]); rect(X - 9 + lx, 110, 18, 1, WOOD[3]);
      disc(X - 9 + lx, 113, 3, [184, 142, 96]); put(X - 9 + lx, 113, WOOD[1]);
      rect(X - 9, 118, 18, 2, WOOD[0]);
      const pile = Math.min(6, Math.floor(m.made / 3) % 7);
      for (let k = 0; k < pile; k++) rect(X - 8, L.FLOOR - 2 - k * 2, 16, 2, k % 2 ? [196, 156, 104] : [178, 136, 88]);
      if (run) for (let k = 0; k < 3; k++) put(X - 1 + Math.floor(h2(k, Math.floor(ang.t * 20), 5) * 3), 116 + Math.floor(h2(k, Math.floor(ang.t * 20), 6) * 3), [214, 184, 130]);
    } else if (m.type === 'stocks') {
      rect(X - 10, 86, 20, 3, WOOD[1]);
      for (let k = 0; k < 2; k++) {
        const lift = Math.max(0, Math.sin(ph + k * Math.PI)) * 9;
        const hx = X - 7 + k * 8, hy = 100 - Math.round(lift);
        line(hx + 2, 89, hx + 2, hy, WOOD[0]);
        rect(hx - 1, hy, 7, 9, WOOD[2]); rect(hx - 1, hy, 7, 1, WOOD[3]); rect(hx - 1, hy + 8, 7, 1, WOOD[0]);
      }
      rect(X - 10, 112, 20, 12, WOOD[1]); rect(X - 9, 112, 18, 3, [70, 104, 150]); rect(X - 9, 113, 6, 2, [150, 54, 48]);
      rect(X - 10, 124, 2, 8, WOOD[0]); rect(X + 8, 124, 2, 8, WOOD[0]);
    } else if (m.type === 'hammer') {
      const lift = Math.max(0, Math.sin(ph)) ;
      const hy = 104 - Math.round(lift * 8);
      rect(X + 6, 96, 3, 36, WOOD[1]);
      line(X + 7, 100, X - 6, hy, WOOD[2]); line(X + 7, 101, X - 6, hy + 1, WOOD[1]);
      rect(X - 9, hy - 1, 6, 6, IRON[1]); rect(X - 9, hy - 1, 6, 1, IRON[3]);
      rect(X - 10, 114, 9, 4, IRON[2]); rect(X - 8, 118, 5, 14, IRON[1]); rect(X - 10, 113, 9, 1, [255, 150, 60]);
      if (run && lift < 0.12) for (let k = 0; k < 6; k++) put(X - 6 + Math.round((h2(k, Math.floor(ang.t * 30), 7) - 0.5) * 10), 110 - Math.floor(h2(k, Math.floor(ang.t * 30), 8) * 6), k % 2 ? [255, 200, 90] : [255, 130, 50]);
    } else if (m.type === 'beater') {
      for (let y = 104; y < 128; y++) { const half = 10 - (y < 107 ? 107 - y : y > 124 ? y - 124 : 0); for (let x = -half; x <= half; x++) put(X + x, y, Math.abs(x) >= half - 1 || y >= 126 ? WOOD[1] : [220, 224, 216]); }
      for (let y = 107; y < 124; y++) for (let x = -8; x <= 8; x++) if (h2(x, y + Math.floor(ang.bays[i] * 4), 9) < 0.18) put(X + x, y, [180, 196, 204]);
      disc(X, 108, 5, IRON[1]);
      for (let k = 0; k < 8; k++) { const a = ang.bays[i] * 1.2 + k * Math.PI / 4; put(X + Math.cos(a) * 5, 108 + Math.sin(a) * 5, IRON[3]); }
      put(X, 108, IRON[0]);
      rect(X - 9, 128, 18, 4, WOOD[0]);
    }
    if (m.broken || m.repair > 0) {
      for (let k = 0; k < 8; k++) { const t = (ang.t * 0.6 + k / 8) % 1; put(cx - 3 + Math.round(Math.sin(k * 2.3 + ang.t) * 3), 98 - Math.round(t * 30), [120, 112, 104], 0.7 * (1 - t)); }
    } else if (run && band === 'racing') {
      for (let k = 0; k < 5; k++) { const t = (ang.t * 1.4 + k / 5) % 1; put(cx + Math.round(Math.sin(k * 1.7 + ang.t * 3) * 4), 92 - Math.round(t * 18), [200, 196, 188], 0.6 * (1 - t)); }
    }
    if (sel) bracket(x0, 42, 22, L.FLOOR - 42);
  }
  function bracket(x, y, w, h) {
    const c = [240, 200, 90];
    for (let k = 0; k < 4; k++) { put(x + k, y, c); put(x, y + k, c); put(x + w - 1 - k, y, c); put(x + w - 1, y + k, c); put(x + k, y + h - 1, c); put(x, y + h - 1 - k, c); put(x + w - 1 - k, y + h - 1, c); put(x + w - 1, y + h - 1 - k, c); }
  }
  /* the blit and the full-size overlays: a dial on every bay, the gear it is in */
  function drawScene(G, sh, now, opts) {
    opts = opts || {};
    advance(G, sh, now, opts.running !== false);
    paintScene(G, sh, opts);
    const sc = S.scene;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(nb, sc.x, sc.y, NW * sc.s, NH * sc.s);
    if (REC.on) REC.panels.push({ x: sc.x, y: sc.y, w: NW * sc.s, h: NH * sc.s, picture: true });
    if (opts.dials === false) return;
    for (let i = 0; i < G.slots.length; i++) if (G.slots[i]) dial(G, sh, i);
  }
  function bayRect(i) { const sc = S.scene; return { x: sc.x + (bayX(i) - 11) * sc.s, y: sc.y + 40 * sc.s, w: L.BAYW * sc.s, h: (L.FLOOR - 40) * sc.s }; }
  function sceneRect() { const sc = S.scene; return { x: sc.x, y: sc.y, w: NW * sc.s, h: NH * sc.s }; }
  function dial(G, sh, i) {
    const m = G.slots[i], M = SIM.MACHINES[m.type], sc = S.scene;
    const cx = sc.x + bayX(i) * sc.s, cy = sc.y + 50 * sc.s;
    const r = Math.floor(L.BAYW * sc.s * 0.42);
    const max = M.hi * 1.6;
    const toA = (v) => Math.PI + Math.PI * Math.max(0, Math.min(1, v / max));
    ctx.save();
    ctx.fillStyle = 'rgba(20,16,13,0.88)';
    ctx.beginPath(); ctx.arc(cx, cy, r + 3, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.lineWidth = Math.max(3, Math.round(r * 0.2));
    const arc = (a, b, c) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(cx, cy, r - ctx.lineWidth / 2, a, b); ctx.stroke(); };
    arc(toA(0), toA(M.lo), '#4a5a72');
    arc(toA(M.lo), toA(M.hi), '#5f8f3e');
    arc(toA(M.hi), toA(max), '#8e3826');
    const rpm = sh.rpm[i] || 0;
    const a = toA(rpm);
    ctx.strokeStyle = m.on && !m.broken ? '#f3e9d2' : '#8e8571'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2)); ctx.stroke();
    ctx.fillStyle = PAL.brass; ctx.fillRect(cx - 2, cy - 2, 4, 4);
    ctx.restore();
    const band = m.broken ? 'broken' : !m.on ? 'out' : SIM.band(m.type, rpm);
    const col = band === 'good' ? PAL.good : band === 'racing' ? PAL.bad : band === 'slow' ? PAL.slow : PAL.faint;
    const lab = m.broken ? 'X' : m.repair > 0 ? '...' : !m.on ? 'OUT' : String(Math.round(rpm));
    const lw = width(lab, { s: S.tsS, w: 700 }) + 8, ls = size({ s: S.tsS });
    ctx.fillStyle = 'rgba(20,16,13,0.9)'; ctx.fillRect(Math.round(cx - lw / 2), Math.round(cy + 3), Math.round(lw), Math.round(ls + 4));
    text(lab, cx, cy + ls + 3, { s: S.tsS, w: 700, a: 'center', c: col });
    text('G' + m.gear, cx, cy - r - 4, { s: S.tsS, w: 700, a: 'center', c: PAL.gold, shadow: '#000' });
  }

  function init(canvas) { cv = canvas; ctx = cv.getContext('2d', { alpha: false }); loadArt(); }
  function setBackstore(b) { bk = b; ctx.setTransform(bk, 0, 0, bk, 0, 0); ctx.imageSmoothingEnabled = false; }
  function context() { return ctx; }
  function shape() { return S; }
  function snapshotNative() { return nb ? nb.toDataURL('image/png') : null; }
  const API = { init, setShape, setBackstore, setCssScale, SHAPES, PAL, REC, text, wrap, para, paraHeight, fit, width, size, box, button, zone, cover, resetHits, hitAt, allHits, drawScene, bayRect, sceneRect, ART, NW, NH, L, context, shape, snapshotNative, ang,
    get S() { return S; }, get ctx() { return ctx; }, get bk() { return bk; }, get cssScale() { return cssScale; } };
  root.RENDER = API;
})(typeof window !== 'undefined' ? window : globalThis);
