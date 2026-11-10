/* Motion Engine v1 — reference implementation of the preset contract.
 * Pure functions: evaluate(scene, tMs) -> per-element property snapshot.
 * Same math is ported 1:1 to Kotlin (kmp/…/MotionEngine.kt); parity is tested.
 */
(function (root) {
  'use strict';

  // ---------- Easing ----------
  function cubicBezier(x1, y1, x2, y2) {
    // Newton-Raphson + bisection fallback (same as WebKit UnitBezier)
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = t => ((ax * t + bx) * t + cx) * t;
    const sy = t => ((ay * t + by) * t + cy) * t;
    const dx = t => (3 * ax * t + 2 * bx) * t + cx;
    return function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(t) - x; if (Math.abs(e) < 1e-6) return sy(t);
        const d = dx(t); if (Math.abs(d) < 1e-6) break; t -= e / d;
      }
      let lo = 0, hi = 1; t = x;
      for (let i = 0; i < 30; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-6) break; if (x > v) lo = t; else hi = t; t = (lo + hi) / 2; }
      return sy(t);
    };
  }
  const pow = n => ({ in: t => Math.pow(t, n), out: t => 1 - Math.pow(1 - t, n), inOut: t => t < .5 ? Math.pow(2 * t, n) / 2 : 1 - Math.pow(2 - 2 * t, n) / 2 });
  function backOut(s = 1.70158) { return t => { t -= 1; return t * t * ((s + 1) * t + s) + 1; }; }
  function elasticOut(a = 1, p = 0.3) {
    return t => { if (t === 0 || t === 1) return t; const A = Math.max(1, a); const s = p / (2 * Math.PI) * Math.asin(1 / A); return A * Math.pow(2, -10 * t) * Math.sin((t - s) * (2 * Math.PI) / p) + 1; };
  }
  function bounceOut(t) {
    const n = 7.5625, d = 2.75;
    if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75;
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375;
  }
  // Analytic damped spring, mass=1, x: 1 -> 0 displacement; returns progress 0..1(+overshoot)
  // Matches Compose spring(dampingRatio, stiffness). Duration is derived (settle at 0.1% ).
  function springFn(dampingRatio, stiffness) {
    const w0 = Math.sqrt(stiffness), z = dampingRatio;
    const pos = tSec => {
      if (z < 1) { const wd = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * tSec) * (Math.cos(wd * tSec) + (z * w0 / wd) * Math.sin(wd * tSec)); }
      if (z === 1) return 1 - Math.exp(-w0 * tSec) * (1 + w0 * tSec);
      const r1 = -w0 * (z - Math.sqrt(z * z - 1)), r2 = -w0 * (z + Math.sqrt(z * z - 1));
      const c2 = r1 / (r1 - r2), c1 = 1 - c2; return 1 - (c1 * Math.exp(r1 * tSec) + c2 * Math.exp(r2 * tSec));
    };
    // settle time
    let settle = 0.01; for (let t = 0.01; t < 10; t += 0.005) { let ok = true; for (let k = 0; k < 40; k++) { if (Math.abs(1 - pos(t + k * 0.005)) > 0.001) { ok = false; break; } } if (ok) { settle = t; break; } }
    const f = x => x >= 1 ? 1 : pos(x * settle);
    f.settleMs = Math.round(settle * 1000);
    return f;
  }

  const EASINGS = {
    linear: t => t,
    // CSS / design-tool standards (cubic-bezier)
    ease: cubicBezier(.25, .1, .25, 1),
    sineInOut: cubicBezier(.37, 0, .63, 1),
    cubicOut: pow(3).out, cubicIn: pow(3).in, cubicInOut: pow(3).inOut,
    quartOut: pow(4).out, quartInOut: pow(4).inOut,
    quintOut: pow(5).out,
    expoOut: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
    expoInOut: t => t === 0 || t === 1 ? t : t < .5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
    circOut: t => Math.sqrt(1 - Math.pow(t - 1, 2)),
    backOut: backOut(1.70158), backOutSoft: backOut(1.1), backOutStrong: backOut(2.4),
    elasticOut: elasticOut(1, .35), bounceOut,
    // Material 3 tokens
    emphasizedDecelerate: cubicBezier(.05, .7, .1, 1),
    emphasizedAccelerate: cubicBezier(.3, 0, .8, .15),
    standard: cubicBezier(.2, 0, 0, 1),
    // Luxury: long, very soft landing
    silk: cubicBezier(.22, .61, .36, 1),
    // springs (Compose-compatible params)
    springGentle: springFn(1.0, 120), springSoft: springFn(.75, 200), springBouncy: springFn(.5, 300), springSnappy: springFn(.85, 600),
  };
  function getEase(e) {
    if (typeof e === 'function') return e;
    if (!e) return EASINGS.cubicOut;
    if (EASINGS[e]) return EASINGS[e];
    let m = /^cubicBezier\(([^)]+)\)$/.exec(e); if (m) { const p = m[1].split(',').map(Number); return cubicBezier(...p); }
    m = /^steps\((\d+)\)$/.exec(e); if (m) { const n = +m[1]; return t => Math.min(1, Math.floor(t * n) / (n - 1 || 1)); }
    m = /^spring\(([^)]+)\)$/.exec(e); if (m) { const p = m[1].split(',').map(Number); return springFn(p[0], p[1]); }
    throw new Error('Unknown ease ' + e);
  }

  // ---------- Properties ----------
  const DEFAULTS = { opacity: 1, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, blur: 0, clipT: 0, clipR: 0, clipB: 0, clipL: 0, draw: 1, shimmer: -1, brightness: 1, rgbSplit: 0 };
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- Presets ----------
  // A preset: {id, phase, duration, ease, from:{}, to:{}, keyframes?:[{t,props,ease}], loop?:{period, fn}, split?, stagger?}
  function resolveParams(preset, overrides) {
    const p = {}; const defs = preset.params || {};
    for (const k in defs) p[k] = defs[k].default;
    // track overrides: declared params AND generic ones (duration, ease, period, amplitude)
    if (overrides) for (const k in overrides) p[k] = overrides[k];
    return p;
  }
  function substitute(obj, params) {
    // values can be "$distance" or "-$distance" or "$distance*0.5"
    const out = {};
    for (const k in obj) {
      const v = obj[k];
      if (typeof v === 'string' && v.includes('$')) {
        out[k] = Function(...Object.keys(params), 'return ' + v.replace(/\$(\w+)/g, '$1'))(...Object.values(params));
      } else out[k] = v;
    }
    return out;
  }

  // Evaluate one preset at local time (ms since its own start). Returns partial props.
  function evalPreset(preset, tLocal, params, dir) {
    const from = substitute(preset.from || {}, params), to = substitute(preset.to || {}, params);
    const dur = params.duration ?? preset.duration;
    if (preset.loop) {
      // loop presets: periodic function of time -> seamless by construction
      const T = params.period ?? preset.loop.period; const ph = ((tLocal % T) + T) % T / T; // 0..1
      const amp = params.amplitude ?? preset.loop.amplitude ?? 1;
      const w = preset.loop.wave || 'sine';
      const s = w === 'sine' ? Math.sin(2 * Math.PI * ph) : w === 'saw' ? ph : w === 'tri' ? 1 - Math.abs(2 * ph - 1) : w === 'pulse' ? (0.5 - 0.5 * Math.cos(2 * Math.PI * ph)) : 0;
      const out = {};
      for (const k in preset.loop.props) { const [base, delta] = preset.loop.props[k]; out[k] = base + delta * amp * s; }
      // fade the loop in over its first period/4 so it doesn't "jump" when it starts (only when it starts after an entrance)
      return out;
    }
    let t = Math.max(0, Math.min(1, tLocal / dur));
    const ease = getEase(params.ease || preset.ease);
    if (preset.keyframes) {
      const kf = preset.keyframes; let a = kf[0], b = kf[kf.length - 1];
      for (let i = 0; i < kf.length - 1; i++) if (t >= kf[i].t && t <= kf[i + 1].t) { a = kf[i]; b = kf[i + 1]; break; }
      const lt = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t); const e = getEase(b.ease || preset.ease)(lt);
      const out = {}; const keys = new Set([...Object.keys(a.props), ...Object.keys(b.props)]);
      for (const k of keys) { const av = substitute(a.props, params)[k] ?? DEFAULTS[k], bv = substitute(b.props, params)[k] ?? DEFAULTS[k]; out[k] = lerp(av, bv, e); }
      return out;
    }
    const e = ease(t), out = {};
    const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
    for (const k of keys) out[k] = lerp(from[k] ?? DEFAULTS[k], to[k] ?? DEFAULTS[k], e);
    return out;
  }

  // ---------- Timeline (GSAP-like position parameter) ----------
  // track: {el, preset, params, at, unit:'element'|'word'|'line'|'letter', stagger:{each, from}}
  function layout(scene, library) {
    let cursor = 0, lastStart = 0, lastEnd = 0; const labels = {}; const out = [];
    for (const tr of scene.tracks) {
      if (tr.label) { labels[tr.label] = cursor; continue; }
      const preset = library[tr.preset]; if (!preset) throw new Error('No preset ' + tr.preset);
      const params = resolveParams(preset, tr.params);
      const dur = preset.loop ? (tr.length ?? scene.duration) : (params.duration ?? preset.duration);
      const units = tr.units || 1; const each = tr.stagger ? tr.stagger.each : 0;
      const total = dur + each * (units - 1);
      let start;
      const at = tr.at;
      if (at === undefined || at === '>') start = lastEnd;
      else if (typeof at === 'number') start = at;
      else if (at === '<') start = lastStart;
      else if (/^<[-+]?\d+/.test(at)) start = lastStart + parseFloat(at.slice(1));
      else if (/^>[-+]?\d+/.test(at)) start = lastEnd + parseFloat(at.slice(1));
      else if (/^[+-]=\d+/.test(at)) start = cursor + (at[0] === '-' ? -1 : 1) * parseFloat(at.slice(2));
      else if (labels[at.split(/[+-]=/)[0]] !== undefined) { const [l, off] = at.split(/(?=[+-]=)/); start = labels[l] + (off ? (off[0] === '-' ? -1 : 1) * parseFloat(off.slice(2)) : 0); }
      else throw new Error('Bad position ' + at);
      out.push({ ...tr, preset, params, start, dur, total, each, units });
      // Loop tracks are ambient: they never move the relative-position pointers ("<", ">", "+=")
      if (!preset.loop) { lastStart = start; lastEnd = start + total; cursor = Math.max(cursor, lastEnd); }
    }
    return out;
  }

  function staggerOrder(i, n, from) {
    // returns index in time order. 'start' honours reading direction (caller passes visual index)
    if (from === 'end') return n - 1 - i;
    if (from === 'center') return Math.abs(i - (n - 1) / 2);
    if (from === 'edges') return (n - 1) / 2 - Math.abs(i - (n - 1) / 2);
    return i;
  }

  // evaluate whole scene at time t -> map key -> props. key = el or el#unitIndex
  function evaluate(laid, t, opts = {}) {
    const state = {};
    const reduced = !!opts.reducedMotion;
    for (const tr of laid) {
      const n = tr.units;
      for (let i = 0; i < n; i++) {
        const key = n > 1 ? tr.el + '#' + i : tr.el;
        const s = state[key] || (state[key] = {});
        const order = staggerOrder(i, n, tr.stagger && tr.stagger.from);
        const t0 = tr.start + order * tr.each;
        const local = t - t0;
        const ph = tr.preset.phase;
        if (reduced) {
          // Reduced motion: entrances become a short opacity fade, exits a fade, loops/emphasis are disabled.
          if (ph === 'entrance') { const k = Math.max(0, Math.min(1, local / 200)); s.opacity = (s.opacity ?? 1) * k; }
          else if (ph === 'exit') { const k = Math.max(0, Math.min(1, local / 200)); s.opacity = (s.opacity ?? 1) * (1 - k); }
          continue;
        }
        if (ph === 'entrance' && local < 0) { Object.assign(s, evalPreset(tr.preset, 0, tr.params)); continue; }
        if (ph === 'exit' && local < 0) continue;
        if (ph === 'loop' || ph === 'emphasis') { if (local < 0) continue; }
        const v = evalPreset(tr.preset, local, tr.params);
        // compose: multiplicative for opacity/scale, additive for offsets
        for (const k in v) {
          if (k === 'opacity' || k === 'scale' || k === 'scaleX' || k === 'scaleY' || k === 'brightness') s[k] = (s[k] ?? 1) * (s['_' + k + tr.preset.id] ? 1 : 1) * v[k];
          else if (k === 'draw' || k === 'shimmer') s[k] = v[k];
          else s[k] = (s[k] ?? 0) + v[k];
        }
      }
    }
    return state;
  }

  root.MotionEngine = { EASINGS, getEase, cubicBezier, springFn, evalPreset, layout, evaluate, DEFAULTS, resolveParams };
  if (typeof module !== 'undefined') module.exports = root.MotionEngine;
})(typeof window !== 'undefined' ? window : globalThis);
