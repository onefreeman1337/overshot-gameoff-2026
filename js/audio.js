/* OVERSHOT - sound, made by this file. No samples and no recorded instruments.
 *
 * Every cue and the music loop are PURE functions of a sample rate: render(name, sr) returns a Float32Array, the same bytes every time (seeded noise,
 * no Math.random). The browser turns them into AudioBuffers once; the test suite calls the same functions in Node and MEASURES them (rms, peak, the loop
 * seam), because an agent cannot listen. The synthesis engine is the studio's own (shared with its earlier titles); the cues and the tune are this game's.
 *
 * THE MUSIC: a mill tune. D dorian, 100 bpm, 16 bars: a plucked bass on the beat, a hurdy-gurdy drone on D and A, a tin whistle carrying the air, and the
 * mill's own clapper (the "damsel" that knocks the grain down the shoe) ticking the quavers. Rendered on a circular buffer so the seam is continuous by
 * construction. It ships as audio/overshot_theme.ogg (this file's own render, encoded once); if that file cannot be fetched or decoded, the same loop is
 * rendered here instead. musicSource says which played.
 *
 * THE SHAFT: a live layer, not a file. A low rumble whose pitch and loudness follow the shaft speed, and a thin whine that rises out of it when a machine
 * races past its band. You can hear the mill slow down as you throw machines into gear. setShaft() feeds it every frame.
 *
 * Every browser call is wrapped: a browser that refuses audio never stops the game, and what could not play is COUNTED, so silence is never mistaken for a choice.
 */
'use strict';

(function (root) {
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const TAU = Math.PI * 2;
  function partials(out, sr, t0, f0, ratios, decays, amps, gain, wrap) {
    const start = Math.floor(t0 * sr);
    for (let k = 0; k < ratios.length; k++) {
      const f = f0 * ratios[k], d = decays[k], a = amps[k] * gain;
      const n = Math.floor(d * 7 * sr);
      for (let i = 0; i < n; i++) {
        let p = start + i;
        if (p >= out.length) { if (!wrap) break; p %= out.length; }
        const t = i / sr;
        out[p] += Math.sin(TAU * f * t) * Math.exp(-t / d) * Math.min(1, t * 2000) * a;
      }
    }
  }
  function noiseBurst(out, sr, t0, dur, gain, lp, seed, wrap) {
    const r = rng(seed);
    const start = Math.floor(t0 * sr), n = Math.floor(dur * sr);
    let y = 0;
    for (let i = 0; i < n; i++) {
      let p = start + i;
      if (p >= out.length) { if (!wrap) break; p %= out.length; }
      y += (r() * 2 - 1 - y) * lp;
      out[p] += y * Math.exp(-i / sr / (dur / 4)) * gain;
    }
  }
  function pluck(out, sr, t0, freq, dur, gain, seed, wrap, bright) {
    const r = rng(seed);
    const N = Math.max(2, Math.round(sr / freq));
    const buf = new Float32Array(N);
    for (let i = 0; i < N; i++) buf[i] = r() * 2 - 1;
    const total = Math.floor(dur * sr), start = Math.floor(t0 * sr), damp = bright || 0.996;
    let idx = 0, prev = 0;
    for (let i = 0; i < total; i++) {
      const v = buf[idx];
      buf[idx] = damp * 0.5 * (v + prev); prev = v; idx = (idx + 1) % N;
      let p = start + i;
      if (p >= out.length) { if (!wrap) break; p %= out.length; }
      const attack = Math.min(1, i / (0.002 * sr));
      out[p] += v * gain * (i < total - 400 ? 1 : (total - i) / 400) * attack;
    }
  }
  /* a tin whistle: a sine with a breath of noise, a little vibrato late in the note and a soft attack */
  function whistle(out, sr, t0, freq, dur, gain, seed) {
    const start = Math.floor(t0 * sr), n = Math.floor(dur * sr), r = rng(seed);
    let ph = 0, br = 0;
    for (let i = 0; i < n; i++) {
      const p = (start + i) % out.length;
      const t = i / sr;
      const vib = 1 + 0.007 * Math.sin(TAU * 5.4 * t) * Math.min(1, Math.max(0, t - 0.12) * 4);
      ph += TAU * freq * vib / sr;
      br += (r() * 2 - 1 - br) * 0.3;
      const env = Math.min(1, t / 0.025) * Math.min(1, (dur - t) / 0.05);
      out[p] += (Math.sin(ph) + 0.1 * Math.sin(ph * 2) + br * 0.05) * env * gain;
    }
  }
  function dcBlock(out) {
    let x1 = 0, y1 = 0;
    for (let i = 0; i < out.length; i++) { const x = out[i], y = x - x1 + 0.995 * y1; x1 = x; y1 = y; out[i] = y; }
    return out;
  }
  function softClip(out, drive) { for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * drive) / Math.tanh(drive); return out; }
  function normalise(out, peak) {
    let m = 0;
    for (let i = 0; i < out.length; i++) m = Math.max(m, Math.abs(out[i]));
    if (m > 0) for (let i = 0; i < out.length; i++) out[i] *= peak / m;
    return out;
  }
  function glide(out, sr, t0, f0, f1, dur, gain, vib) {
    const start = Math.floor(t0 * sr), n = Math.min(out.length - start, Math.floor(dur * sr));
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, f = f0 + (f1 - f0) * (t / dur);
      ph += TAU * f * (1 + (vib || 0) * Math.sin(TAU * 6 * t)) / sr;
      const env = Math.min(1, t / 0.02) * Math.min(1, (dur - t) / 0.05);
      out[start + i] += (Math.sin(ph) * 0.7 + Math.sin(ph * 2) * 0.2 + Math.sin(ph * 3) * 0.1) * env * gain;
    }
  }
  /* a wooden knock: a short filtered noise and a hollow body tone */
  function knock(out, sr, t0, f, gain, seed, wrap) {
    noiseBurst(out, sr, t0, 0.03, gain * 0.7, 0.35, seed, wrap);
    partials(out, sr, t0, f, [1, 2.7], [0.025, 0.012], [0.7, 0.25], gain, wrap);
  }

  const CUES = {
    // a gear change: the dog clutch slips across and catches, wood on iron
    shift(sr) {
      const o = new Float32Array(Math.floor(sr * 0.32));
      noiseBurst(o, sr, 0, 0.05, 0.6, 0.5, 5);
      knock(o, sr, 0.06, 190, 0.9, 7);
      partials(o, sr, 0.07, 620, [1, 2.3], [0.03, 0.02], [0.4, 0.2], 0.5);
      return normalise(dcBlock(o), 0.42);
    },
    // a shift down: the same catch a fourth lower
    shiftdown(sr) {
      const o = new Float32Array(Math.floor(sr * 0.32));
      noiseBurst(o, sr, 0, 0.05, 0.6, 0.5, 9);
      knock(o, sr, 0.06, 140, 0.9, 11);
      partials(o, sr, 0.07, 465, [1, 2.3], [0.03, 0.02], [0.4, 0.2], 0.5);
      return normalise(dcBlock(o), 0.42);
    },
    // thrown into gear: a heavy lever and the load taking up
    clutchin(sr) {
      const o = new Float32Array(Math.floor(sr * 0.6));
      knock(o, sr, 0, 120, 1, 13);
      for (let i = 0; i < o.length; i++) { const t = i / sr; o[i] += Math.sin(TAU * (55 + 20 * Math.min(1, t / 0.4)) * t) * Math.exp(-t / 0.22) * Math.min(1, t * 60) * 0.35; }
      return normalise(dcBlock(o), 0.45);
    },
    // out of gear: the lever back and a free-running spin-up
    clutchout(sr) {
      const o = new Float32Array(Math.floor(sr * 0.5));
      knock(o, sr, 0, 160, 0.9, 17);
      glide(o, sr, 0.04, 90, 150, 0.4, 0.2, 0.01);
      return normalise(dcBlock(o), 0.4);
    },
    // the sluice: a windlass ratchet and water changing its voice
    sluice(sr) {
      const o = new Float32Array(Math.floor(sr * 0.7));
      for (let k = 0; k < 4; k++) knock(o, sr, k * 0.07, 700 + k * 40, 0.35, 19 + k);
      noiseBurst(o, sr, 0.25, 0.4, 0.5, 0.08, 23);
      return normalise(dcBlock(o), 0.38);
    },
    // a sale or a purchase: coins on the counter
    coin(sr) {
      const o = new Float32Array(Math.floor(sr * 0.35));
      partials(o, sr, 0, 2950, [1, 1.52, 2.43, 3.3], [0.06, 0.05, 0.03, 0.02], [0.6, 0.4, 0.25, 0.15], 0.8);
      partials(o, sr, 0.08, 3180, [1, 1.52, 2.43], [0.04, 0.03, 0.02], [0.35, 0.25, 0.15], 0.6);
      return normalise(o, 0.45);
    },
    // something built: three mallet blows and a rising fifth on the whistle
    build(sr) {
      const o = new Float32Array(Math.floor(sr * 0.9));
      for (let k = 0; k < 3; k++) knock(o, sr, k * 0.11, 150 + k * 10, 0.9, 29 + k);
      whistle(o, sr, 0.36, 587.33, 0.18, 0.3, 31); whistle(o, sr, 0.52, 880, 0.3, 0.3, 32);
      return normalise(dcBlock(o), 0.5);
    },
    // quarter day: the church bell, once
    bell(sr) {
      const o = new Float32Array(Math.floor(sr * 2.2));
      partials(o, sr, 0, 392, [0.5, 1, 1.19, 1.5, 2, 2.74], [0.9, 0.6, 0.5, 0.35, 0.25, 0.15], [0.4, 0.8, 0.45, 0.3, 0.25, 0.15], 0.7);
      return normalise(o, 0.5);
    },
    // a machine gives way: a crack, a clatter of teeth and a dying spin
    break(sr) {
      const o = new Float32Array(Math.floor(sr * 1.2));
      noiseBurst(o, sr, 0, 0.12, 1, 0.6, 37);
      for (let k = 0; k < 7; k++) knock(o, sr, 0.1 + k * 0.05 + (k % 2) * 0.012, 300 + (k * 53) % 200, 0.5, 41 + k);
      glide(o, sr, 0.3, 160, 40, 0.8, 0.3, 0.02);
      return normalise(softClip(dcBlock(o), 1.6), 0.6);
    },
    // a refusal: a dull knock and a falling note
    refuse(sr) {
      const o = new Float32Array(Math.floor(sr * 0.4));
      noiseBurst(o, sr, 0, 0.1, 0.7, 0.05, 43);
      for (let i = 0; i < o.length; i++) { const t = i / sr; o[i] += Math.sin(TAU * (200 - 100 * t / 0.4) * t) * Math.exp(-t / 0.1) * 0.45; }
      return normalise(o, 0.45);
    },
    // a spate is coming: water rising, a low swell
    spate(sr) {
      const o = new Float32Array(Math.floor(sr * 1.4));
      const r = rng(47); let y = 0;
      for (let i = 0; i < o.length; i++) { const t = i / sr; y += (r() * 2 - 1 - y) * 0.06; o[i] = y * Math.min(1, t / 0.6) * Math.min(1, (1.4 - t) / 0.4) * 2.2; }
      glide(o, sr, 0.1, 70, 95, 1.2, 0.25, 0.01);
      return normalise(dcBlock(o), 0.45);
    },
    // the freehold: the whistle's tune resolved and the bell twice
    freehold(sr) {
      const o = new Float32Array(Math.floor(sr * 2.6));
      [[0, 587.33], [0.2, 659.25], [0.4, 739.99], [0.6, 880], [0.9, 1174.66]].forEach(([t, f], i) => whistle(o, sr, t, f, i === 4 ? 0.9 : 0.22, 0.35, 51 + i));
      partials(o, sr, 1.0, 293.66, [0.5, 1, 1.19, 1.5, 2], [0.8, 0.55, 0.45, 0.3, 0.2], [0.4, 0.8, 0.45, 0.3, 0.2], 0.55);
      return normalise(o, 0.55);
    },
    // the lease ended: the bell, low, and the whistle falling away
    evicted(sr) {
      const o = new Float32Array(Math.floor(sr * 2.2));
      partials(o, sr, 0, 196, [0.5, 1, 1.19, 1.5, 2], [0.9, 0.6, 0.45, 0.3, 0.2], [0.4, 0.8, 0.45, 0.3, 0.2], 0.6);
      [[0.5, 587.33], [0.8, 523.25], [1.1, 440]].forEach(([t, f], i) => whistle(o, sr, t, f, i === 2 ? 0.8 : 0.28, 0.25, 61 + i));
      return normalise(o, 0.5);
    },
    // a button: a small wooden tick
    tick(sr) {
      const o = new Float32Array(Math.floor(sr * 0.08));
      knock(o, sr, 0, 900, 0.6, 67);
      return normalise(dcBlock(o), 0.3);
    },
  };

  /* THE MUSIC: D dorian, 100 bpm, 16 bars (64 beats). Composed, not random. */
  const BPM = 100, BEATS = 64;
  const SEMI = { C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4, 'F#': -3, G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2 };
  const hz = (n) => { const m = n.match(/^([A-G]#?)(\d)$/); return 440 * Math.pow(2, (SEMI[m[1]] + (+m[2] - 4) * 12) / 12); };
  const BASS = ['D2', 'D2', 'C2', 'D2', 'D2', 'G2', 'C2', 'A2', 'D2', 'D2', 'C2', 'G2', 'D2', 'A2', 'C2', 'D2'];
  /* the air: [beat, note, beats]. Two eight-bar strains, the second higher, both home on D. */
  const LEAD = [
    [0, 'A4', 1], [1, 'D5', 1], [2, 'D5', 0.5], [2.5, 'E5', 0.5], [3, 'F5', 1], [4, 'E5', 1], [5, 'D5', 1], [6, 'C5', 1], [7, 'A4', 1],
    [8, 'G4', 1], [9, 'C5', 1], [10, 'C5', 0.5], [10.5, 'D5', 0.5], [11, 'E5', 1], [12, 'D5', 2], [14, 'C5', 1], [15, 'A4', 1],
    [16, 'A4', 1], [17, 'D5', 1], [18, 'D5', 0.5], [18.5, 'E5', 0.5], [19, 'F5', 1], [20, 'G5', 1], [21, 'F5', 1], [22, 'E5', 1], [23, 'C5', 1],
    [24, 'D5', 1], [25, 'E5', 0.5], [25.5, 'D5', 0.5], [26, 'C5', 1], [27, 'A4', 1], [28, 'D5', 3], [31, 'E5', 1],
    [32, 'F5', 1], [33, 'A5', 1], [34, 'A5', 0.5], [34.5, 'G5', 0.5], [35, 'F5', 1], [36, 'G5', 1], [37, 'E5', 1], [38, 'C5', 1], [39, 'E5', 1],
    [40, 'F5', 1], [41, 'D5', 1], [42, 'D5', 0.5], [42.5, 'C5', 0.5], [43, 'A4', 1], [44, 'C5', 2], [46, 'E5', 1], [47, 'G5', 1],
    [48, 'A5', 1], [49, 'G5', 0.5], [49.5, 'F5', 0.5], [50, 'E5', 1], [51, 'D5', 1], [52, 'C5', 1], [53, 'D5', 1], [54, 'E5', 1], [55, 'C5', 1],
    [56, 'D5', 1], [57, 'A4', 1], [58, 'C5', 1], [59, 'E5', 1], [60, 'D5', 3], [63, 'A4', 1],
  ];
  function music(sr) {
    const spb = 60 / BPM, len = Math.round(BEATS * spb * sr), o = new Float32Array(len);
    let seed = 700;
    /* the drone: D3 and A3 on a buzzing reed, swelling a little with each bar so it breathes; continuous round the circle */
    for (let i = 0; i < len; i++) {
      const t = i / sr, beat = t / spb, sw = 0.8 + 0.2 * Math.sin(TAU * beat / 4);
      const a = TAU * hz('D3') * t, b = TAU * hz('A3') * t;
      o[i] += (Math.sin(a) + 0.3 * Math.sin(2 * a) + 0.12 * Math.sin(3 * a) + 0.6 * Math.sin(b) + 0.2 * Math.sin(2 * b)) * 0.045 * sw;
    }
    /* the bass plucks a low string on 1 and 3 of each bar, through a low-pass round the circle twice */
    const low = new Float32Array(len);
    BASS.forEach((n, bar) => { pluck(low, sr, bar * 4 * spb, hz(n), spb * 1.9, 0.9, seed++, true, 0.9985); pluck(low, sr, (bar * 4 + 2) * spb, hz(n) * 1.5, spb * 1.9, 0.6, seed++, true, 0.9985); });
    const lpA = 1 - Math.exp(-TAU * 600 / sr);
    for (let pass = 0, y = 0; pass < 2; pass++) for (let i = 0; i < len; i++) { y += (low[i] - y) * lpA; if (pass) o[i] += y * 0.8; }
    /* the clapper: quavers, accents on the beat */
    for (let q = 0; q < BEATS * 2; q++) knock(o, sr, q * spb / 2, q % 2 ? 980 : 760, q % 2 ? 0.05 : 0.09, seed++, true);
    for (const [b, n, l] of LEAD) whistle(o, sr, b * spb, hz(n), l * spb * 0.94, 0.16, seed++);
    return normalise(softClip(dcBlock(o), 1.2), 0.5);
  }

  function render(name, sr) {
    if (name === 'music') return music(sr);
    const f = CUES[name];
    if (!f) throw new Error('audio: no cue "' + name + '"');
    return f(sr);
  }

  const MUSIC_FILE = 'audio/overshot_theme.ogg';
  const A = {
    CUES: Object.keys(CUES), render, BPM, BEATS, MUSIC_FILE,
    ready: false, muted: false, failed: [], played: {}, _ctx: null, _buf: {}, _src: null, _gain: null, _want: false,
    musicFile: 'idle', musicFileWhy: null, musicSource: null, _fileBuf: null, _hum: null, shaftState: null,
    init() {
      if (A._ctx || !root.addEventListener) return A;
      try {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) { if (A.failed.indexOf('no-webaudio') < 0) A.failed.push('no-webaudio'); return A; }
        A._ctx = new AC();
        A._gain = A._ctx.createGain(); A._gain.gain.value = 0.9; A._gain.connect(A._ctx.destination);
        A._musicGain = A._ctx.createGain(); A._musicGain.gain.value = 0.28; A._musicGain.connect(A._gain);
      } catch (e) { A.failed.push('context'); return A; }
      A.ready = true;
      /* resume() returns a promise a browser may REJECT (autoplay refused): catch it and count it, never let it escape as an unhandled rejection */
      const kick = () => {
        try { if (A._ctx.state === 'suspended') { const p = A._ctx.resume(); if (p && typeof p.catch === 'function') p.catch(() => { A.refusedResume = (A.refusedResume || 0) + 1; }); } } catch (e) { A.refusedResume = (A.refusedResume || 0) + 1; }
        if (A._want && !A.muted) A.music(true); A._startHum();
      };
      root.addEventListener('pointerdown', kick, { capture: true });
      root.addEventListener('keydown', kick, { capture: true });
      root.addEventListener('pointerup', kick, { capture: true });
      root.addEventListener('touchend', kick, { capture: true });
      A._loadMusicFile();
      return A;
    },
    _loadMusicFile() {
      if (A.musicFile !== 'idle') return;
      A.musicFile = 'loading';
      const fail = (why) => { A.musicFile = 'failed'; A.musicFileWhy = String(why); if (A._want && !A.muted && !A._src) A.music(true); };
      try {
        if (typeof root.fetch !== 'function') { fail('no fetch'); return; }
        root.fetch(MUSIC_FILE).then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.arrayBuffer(); })
          .then((data) => new Promise((ok, bad) => { const p = A._ctx.decodeAudioData(data, ok, (e) => bad(e || new Error('decode'))); if (p && typeof p.catch === 'function') p.catch(bad); }))
          .then((buf) => { if (!buf || !buf.length) throw new Error('empty decode'); A._fileBuf = buf; A.musicFile = 'ok'; if (A._want && !A.muted && !A._src) A.music(true); })
          .catch((e) => fail(e && e.message ? e.message : e));
      } catch (e) { fail(e && e.message ? e.message : e); }
    },
    _buffer(name) {
      if (A._buf[name]) return A._buf[name];
      const sr = A._ctx.sampleRate, data = render(name, sr), b = A._ctx.createBuffer(1, data.length, sr);
      b.copyToChannel ? b.copyToChannel(data, 0) : b.getChannelData(0).set(data);
      return (A._buf[name] = b);
    },
    play(name) {
      if (!A.ready || A.muted) return false;
      try { const s = A._ctx.createBufferSource(); s.buffer = A._buffer(name); s.connect(A._gain); s.start(); A.played[name] = (A.played[name] || 0) + 1; return true; }
      catch (e) { if (A.failed.indexOf(name) < 0) A.failed.push(name); return false; }
    },
    music(on) {
      A._want = !!on;
      if (!A.ready || A.muted || !on) { if (!on) A._stopMusic(); return false; }
      if (A._src) return true;
      if (A.musicFile === 'loading' && !A._slow) {
        if (!A._slowTimer) A._slowTimer = setTimeout(() => { A._slowTimer = null; if (A.musicFile !== 'loading') return; A._slow = true; A.musicFileWhy = 'still loading after 8 s'; if (A._want && !A.muted && !A._src) A.music(true); }, 8000);
        return false;
      }
      try {
        if (A._ctx.state === 'suspended') return false;
        const s = A._ctx.createBufferSource(), fromFile = A.musicFile === 'ok' && !!A._fileBuf;
        s.buffer = fromFile ? A._fileBuf : A._buffer('music'); s.loop = true; s.connect(A._musicGain); s.start();
        A._src = s; A.musicSource = fromFile ? 'file' : 'render'; A.played.music = (A.played.music || 0) + 1;
        return true;
      } catch (e) { if (A.failed.indexOf('music') < 0) A.failed.push('music'); return false; }
    },
    _stopMusic() { try { if (A._src) A._src.stop(); } catch (e) { /* ignore */ } A._src = null; },
    /* the shaft layer: a looped brown-noise rumble through a low-pass, plus a sawtooth whine kept silent until something races */
    _startHum() {
      if (A._hum || !A.ready || A.muted) return;
      try {
        if (A._ctx.state === 'suspended') return;
        const ctx = A._ctx, sr = ctx.sampleRate, n = sr * 2, b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), r = rng(71);
        let y = 0;
        for (let i = 0; i < n; i++) { y = y * 0.985 + (r() * 2 - 1) * 0.05; d[i] = y; }
        /* make the loop seam continuous: crossfade the last 0.1 s into the first */
        const xf = Math.floor(sr * 0.1);
        for (let i = 0; i < xf; i++) { const k = i / xf; d[n - xf + i] = d[n - xf + i] * (1 - k) + d[i] * k; }
        const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 120;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(lp); lp.connect(g); g.connect(A._gain); src.start();
        const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 300;
        const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 4;
        const wg = ctx.createGain(); wg.gain.value = 0;
        osc.connect(wf); wf.connect(wg); wg.connect(A._gain); osc.start();
        A._hum = { src, lp, g, osc, wg };
        A.played.hum = (A.played.hum || 0) + 1;
      } catch (e) { if (A.failed.indexOf('hum') < 0) A.failed.push('hum'); }
    },
    _stopHum() { if (!A._hum) return; try { A._hum.src.stop(); A._hum.osc.stop(); } catch (e) { /* ignore */ } A._hum = null; },
    setShaft(rpm, racing, playing) {
      A.shaftState = { rpm, racing, playing };
      if (!A._hum) { if (playing) A._startHum(); return; }
      try {
        const t = A._ctx.currentTime, H = A._hum;
        const on = playing && !A.muted ? 1 : 0;
        H.lp.frequency.setTargetAtTime(60 + Math.min(40, rpm) * 6, t, 0.2);
        H.g.gain.setTargetAtTime(on * Math.min(0.55, 0.12 + rpm * 0.02), t, 0.25);
        H.osc.frequency.setTargetAtTime(220 + racing * 2.2, t, 0.1);
        H.wg.gain.setTargetAtTime(on * (racing > 0 ? Math.min(0.05, 0.015 + racing * 0.0006) : 0), t, 0.08);
      } catch (e) { if (A.failed.indexOf('hum-set') < 0) A.failed.push('hum-set'); }
    },
    setMuted(v) { A.muted = !!v; if (A.muted) { A._stopMusic(); A._stopHum(); } else if (A._want) A.music(true); },
    report() {
      const b = A._src && A._src.buffer;
      return { ready: A.ready, cues: A.CUES.length, failed: A.failed.slice(), played: Object.assign({}, A.played), musicPlaying: !!A._src, humOn: !!A._hum, refusedResume: A.refusedResume || 0,
        contextState: A._ctx ? A._ctx.state : null, musicSource: A.musicSource, musicFile: A.musicFile, musicFileWhy: A.musicFileWhy,
        musicFrames: b ? b.length : null, sampleRate: A._ctx ? A._ctx.sampleRate : null };
    },
  };
  root.AUDIO = A;
  if (typeof module !== 'undefined' && module.exports) module.exports = A;
})(typeof window !== 'undefined' ? window : this);
