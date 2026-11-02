/* OVERSHOT - the rules. A water mill on a river whose flow shifts with the seasons. One wheel turns one line shaft; every machine on the shaft
 * has its own gearbox and a speed band; every machine in gear slows the whole shaft. Nothing in this file touches the page: it runs the same
 * in a browser and under Node, and everything the screens draw is read back from the state it owns.
 *
 * The model, in one paragraph (the Help screen says the same in plain words):
 *   inflow R (season x weather) fills the mill pond; the sluice lets up to sluice x intake through the wheel per day; spill goes over the weir.
 *   wheel flow f gives power P = 10 f x head x gearing, and a free shaft speed S0 = 12 f rpm.
 *   each machine in gear loads the shaft by K_i = k_i r_i / mid_i (less when it runs empty), and the shaft settles at S = S0 / (1 + S0 K / (3P)).
 *   a machine turns at r_i S. Inside its band it works at rpm/mid; under the band it falls away fast; over the band it wears, and at full wear it breaks.
 */
(function (root) {
  'use strict';
  const VERSION = '0.1.0';
  const TICK = 0.25;              // real seconds per step at 1x
  const DAY_SECS = 2;             // real seconds per day at 1x
  const DT = TICK / DAY_SECS;     // days per step
  const SEASON_DAYS = 30;
  const DROOP = 3;
  const SEASONS = [
    { id: 'autumn', name: 'Autumn', quarter: 'Christmas', inflow: 1.2 },
    { id: 'winter', name: 'Winter', quarter: 'Lady Day', inflow: 0.85 },
    { id: 'spring', name: 'Spring', quarter: 'Midsummer', inflow: 2.4 },
    { id: 'summer', name: 'Summer', quarter: 'Michaelmas', inflow: 0.62 },
  ];
  /* what the carts bring each day, by season [autumn, winter, spring, summer] */
  const STOCKS = {
    grain: { name: 'grain', unit: 'sacks', supply: [8, 2.5, 1.5, 3] },
    logs: { name: 'logs', unit: 'logs', supply: [1.5, 4.5, 2, 0.6] },
    wool: { name: 'loom cloth', unit: 'bolts', supply: [2, 1.4, 1, 4.6] },
    bloom: { name: 'iron bloom', unit: 'blooms', supply: [2, 2, 2, 2] },
    rags: { name: 'rags', unit: 'bales', supply: [4.2, 4.2, 4.2, 4.2] },
  };
  /* the machines. lo..hi is the band in rpm (strokes or blows a minute for the saw, stocks and hammer); k is the power it takes at the band's middle */
  const MACHINES = {
    stones: { name: 'Millstones', short: 'STONES', stock: 'grain', good: 'flour', goodUnit: 'sacks', lo: 100, hi: 140, k: 5, rate: 6, price: 3, cost: 300, unlock: 0, verb: 'grinds grain to flour' },
    saw: { name: 'Saw frame', short: 'SAW', stock: 'logs', good: 'planks', goodUnit: 'planks', lo: 60, hi: 90, k: 7, rate: 4, price: 5, cost: 400, unlock: 1, verb: 'saws logs into planks' },
    stocks: { name: 'Fulling stocks', short: 'STOCKS', stock: 'wool', good: 'cloth', goodUnit: 'bolts', lo: 30, hi: 45, k: 4, rate: 3, price: 7, cost: 500, unlock: 2, verb: 'pounds loom cloth into felted broadcloth' },
    hammer: { name: 'Trip hammer', short: 'HAMMER', stock: 'bloom', good: 'iron', goodUnit: 'bars', lo: 80, hi: 110, k: 9, rate: 2, price: 14, cost: 900, unlock: 3, verb: 'hammers bloom into bar iron' },
    beater: { name: 'Paper beater', short: 'BEATER', stock: 'rags', good: 'paper', goodUnit: 'reams', lo: 160, hi: 220, k: 8, rate: 5, price: 5, cost: 1200, unlock: 4, verb: 'beats rags to paper pulp' },
  };
  const ORDER = ['stones', 'saw', 'stocks', 'hammer', 'beater'];
  const GEAR_STEP = 1.45;
  const WHEELS = {
    under: { name: 'Undershot wheel', short: 'UNDERSHOT', head: 1.0, intake: 1.2 },
    breast: { name: 'Breastshot wheel', short: 'BREASTSHOT', head: 1.5, intake: 1.5 },
    over: { name: 'Overshot wheel', short: 'OVERSHOT', head: 2.2, intake: 2.0 },
  };
  /* sized to what the river can fill: a spring flood leaves about 1.2 a day over an undershot wheel (review_010 #7 measured the old 120/300/600 never above 33) */
  const PONDS = [15, 45, 90, 150];
  const UPGRADES = [
    { id: 'pond1', name: 'Dig a mill pond', cost: 250, need: null, unlock: 0, says: 'Holds 45 of water behind a dam: a spring flood fills it, and it keeps the wheel at full flow for weeks of summer drought.' },
    { id: 'crown', name: 'Crown gears', cost: 350, need: null, unlock: 0, says: 'Adds a 1st and a 5th gear to every gearbox, for the deepest drought and the worst spate.' },
    { id: 'granary', name: 'Granary and lofts', cost: 300, need: null, unlock: 1, says: 'Every store holds 200 instead of 60, so a glut waits for the stones instead of rotting.' },
    { id: 'breast', name: 'Breastshot wheel', cost: 800, need: null, unlock: 1, says: 'Water strikes the wheel halfway up: half as much power again from the same water.' },
    { id: 'iron', name: 'Iron gearing', cost: 600, need: null, unlock: 2, says: 'Cast iron cogs: more of the wheel reaches the shaft, and racing wears a machine slower.' },
    { id: 'shaft', name: 'Lengthen the shaft', cost: 500, need: null, unlock: 2, says: 'Two more bays on the line shaft. Six machines can share one wheel.' },
    { id: 'pond2', name: 'Raise the dam', cost: 700, need: 'pond1', unlock: 2, says: 'The pond holds 90. Close the sluice a notch in a spate and bank the rest for August.' },
    { id: 'over', name: 'Overshot wheel', cost: 2400, need: 'breast', unlock: 4, says: 'A new leat over the top of a bigger wheel: more than twice the undershot power, and it drinks a deeper river.' },
    { id: 'pond3', name: 'Second pond', cost: 1600, need: 'pond2', unlock: 5, says: 'The pond holds 150: a whole dry summer at full flow, if you fill it.' },
  ];
  const GOVERNOR_COST = 250;
  const FREEHOLD = 6500;
  const RENT_BASE = 90, RENT_RISE = 1.3;
  const EVENTS = {
    spate: { name: 'a spate off the hills', p: [0.05, 0.03, 0.08, 0.02], days: [2, 4], add: 1.0, mul: 1 },
    dry: { name: 'a dry spell', p: [0.02, 0, 0, 0.06], days: [4, 7], add: 0, mul: 0.55 },
    frost: { name: 'a hard frost', p: [0, 0.07, 0.01, 0], days: [2, 4], add: 0, mul: 0.45 },
  };

  /* ---------- seeded randomness, kept in the state so a save resumes exactly ---------- */
  function rnd(G) {
    let t = (G.rng = (G.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /* ---------- a new mill ---------- */
  function machine(type) { return { type, gear: 3, on: true, wear: 0, broken: false, repair: 0, gov: false, govOut: false, made: 0, earned: 0 }; }
  function newGame(seed) {
    const G = {
      v: VERSION, seed: seed >>> 0, rng: (seed >>> 0) || 1, seq: 0,
      t: 0, day: 0, season: 0, year: 1,
      coins: 60, wheel: 'under', pond: 0, level: 6, sluice: 4,
      slots: [machine('stones'), null, null, null], maxSlots: 4,
      owned: {}, stock: { grain: 20, logs: 0, wool: 0, bloom: 0, rags: 0 },
      weather: null, next: null, noise: 0,
      arrears: 0, strikes: 0, rentPaid: 0,
      totals: { flour: 0, planks: 0, cloth: 0, iron: 0, paper: 0, coins: 0, spilled: 0, breaks: 0, shifts: 0 },
      season_log: [], log: [], ended: null, checkpoint: null, evictions: 0, quarters: 0,
      flowHist: [],
    };
    G.slots[0].on = true;
    takeCheckpoint(G);
    say(G, 'Michaelmas, Year 1. The mill is yours on a lease. The rent is ' + money(rent(G)) + ' a quarter.', 'info');
    return G;
  }
  function money(n) { return '£' + Math.round(n).toLocaleString('en-GB'); }
  function say(G, text, kind) { G.seq++; G.log.push({ seq: G.seq, day: dayStamp(G), text, kind: kind || 'info' }); if (G.log.length > 60) G.log.splice(0, G.log.length - 60); }
  function dayStamp(G) { return 'Y' + G.year + ' ' + SEASONS[G.season].name + ' ' + Math.min(SEASON_DAYS, Math.floor(G.day) + 1); }
  function rent(G) { return Math.round(RENT_BASE * Math.pow(RENT_RISE, G.year - 1)); }
  function storeCap(G) { return G.owned.granary ? 200 : 60; }
  function pondCap(G) { return PONDS[G.pond]; }
  function unlockIndex(G) { return (G.year - 1) * 4 + G.season; }
  function gearsAvail(G) { return G.owned.crown ? [1, 2, 3, 4, 5] : [2, 3, 4]; }
  function ratio(type, gear) { const M = MACHINES[type]; const mid = (M.lo + M.hi) / 2; return (mid / 12) * Math.pow(GEAR_STEP, gear - 3); }
  function mid(type) { const M = MACHINES[type]; return (M.lo + M.hi) / 2; }

  /* ---------- the river ---------- */
  function inflow(G) {
    const s = SEASONS[G.season];
    let r = s.inflow * (1 + 0.14 * G.noise);
    if (G.weather) { const E = EVENTS[G.weather.id]; r = r * E.mul + E.add; }
    return Math.max(0.05, r);
  }
  function rollWeather(G) {
    /* tomorrow's weather is decided a day ahead, so the forecast line is a promise the river keeps */
    if (G.weather) { G.weather.left -= 1; if (G.weather.left <= 0) { say(G, 'The ' + EVENTS[G.weather.id].name.replace(/^a /, '') + ' is over.', 'info'); G.weather = null; } }
    if (G.next) { G.weather = G.next; G.next = null; say(G, 'Today: ' + EVENTS[G.weather.id].name + '.', G.weather.id === 'spate' ? 'warn' : 'info'); }
    if (!G.weather && !G.next) {
      for (const id of Object.keys(EVENTS)) {
        const E = EVENTS[id];
        if (rnd(G) < E.p[G.season]) { G.next = { id, left: E.days[0] + Math.floor(rnd(G) * (E.days[1] - E.days[0] + 1)) }; break; }
      }
    }
    G.noise = Math.max(-1, Math.min(1, G.noise * 0.7 + (rnd(G) - 0.5) * 0.9));
  }

  /* ---------- the shaft: the one function every screen and every rule reads ---------- */
  function flowNow(G) {
    /* how much water the wheel takes per day if the sluice is open this far, without moving the pond */
    const W = WHEELS[G.wheel];
    const want = (G.sluice / 4) * W.intake;
    const R = inflow(G);
    return Math.min(want, R + G.level / DT);
  }
  function shaft(G, f) {
    const W = WHEELS[G.wheel];
    if (f === undefined) f = flowNow(G);
    const P = 10 * f * W.head * (G.owned.iron ? 0.95 : 0.85);
    const S0 = 12 * f;
    let K = 0;
    const loads = G.slots.map((m) => {
      if (!m || !m.on || m.broken || m.repair > 0) return 0;
      const M = MACHINES[m.type];
      /* a machine with nothing to work still turns, but takes less from the shaft: 40% empty, full when it worked its whole share last step */
      const w = m.work === undefined ? 1 : m.work;
      const k = M.k * ratio(m.type, m.gear) / mid(m.type) * (0.4 + 0.6 * w);
      K += k;
      return k;
    });
    const S = P > 0.001 ? S0 / (1 + S0 * K / (DROOP * P)) : 0;
    const rpm = G.slots.map((m, i) => (m && loads[i] > 0 ? ratio(m.type, m.gear) * S : 0));
    const load = P > 0.001 ? Math.min(1, 1 - S / Math.max(S0, 0.0001)) : 0;
    return { f, P, S0, S, K, rpm, load };
  }
  function band(type, rpm) {
    const M = MACHINES[type];
    if (rpm <= 0) return 'stopped';
    if (rpm < M.lo) return 'slow';
    if (rpm > M.hi) return 'racing';
    return 'good';
  }
  function eff(type, rpm) {
    const M = MACHINES[type], md = mid(type);
    if (rpm <= 0) return 0;
    if (rpm < M.lo) return Math.pow(rpm / M.lo, 2) * (M.lo / md) * 0.6;
    if (rpm > M.hi) return M.hi / md;
    return rpm / md;
  }

  /* ---------- one step ---------- */
  function step(G) {
    if (G.ended) return;
    const before = Math.floor(G.day);
    governors(G);
    const R = inflow(G);
    /* the pond: inflow in, the wheel's draw out, the rest over the weir */
    G.level += R * DT;
    const W = WHEELS[G.wheel];
    const draw = Math.min((G.sluice / 4) * W.intake * DT, G.level);
    G.level -= draw;
    const cap = pondCap(G);
    if (G.level > cap) { G.totals.spilled += G.level - cap; G.level = cap; }
    const f = draw / DT;
    const sh = shaft(G, f);
    G.last = { f, R, P: sh.P, S: sh.S, S0: sh.S0, load: sh.load, rpm: sh.rpm };
    /* the carts */
    const sc = storeCap(G);
    for (const id of Object.keys(STOCKS)) G.stock[id] = Math.min(sc, G.stock[id] + STOCKS[id].supply[G.season] * DT);
    /* the machines */
    const wearMul = G.owned.iron ? 0.6 : 1;
    G.slots.forEach((m, i) => {
      if (!m) return;
      if (m.repair > 0) {
        m.repair -= DT;
        if (m.repair <= 0) {
          m.repair = 0; m.broken = false; m.wear = 0; m.on = false; m.mended = !m.gov;
          /* a governed machine is handed back to its governor, which puts it in gear when its store holds work; an ungoverned one waits for the player */
          if (m.gov) { m.govOut = true; say(G, MACHINES[m.type].name + ' mended. Its governor will put it back in gear.', 'good'); }
          else say(G, MACHINES[m.type].name + ' mended. Put it back in gear when you are ready.', 'good');
        }
        return;
      }
      if (m.broken || !m.on) return;
      const M = MACHINES[m.type], rpm = sh.rpm[i];
      const st = G.stock[M.stock];
      /* work: the share of what it could do at this speed that the store let it do. A machine short of stock runs partly empty, and running
       * empty wears it (stones grinding on nothing, a hammer on a bare anvil). Racing wears it whatever it is doing. */
      const want = rpm > 0 ? M.rate * eff(m.type, rpm) * DT : 0;
      const n = Math.min(st, want);
      const work = want > 0 ? n / want : 0;
      m.work = work;
      if (rpm > M.hi) m.wear += 0.6 * (rpm / M.hi - 1) * DT * wearMul;
      if (rpm > 0 && work < 0.8) m.wear += 0.1 * (0.8 - work) * DT * wearMul;
      if (n > 0) {
        G.stock[M.stock] -= n;
        m.made += n;
        const c = n * M.price;
        m.earned += c; G.coins += c; G.totals.coins += c;
        G.totals[M.good] += n;
      }
      if (m.wear >= 1) {
        m.wear = 1; m.broken = true; m.on = false; G.totals.breaks++;
        say(G, MACHINES[m.type].name + ' broke' + (rpm > M.hi ? ' racing.' : ' running empty.') + ' Mend it from its row.', 'bad');
      }
    });
    G.t += TICK;
    G.day += DT;
    if (Math.floor(G.day) !== before) {
      G.flowHist.push(Math.round(R * 100) / 100);
      if (G.flowHist.length > 120) G.flowHist.shift();
      rollWeather(G);
    }
    if (G.day >= SEASON_DAYS - 1e-9) endSeason(G);
  }
  function endSeason(G) {
    const s = SEASONS[G.season];
    const due = rent(G) + G.arrears;
    const paid = Math.min(G.coins, due);
    G.coins -= paid;
    G.rentPaid += paid;
    G.arrears = Math.round((due - paid) * 100) / 100;
    G.quarters++;
    if (G.arrears > 0.5) {
      G.strikes++;
      say(G, s.quarter + ': ' + money(paid) + ' of ' + money(due) + ' paid. ' + money(G.arrears) + ' owed to the manor' + (G.strikes >= 2 ? '.' : '. Pay it by next quarter day or the steward ends the lease.'), 'bad');
    } else {
      G.arrears = 0; G.strikes = 0;
      say(G, s.quarter + ': the rent, ' + money(due) + ', is paid.', 'good');
    }
    G.season_log.push({ year: G.year, season: G.season, coins: Math.round(G.coins), paid: Math.round(paid), due: Math.round(due) });
    if (G.season_log.length > 40) G.season_log.shift();
    if (G.strikes >= 2) { G.ended = 'evicted'; G.evictions++; say(G, 'The steward has ended the lease.', 'bad'); return; }
    G.day = 0;
    G.season = (G.season + 1) % 4;
    if (G.season === 0) { G.year++; takeCheckpoint(G); say(G, 'Michaelmas, Year ' + G.year + '. The rent rises to ' + money(rent(G)) + ' a quarter.', 'info'); }
    const nu = unlocksAt(unlockIndex(G));
    if (nu.length) say(G, 'New at the market: ' + nu.join(', ') + '.', 'good');
  }
  function unlocksAt(idx) {
    const out = [];
    for (const id of ORDER) if (MACHINES[id].unlock === idx && idx > 0) out.push(MACHINES[id].name);
    for (const u of UPGRADES) if (u.unlock === idx && idx > 0) out.push(u.name);
    return out;
  }
  function takeCheckpoint(G) {
    const c = JSON.parse(JSON.stringify(G));
    c.checkpoint = null; c.log = [];
    G.checkpoint = c;
  }
  function restoreCheckpoint(G) {
    if (!G.checkpoint) return { ok: false, why: 'There is no Michaelmas to go back to.' };
    const c = JSON.parse(JSON.stringify(G.checkpoint));
    const keep = G.evictions;
    for (const k of Object.keys(G)) delete G[k];
    Object.assign(G, c);
    G.evictions = keep;
    /* the year is given back CLEAN: no strike, no arrears, every machine mended and resting (review_010 #2: a checkpoint taken after a missed
     * Michaelmas carried the strike, and a lone broken millstones with no money for a mend evicted again forever) */
    G.strikes = 0; G.arrears = 0;
    for (const m of G.slots) if (m) { m.broken = false; m.repair = 0; m.wear = Math.min(m.wear, 0.5); }
    G.checkpoint = JSON.parse(JSON.stringify(G));
    G.checkpoint.checkpoint = null; G.checkpoint.log = [];
    G.ended = null;
    say(G, 'Michaelmas, Year ' + G.year + ' again. The steward forgives the arrears and gives you the year back, every machine mended.', 'info');
    return { ok: true };
  }

  /* ---------- governors: a fly-ball on the shaft that shifts for you ---------- */
  function governors(G) {
    let any = false;
    for (const m of G.slots) if (m && m.gov) { any = true; break; }
    if (!any) return;
    const gears = gearsAvail(G);
    for (const m of G.slots) {
      if (!m || !m.gov || m.broken || m.repair > 0) continue;
      const M = MACHINES[m.type];
      /* out when it runs SHORT, the same line the wear rule draws (work < 0.8), so a governed machine never wears running empty (review_010 #9) */
      const starved = m.work !== undefined && m.work < 0.8 && G.stock[M.stock] < 2;
      if (m.on && starved) { m.on = false; m.govOut = true; continue; }
      if (!m.on && m.govOut && G.stock[M.stock] >= 6) { m.on = true; m.govOut = false; m.work = 1; }
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < G.slots.length; i++) {
        const m = G.slots[i];
        if (!m || !m.gov || !m.on || m.broken || m.repair > 0) continue;
        const M = MACHINES[m.type];
        const sh = shaft(G);
        const rpm = sh.rpm[i];
        if (rpm >= M.lo * 1.02 && rpm <= M.hi * 0.97) continue;
        let best = m.gear, bestScore = -1e9;
        const keep = m.gear;
        for (const g of gears) {
          m.gear = g;
          const r = shaft(G).rpm[i];
          const score = r > M.hi * 0.97 ? -1000 - r : r < M.lo ? -500 + r : 100 - Math.abs(r - mid(m.type));
          if (score > bestScore) { bestScore = score; best = g; }
        }
        m.gear = keep;
        if (best !== m.gear) { m.gear = best; G.totals.shifts++; }
      }
    }
  }

  /* ---------- the player's verbs. Each returns { ok, why } and never throws. ---------- */
  function shift(G, i, dir) {
    const m = G.slots[i];
    if (!m) return { ok: false, why: 'That bay is empty.' };
    if (m.broken || m.repair > 0) return { ok: false, why: 'Mend the ' + MACHINES[m.type].name.toLowerCase() + ' first.' };
    const gears = gearsAvail(G);
    const n = m.gear + dir;
    if (n < gears[0]) return { ok: false, why: m.gear === 2 && !G.owned.crown ? 'No lower gear. Crown gears add a 1st.' : 'Already in the lowest gear.' };
    if (n > gears[gears.length - 1]) return { ok: false, why: m.gear === 4 && !G.owned.crown ? 'No higher gear. Crown gears add a 5th.' : 'Already in the highest gear.' };
    m.gear = n; G.totals.shifts++;
    return { ok: true };
  }
  function clutch(G, i) {
    const m = G.slots[i];
    if (!m) return { ok: false, why: 'That bay is empty.' };
    if (m.broken || m.repair > 0) return { ok: false, why: 'Mend the ' + MACHINES[m.type].name.toLowerCase() + ' first.' };
    m.on = !m.on; m.mended = false; m.govOut = false;
    return { ok: true, on: m.on };
  }
  function repairCost(m) { return Math.round(MACHINES[m.type].cost * 0.25); }
  function repair(G, i) {
    const m = G.slots[i];
    if (!m || !m.broken) return { ok: false, why: 'Nothing to mend there.' };
    if (m.repair > 0) return { ok: false, why: 'The millwright is already at it.' };
    const c = repairCost(m);
    if (G.coins < c) return { ok: false, why: 'Mending it costs ' + money(c) + '.' };
    G.coins -= c; m.repair = 2;
    say(G, 'The millwright is mending the ' + MACHINES[m.type].name.toLowerCase() + ': two days, ' + money(c) + '.', 'info');
    return { ok: true };
  }
  function canBuild(G, type) {
    const M = MACHINES[type];
    if (!M) return { ok: false, why: 'No such machine.' };
    if (M.unlock > unlockIndex(G)) return { ok: false, why: M.name + ' comes to market in ' + whenIdx(M.unlock) + '.' };
    if (G.coins < M.cost) return { ok: false, why: M.name + ' costs ' + money(M.cost) + '.' };
    const free = G.slots.findIndex((s) => !s);
    if (free < 0) return { ok: false, why: G.owned.shaft ? 'Every bay on the shaft is full.' : 'Every bay is full. Lengthen the shaft for two more.' };
    return { ok: true, slot: free };
  }
  function build(G, type) {
    const c = canBuild(G, type);
    if (!c.ok) return c;
    G.coins -= MACHINES[type].cost;
    const m = machine(type);
    m.on = false;
    G.slots[c.slot] = m;
    say(G, MACHINES[type].name + ' set up in bay ' + (c.slot + 1) + ', out of gear. Shift it to a gear and put it in.', 'good');
    return { ok: true, slot: c.slot };
  }
  function whenIdx(idx) { const y = Math.floor(idx / 4) + 1, s = idx % 4; return SEASONS[s].name.toLowerCase() + ', year ' + y; }
  function canBuy(G, id) {
    const U = UPGRADES.find((u) => u.id === id);
    if (!U) return { ok: false, why: 'No such work.' };
    if (G.owned[id]) return { ok: false, why: 'Done already.' };
    if (U.need && !G.owned[U.need]) return { ok: false, why: 'First: ' + UPGRADES.find((u) => u.id === U.need).name + '.' };
    if (U.unlock > unlockIndex(G)) return { ok: false, why: U.name + ' can be done from ' + whenIdx(U.unlock) + '.' };
    if (G.coins < U.cost) return { ok: false, why: U.name + ' costs ' + money(U.cost) + '.' };
    return { ok: true };
  }
  function buy(G, id) {
    const c = canBuy(G, id);
    if (!c.ok) return c;
    const U = UPGRADES.find((u) => u.id === id);
    G.coins -= U.cost;
    G.owned[id] = true;
    if (id === 'pond1') G.pond = 1;
    if (id === 'pond2') G.pond = 2;
    if (id === 'pond3') G.pond = 3;
    if (id === 'breast') G.wheel = 'breast';
    if (id === 'over') G.wheel = 'over';
    if (id === 'shaft') { G.maxSlots = 6; while (G.slots.length < 6) G.slots.push(null); }
    if (id === 'crown') { /* nothing to move: the gearbox gains two gears */ }
    say(G, U.name + ': done.', 'good');
    return { ok: true };
  }
  function buyGovernor(G, i) {
    const m = G.slots[i];
    if (!m) return { ok: false, why: 'That bay is empty.' };
    if (m.gov) return { ok: false, why: 'It has a governor.' };
    if (unlockIndex(G) < 3) return { ok: false, why: 'Governors can be had from ' + whenIdx(3) + '.' };
    if (G.coins < GOVERNOR_COST) return { ok: false, why: 'A governor costs ' + money(GOVERNOR_COST) + '.' };
    G.coins -= GOVERNOR_COST; m.gov = true;
    say(G, 'A governor on the ' + MACHINES[m.type].name.toLowerCase() + ': it shifts for itself now, and comes out of gear when its store runs dry.', 'good');
    return { ok: true };
  }
  function setSluice(G, v) {
    const n = Math.max(0, Math.min(4, Math.round(v)));
    if (n === G.sluice) return { ok: false, why: n === 0 ? 'The sluice is shut.' : 'The sluice is fully open.' };
    G.sluice = n;
    return { ok: true };
  }
  function buyFreehold(G) {
    if (G.ended) return { ok: false, why: 'The game is over.' };
    if (G.coins < FREEHOLD) return { ok: false, why: 'The freehold is ' + money(FREEHOLD) + '.' };
    G.coins -= FREEHOLD;
    G.ended = 'freehold';
    say(G, 'The freehold is yours. The mill belongs to the miller.', 'good');
    return { ok: true };
  }

  /* ---------- reading a save ---------- */
  function validSave(o) {
    if (!o || typeof o !== 'object') return false;
    if (typeof o.v !== 'string' || o.v.split('.')[0] !== VERSION.split('.')[0]) return false;
    if (!Array.isArray(o.slots) || o.slots.length < 4 || o.slots.length > 6) return false;
    if (!WHEELS[o.wheel] || !(o.pond >= 0 && o.pond < PONDS.length)) return false;
    for (const m of o.slots) if (m && !MACHINES[m.type]) return false;
    for (const n of ['coins', 'day', 'season', 'year', 'level', 'sluice', 'rng']) if (typeof o[n] !== 'number' || !isFinite(o[n])) return false;
    if (!o.stock || !o.totals || !Array.isArray(o.log)) return false;
    return true;
  }
  function forecast(G) {
    if (G.next) return 'Tomorrow: ' + EVENTS[G.next.id].name + '.';
    if (G.weather) return 'Now: ' + EVENTS[G.weather.id].name + ', ' + G.weather.left + ' day' + (G.weather.left === 1 ? '' : 's') + ' more.';
    return 'Settled. The river runs at its ' + SEASONS[G.season].name.toLowerCase() + ' level.';
  }

  const SIM = {
    VERSION, TICK, DAY_SECS, DT, SEASON_DAYS, SEASONS, STOCKS, MACHINES, ORDER, WHEELS, PONDS, UPGRADES, GOVERNOR_COST, FREEHOLD, EVENTS, GEAR_STEP,
    newGame, step, shaft, band, eff, ratio, mid, inflow, flowNow, rent, storeCap, pondCap, unlockIndex, gearsAvail, unlocksAt, whenIdx,
    shift, clutch, repair, repairCost, build, canBuild, buy, canBuy, buyGovernor, setSluice, buyFreehold, restoreCheckpoint, validSave, forecast, money, dayStamp,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = SIM;
  else root.SIM = SIM;
})(typeof window !== 'undefined' ? window : globalThis);
