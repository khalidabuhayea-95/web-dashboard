// canva-fiber-main.js — Canva design-model extractor for the MAIN world.
//
// WHY THIS IS A FILE (not a background.js func): Canva's React model (__reactFiber$) is only
// reachable in the page's MAIN world. Historically background.js injected its extractCanvaFiberModel
// via executeScript({ world: "MAIN", func }), but a `func` is SERIALIZED FROM THE SERVICE WORKER —
// and Chrome aggressively caches the MV3 service worker, so every fiber-derived feature (animations,
// text styles, editable shapes, flips) silently ran STALE code until a full Remove+Load-unpacked.
// Files injected via executeScript({ files }) are re-read from disk on every import, so they update
// on a plain extension reload. background.js injects this file into the MAIN world, then reads the
// result back off globalThis via a trivial (cache-immune) func.
//
// Keep the extraction logic in sync with background.js's fallback extractCanvaFiberModel() and
// canva-scraper.js's buildFiberElementModel(). This file is the CANONICAL, reload-fresh copy.
// Returns { [LBid]: { type, left, top, width, height, rotation, transparency, startUs, durationUs,
// animation, text, image, shape } } (+ optional __background). Best-effort: {} on any failure.
(function () {
  function extractCanvaFiberModel() {
    const result = {};
    try {
      const usToMs = (us) =>
        Number.isFinite(Number(us)) && Number(us) > 0 ? Math.round(Number(us) / 1000) : undefined;
      const seed = document.querySelector('[id^="LB"]');
      if (!seed) return result;
      const fiberKey = Object.keys(seed).find((k) => k.startsWith("__reactFiber$"));
      if (!fiberKey) return result;
      let fiber = seed[fiberKey];
      let doc = null;
      let hops = 0;
      while (fiber && hops < 120) {
        const props = fiber.memoizedProps;
        if (
          props &&
          props.document &&
          (props.document.doctype !== undefined || props.document.pages !== undefined)
        ) {
          doc = props.document;
          break;
        }
        fiber = fiber.return;
        hops += 1;
      }
      if (!doc) return result;

      // Canva's own document keywords. Present on templates from their library; usually EMPTY on
      // a design a user created from one, because the copy does not inherit them. Free to read,
      // so take them when they exist and let the server fall back to the title otherwise.
      try {
        const rawKeywords = doc.keywords && typeof doc.keywords.get === "function"
          ? doc.keywords.get()
          : doc.keywords;
        if (Array.isArray(rawKeywords) && rawKeywords.length > 0) {
          result.__keywords = rawKeywords
            .map((k) => String(k || "").trim())
            .filter(Boolean)
            .slice(0, 24);
        }
      } catch (_e) {
        /* keywords are a bonus; never fail the extraction for them */
      }
      const seen = new Set();
      let elementsArray = null;
      const findElements = (obj, depth) => {
        if (elementsArray || !obj || typeof obj !== "object" || depth > 14 || seen.has(obj)) return;
        seen.add(obj);
        if (Array.isArray(obj)) {
          if (
            obj.length &&
            obj.some((it) => it && typeof it.id === "string" && /^LB/.test(it.id) && "animation" in it)
          ) {
            elementsArray = obj;
            return;
          }
          for (const it of obj) findElements(it, depth + 1);
        } else {
          for (const key in obj) {
            try {
              findElements(obj[key], depth + 1);
            } catch (_e) {
              /* observable getters can throw */
            }
          }
        }
      };
      findElements(doc, 0);
      if (!elementsArray) return result;

      // Canva custom "create an animation" motion paths are DELTA-encoded keyframe streams: a time
      // array (per-sample ms deltas, all ≥0, summing ≈ durationUs/1000) + x/y px delta arrays.
      // MINIFIED NAMES ROTATE BETWEEN CANVA DEPLOYS (observed: dts/eGd/gGd → dts/SGd/UGd), so the
      // arrays are identified STRUCTURALLY: time = the non-negative array whose sum best matches the
      // track duration; x/y = the remaining two by known-name priority, else alphabetical order.
      // ── canva-motion-path:start
      const decodeMotionPath = (track, windowMs) => {
        try {
          if (!track || typeof track !== "object") return null;
          const arrays = Object.keys(track).filter(
            (k) => Array.isArray(track[k]) && track[k].length >= 2 && track[k].every((v) => Number.isFinite(Number(v)))
          );
          if (arrays.length < 2) return null;
          // Canva's path track, as its player reads it (jUf / kUf / oUf, 2026-10-14): `dts` = the ms
          // between the samples of the designer's RECORDED drag, `Hjd` / `Ijd` (eGd / gGd, SGd / UGd on
          // older deploys) = the x / y deltas, `durationUs` = how long the path PLAYS, `easing` = how
          // that time is spread over the samples: 1 as recorded, 2 at constant speed (time ∝ segment
          // length), 5 constant speed easing in and out over the first and last min(500, length / 3)
          // px. The play time is capped by the element's own window. The recorded ms used to be taken
          // as the play time: DAHNZVrSYZM's doors, dragged in 0.3 s and played over 2 s, whipped away.
          const TIME_NAMES = ["dts"];
          const X_NAMES = ["Dkd", "Hjd", "eGd", "SGd"];
          const Y_NAMES = ["Ekd", "Ijd", "gGd", "UGd"];
          const durationMsTarget = Number(track.durationUs) > 0 ? Number(track.durationUs) / 1000 : null;
          let timeKey = arrays.find((k) => TIME_NAMES.includes(k)) || null;
          if (!timeKey) {
            // Unknown names: the time array is all non-negative; when several qualify, the one closest
            // to the track duration.
            const sums = {};
            for (const k of arrays) sums[k] = track[k].reduce((a, v) => a + (Number(v) || 0), 0);
            let bestScore = Infinity;
            for (const k of arrays) {
              if (X_NAMES.includes(k) || Y_NAMES.includes(k)) continue;
              if (!track[k].every((v) => Number(v) >= 0)) continue;
              const score = durationMsTarget ? Math.abs(sums[k] - durationMsTarget) : -sums[k];
              if (score < bestScore) {
                bestScore = score;
                timeKey = k;
              }
            }
          }
          if (!timeKey) return null;
          const rest = arrays.filter((k) => k !== timeKey);
          if (!rest.length) return null;
          let xKey = rest.find((k) => X_NAMES.includes(k));
          let yKey = rest.find((k) => Y_NAMES.includes(k));
          if (!xKey || !yKey) {
            const ordered = [...rest].sort();
            xKey = xKey || ordered.find((k) => k !== yKey);
            yKey = yKey || ordered.find((k) => k !== xKey) || null;
          }
          const dts = track[timeKey];
          const xs = track[xKey];
          const ys = yKey ? track[yKey] : null;
          const n = Math.min(dts.length, xs.length, ys ? ys.length : xs.length);
          // Cumulative points from the element's resting place, with each segment's recorded ms and
          // length.
          const points = [{ x: 0, y: 0, ms: 0, length: 0 }];
          for (let i = 0; i < n; i += 1) {
            const dx = Number(xs[i]) || 0;
            const dy = Number(ys ? ys[i] : 0) || 0;
            const previous = points[points.length - 1];
            points.push({ x: previous.x + dx, y: previous.y + dy, ms: Math.max(0, Number(dts[i]) || 0), length: Math.hypot(dx, dy) });
          }
          if (points.length < 3) return null;
          let span = 0;
          for (const p of points) span = Math.max(span, Math.abs(p.x), Math.abs(p.y));
          if (span < 2) return null;
          const totalMs = points.reduce((sum, p) => sum + p.ms, 0);
          const totalLength = points.reduce((sum, p) => sum + p.length, 0);
          const easing = Number(track.easing) || 1;
          let weights;
          if (easing === 2 && totalLength > 0) {
            weights = points.map((p) => p.length);
          } else if (easing === 5 && totalLength > 0) {
            const ramp = Math.min(500, totalLength / 3);
            let travelled = 0;
            weights = points.map((p) => {
              travelled += p.length;
              const easeOut = (u) => 1 - (1 - u) * (1 - u);
              const speed =
                travelled < ramp ? easeOut(travelled / ramp) : totalLength - travelled < ramp ? easeOut((totalLength - travelled) / ramp) : 1;
              return p.length / Math.max(0.035, speed);
            });
          } else {
            weights = points.map((p) => p.ms);
          }
          const totalWeight = weights.reduce((sum, w) => sum + w, 0);
          if (!(totalWeight > 0)) return null;
          let playMs = durationMsTarget || totalMs;
          if (Number(windowMs) > 0) playMs = Math.min(playMs, Number(windowMs));
          const raw = [];
          let t = 0;
          points.forEach((p, i) => {
            t += (weights[i] / totalWeight) * playMs;
            raw.push({ t: Math.round(t), x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
          });
          const MAX_POINTS = 48;
          if (raw.length <= MAX_POINTS) return raw;
          const sampled = [];
          for (let i = 0; i < MAX_POINTS; i += 1) {
            sampled.push(raw[Math.round((i * (raw.length - 1)) / (MAX_POINTS - 1))]);
          }
          return sampled;
        } catch (_e) {
          return null;
        }
      };
      // ── canva-motion-path:end
      // ── canva-animation-extract:start ─────────────────────────────────────────────────────────
      // (this block is kept IDENTICAL in canva-fiber-main.js, background.js and canva-scraper.js;
      // extensions/canva-importer/test/animation-mapping.test.mjs evaluates it between the markers)
      //
      // Canva keeps `element.animation = { type: "sequenced"|"independent", animation: <presetId>,
      // <config> }`. The config prop is MINIFIED and rotates between deploys (Sv → Tv → Xw), so it
      // is found STRUCTURALLY: the object-valued prop that holds the track records. Inside it (see
      // docs/canva-animation-parity.md §1): `qg` = intro track {durationUs?}, `Bf` = outro track
      // {durationUs?, reverse?}, `direction` 1 auto / 2 up / 3 down / 4 left / 5 right (the way the
      // element MOVES), `Vd` intensity 0..1 (default .5), `scale` Breathe/Photo-zoom slider (signed,
      // .1..1), `ID` text writing style (1 char / 2 word / 3 line / 5 whole element), `NV` timing
      // mode (1 custom duration, 2 sync with captions), `color` Block bar colour. A track WITHOUT
      // durationUs is Canva's DEFAULT timing (tile clicked, speed never touched): the leg is still
      // PRESENT. Canva's scheduler (background.js, §8.5) derives every window from the page, so the
      // record keeps the config exactly as stored — `config`, legs and raw µs, nothing defaulted.
      // Repeating effects (rotate / flicker / pulse / wiggle) are NOT presets: they live on the
      // element itself as a tiny record (`element.Sz.ref`, names rotate) — see extractRepeating.
      const isPlainObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);
      // Observable-style model fields expose their value through get().
      const unwrapCanvaValue = (v) => (v && typeof v.get === "function" ? v.get() : v);
      const numericArrayCount = (t) =>
        Object.keys(t).filter((a) => Array.isArray(t[a]) && t[a].length >= 2).length;
      const looksLikeTrack = (t) =>
        isPlainObject(t) && ("durationUs" in t || "reverse" in t || numericArrayCount(t) >= 2);
      const CONFIG_SCALAR_KEYS = ["direction", "Vd", "scale", "ID", "NV", "color"];
      const IN_TRACK_KEYS = ["qg", "Wf", "in", "enter", "intro"];
      const OUT_TRACK_KEYS = ["Bf", "tf", "sf", "out", "exit", "outro"];
      const findAnimationConfig = (anim) => {
        const candidates = Object.keys(anim)
          .map((key) => anim[key])
          .filter((v) => isPlainObject(v));
        if (!candidates.length) return null;
        return (
          candidates.find((v) => Object.keys(v).some((kk) => looksLikeTrack(v[kk]))) ||
          candidates.find((v) => CONFIG_SCALAR_KEYS.some((k) => k in v)) ||
          candidates.find((v) => Object.keys(v).some((kk) => isPlainObject(v[kk]))) ||
          (candidates.length === 1 ? candidates[0] : null)
        );
      };
      // Tracks are classified by SHAPE: ≥2 numeric arrays = keyframe track (custom motion path or a
      // loop); anything else is a plain intro/outro record — possibly EMPTY, i.e. default-timed.
      // Intro/outro resolve by known names first, then `reverse` marks the outro, then by order.
      const classifyTracks = (config) => {
        const out = { inTrack: null, outTrack: null, kfCandidate: null };
        if (!isPlainObject(config)) return out;
        const plain = [];
        for (const kk of Object.keys(config)) {
          const t = config[kk];
          if (!isPlainObject(t)) continue;
          if (numericArrayCount(t) >= 2) {
            out.kfCandidate = t;
            continue;
          }
          plain.push({ key: kk, track: t });
        }
        const inPlain = plain.find((p) => IN_TRACK_KEYS.includes(p.key)) || null;
        const outPlain =
          plain.find((p) => OUT_TRACK_KEYS.includes(p.key)) ||
          plain.find((p) => p !== inPlain && "reverse" in p.track) ||
          null;
        const rest = plain.filter((p) => p !== inPlain && p !== outPlain);
        const resolvedIn = inPlain || rest.shift() || null;
        const resolvedOut = outPlain || rest.shift() || null;
        out.inTrack = resolvedIn ? resolvedIn.track : null;
        out.outTrack = resolvedOut ? resolvedOut.track : null;
        return out;
      };
      // null / undefined are ABSENT, not zero (Number(null) is 0).
      const finiteOr = (v, fallback) =>
        v === null || v === undefined || !Number.isFinite(Number(v)) ? fallback : Number(v);
      // Canva direction: 1 auto, 2 up, 3 down, 4 left, 5 right. Older page configs carried words.
      const readCanvaDirection = (v) => {
        if (Number.isFinite(Number(v)) && Number(v) > 0) return Number(v);
        const byWord = { auto: 1, up: 2, down: 3, left: 4, right: 5 };
        return byWord[String(v || "").trim().toLowerCase()] || undefined;
      };
      // The config exactly as Canva stores it, under Canva's own key names: a leg is present
      // (`{}` = default timing) or absent, a stored duration keeps its raw µs (a speed preset writes
      // 500 000 / c, and Canva checks that equality to the last bit), scalars stay raw.
      const normalizeAnimationConfig = (config, inTrack, outTrack) => {
        if (!isPlainObject(config)) return undefined;
        const out = {};
        const readLeg = (track, withReverse) => {
          const leg = {};
          const us = unwrapCanvaValue(track.durationUs);
          if (us !== null && us !== undefined && Number.isFinite(Number(us))) leg.durationUs = Number(us);
          if (withReverse && unwrapCanvaValue(track.reverse) === true) leg.reverse = true;
          return leg;
        };
        if (inTrack) out.qg = readLeg(inTrack, false);
        if (outTrack) out.Bf = readLeg(outTrack, true);
        const direction = readCanvaDirection(unwrapCanvaValue(config.direction));
        if (direction) out.direction = direction;
        for (const key of ["Vd", "scale", "ID", "NV"]) {
          const value = unwrapCanvaValue(config[key]);
          if (value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))) out[key] = Number(value);
        }
        const color = unwrapCanvaValue(config.color);
        if (typeof color === "string" && color) out.color = color;
        return out;
      };
      // Repeating-effect record: `{ rotate?: {direction, Vd}, R2a?: {Vd}, BJa?: {Vd}, N5a?: {Vd} }`
      // (the flicker / pulse / wiggle keys are minified and may rotate). Each entry is a tiny object
      // whose only numeric field is Vd (-1..1, default 0); rotate also carries direction 1 cw / 2 ccw.
      const REPEATING_KEY_MAP = {
        rotate: "rotate",
        R2a: "flicker",
        BJa: "pulse",
        N5a: "wiggle",
        flicker: "flicker",
        pulse: "pulse",
        wiggle: "wiggle",
      };
      // A record is `{ Vd }` plus at most `direction` and a boolean flag (flicker is stored as
      // `{ Vd, Ezp: false }` live — see test/fixtures/canva-live-records-2026-09-22.json), never
      // anything larger or nested.
      const isVdRecord = (v) => {
        if (!isPlainObject(v)) return false;
        const keys = Object.keys(v);
        if (keys.length > 3) return false;
        return keys.every(
          (k) => k === "direction" || typeof v[k] === "number" || typeof v[k] === "boolean"
        );
      };
      const readVd = (rec, fallback) => {
        if (Number.isFinite(Number(rec.Vd))) return Number(rec.Vd);
        const numeric = Object.keys(rec).filter((k) => k !== "direction" && typeof rec[k] === "number");
        return numeric.length === 1 ? rec[numeric[0]] : fallback;
      };
      const extractRepeating = (el) => {
        if (!el || typeof el !== "object") return null;
        for (const key of Object.keys(el)) {
          if (key === "animation") continue;
          try {
            const holder = el[key];
            if (!isPlainObject(holder)) continue;
            const rec = isPlainObject(holder.ref) ? holder.ref : holder;
            const keys = Object.keys(rec);
            if (!keys.length || keys.length > 4) continue;
            if (!keys.every((k) => isVdRecord(rec[k]))) continue;
            // Anchor on a known effect name (or the known holder name) so a random small numeric
            // record elsewhere on the element cannot masquerade as a repeating effect.
            if (!keys.some((k) => k in REPEATING_KEY_MAP) && key !== "Sz") continue;
            const repeating = {};
            const unknownKeys = [];
            for (const k of keys) {
              const name = REPEATING_KEY_MAP[k];
              if (!name) {
                unknownKeys.push(k);
                continue;
              }
              const Vd = Math.max(-1, Math.min(1, readVd(rec[k], 0)));
              repeating[name] =
                name === "rotate" ? { direction: finiteOr(rec[k].direction, 1), Vd } : { Vd };
            }
            if (unknownKeys.length) repeating.unknownKeys = unknownKeys;
            return Object.keys(repeating).length ? repeating : null;
          } catch (_e) {
            /* observable getters can throw — keep scanning */
          }
        }
        return null;
      };
      const extractAnimation = (el) => {
        const repeating = extractRepeating(el);
        const anim = el && el.animation;
        // `{ type: "none" }` is what "مسح الرسوم المتحركة" (clear) leaves behind: NO animation, even
        // when a stale preset id or config rides along — never read a preset out of it.
        const hasAnim = isPlainObject(anim) && anim.type !== "none";
        const config = hasAnim ? findAnimationConfig(anim) : null;
        const { inTrack, outTrack, kfCandidate } = classifyTracks(config);
        const motionPath = kfCandidate ? decodeMotionPath(kfCandidate, usToMs(el && el.durationUs)) : null;
        const loopTrack = motionPath ? null : kfCandidate;
        let mode;
        let durationMs;
        let easingRaw;
        if (inTrack) {
          mode = "IN";
          durationMs = usToMs(inTrack.durationUs);
          easingRaw = inTrack.easing;
        } else if (loopTrack) {
          mode = "LOOP";
          durationMs = usToMs(loopTrack.durationUs);
          easingRaw = loopTrack.easing;
        } else if (outTrack) {
          mode = "OUT";
          durationMs = usToMs(outTrack.durationUs);
          easingRaw = outTrack.easing;
        }
        const canvaPreset =
          hasAnim && Number.isFinite(Number(anim.animation)) ? Number(anim.animation) : null;
        if (canvaPreset === null && !mode && !motionPath && !repeating) return null;
        const direction = config ? readCanvaDirection(config.direction) : undefined;
        const Vd =
          config && Number.isFinite(Number(config.Vd))
            ? Math.max(0, Math.min(1, Number(config.Vd)))
            : undefined;
        const scale =
          config && Number.isFinite(Number(config.scale)) && Number(config.scale) !== 0
            ? Number(config.scale)
            : undefined;
        const writingStyle =
          config && Number.isFinite(Number(config.ID)) && Number(config.ID) > 0
            ? Number(config.ID)
            : undefined;
        const timingMode =
          config && Number.isFinite(Number(config.NV)) && Number(config.NV) > 0
            ? Number(config.NV)
            : undefined;
        const color = config && typeof config.color === "string" && config.color ? config.color : undefined;
        const normalizedConfig = normalizeAnimationConfig(config, inTrack, outTrack);
        return {
          canvaPreset,
          family: hasAnim && typeof anim.type === "string" ? anim.type : undefined,
          // Canva's own config (undefined = the element stores none — a freshly clicked tile).
          ...(normalizedConfig ? { config: normalizedConfig } : {}),
          mode,
          // Leg PRESENCE is separate from timing: a default-timed leg is present with no duration.
          hasIn: Boolean(inTrack),
          hasOut: Boolean(outTrack),
          inMs: inTrack ? usToMs(inTrack.durationUs) : undefined,
          outMs: outTrack ? usToMs(outTrack.durationUs) : undefined,
          loopMs: loopTrack ? usToMs(loopTrack.durationUs) : undefined,
          durationMs,
          delayMs: usToMs(el.startUs),
          easing: Number.isFinite(Number(easingRaw)) ? Number(easingRaw) : undefined,
          ...(outTrack && outTrack.reverse === true ? { reverse: true } : {}),
          ...(direction ? { direction } : {}),
          ...(Vd !== undefined ? { Vd } : {}),
          ...(scale !== undefined ? { scale } : {}),
          ...(writingStyle ? { writingStyle } : {}),
          ...(timingMode ? { timingMode } : {}),
          ...(color ? { color } : {}),
          ...(repeating ? { repeating } : {}),
          ...(motionPath ? { motionPath } : {}),
        };
      };
      // What Canva's scheduler reads straight off an element (docs §8.5), on the element's model entry:
      // its raw `startUs` / `durationUs` — UNDEFINED when Canva left them unset (the element is then
      // untimed; 0 is a real, timed value, so never coerce), the raw record type (`animationType`:
      // "sequenced" / "independent" / "none", undefined when the element has no animation field at
      // all, which is exactly when a page animation applies to it), a text's largest font size (the
      // Stomp page's headline), Canva's layout width `wb` (its font scale) and whether a photo or
      // video fills the element (the photo page presets).
      const readRawMicros = (v) => {
        const value = unwrapCanvaValue(v);
        return value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
          ? undefined
          : Number(value);
      };
      const fillHasMedia = (fill) =>
        isPlainObject(fill) &&
        fill.dropTarget !== false &&
        Boolean((isPlainObject(fill.image) && fill.image.media) || isPlainObject(fill.video));
      const readScheduleFacts = (el) => {
        const facts = {};
        if (!el || typeof el !== "object") return facts;
        const startUs = readRawMicros(el.startUs);
        const durationUs = readRawMicros(el.durationUs);
        if (startUs !== undefined) facts.startUs = startUs;
        if (durationUs !== undefined) facts.durationUs = durationUs;
        const anim = el.animation;
        if (anim === null || anim === undefined) {
          facts.animationState = "absent";
        } else {
          if (isPlainObject(anim) && typeof anim.type === "string") facts.animationType = anim.type;
          facts.animationState = facts.animationType === "none" ? "none" : "present";
        }
        try {
          const items = el.text && el.text.stream && el.text.stream.attrs && el.text.stream.attrs.items;
          let maxFontSize = 0;
          if (Array.isArray(items)) {
            for (const item of items) {
              if (!item || typeof item !== "object") continue;
              for (const k of Object.keys(item)) {
                const bag = item[k];
                if (bag && typeof bag === "object" && Number(bag["font-size"]) > maxFontSize) {
                  maxFontSize = Number(bag["font-size"]);
                }
              }
            }
          }
          if (maxFontSize > 0) facts.maxFontSize = maxFontSize;
        } catch (_e) {
          /* font sizes are a bonus */
        }
        // The text's layout width (its box at scale 1 — the rendered font is font-size × width / it).
        // The key is re-minified between deploys (`wb`; `sb` by 2026-10-14) — found by SHAPE as well:
        // the own number that, paired with another, scales the box's width and height by ONE factor.
        const layoutWidth = (() => {
          if (Number(el.wb) > 0) return Number(el.wb);
          if (el.type !== "text" || !(Number(el.width) > 0) || !(Number(el.height) > 0)) return 0;
          const skip = ["top", "left", "width", "height", "rotation", "transparency", "startUs", "durationUs"];
          const numbers = [];
          for (const key of Object.keys(el)) {
            if (skip.includes(key)) continue;
            let value;
            try {
              value = Number(el[key]);
            } catch (_error) {
              continue;
            }
            if (Number.isFinite(value) && value > 0) numbers.push(value);
          }
          for (let i = 0; i < numbers.length; i += 1) {
            for (let j = 0; j < numbers.length; j += 1) {
              if (i === j) continue;
              const sx = Number(el.width) / numbers[i];
              const sy = Number(el.height) / numbers[j];
              if (sx > 0.05 && sx < 20 && Math.abs(sx - sy) <= sx * 1e-3) return numbers[i];
            }
          }
          return 0;
        })();
        if (layoutWidth > 0) facts.layoutWidth = layoutWidth;
        if (fillHasMedia(el.fill) || (Array.isArray(el.paths) && el.paths.some((p) => p && fillHasMedia(p.fill)))) {
          facts.hasMediaFill = true;
        }
        // A VIDEO fill's Canva video id (VA…): the scraper keeps such an element's clip outline and the
        // background captures the clip by this id (attachCapturedElementVideos).
        const readVideoId = (fill) => {
          if (!isPlainObject(fill) || !isPlainObject(fill.video)) return "";
          const raw = fill.video.video;
          const value = raw && typeof raw.get === "function" ? raw.get() : raw;
          return typeof value === "string" ? value : "";
        };
        const videoId =
          readVideoId(el.fill) ||
          (Array.isArray(el.paths) ? el.paths.map((p) => (p ? readVideoId(p.fill) : "")).find(Boolean) || "" : "");
        if (videoId) facts.videoId = videoId;
        // The element's Canva type ("grid", "shape", "text"…): a grid's cells are imported one by one.
        const elementType = el.type && typeof el.type.get === "function" ? el.type.get() : el.type;
        if (typeof elementType === "string" && elementType) facts.elementType = elementType;
        return facts;
      };
      // Every element under a page's element array, in Canva's paint order (a group before its own
      // contents), each with the LB id of the group that holds it: group children are scheduled right
      // after their group, and their geometry and timing are relative to it.
      const collectCanvaElements = (rootArray) => {
        const out = [];
        const seenElements = new Set();
        const walk = (items, depth, parentId) => {
          if (!Array.isArray(items) || depth > 10) return;
          for (const el of items) {
            if (!el || typeof el !== "object" || seenElements.has(el)) continue;
            seenElements.add(el);
            out.push({ el, parentId });
            const ownId = typeof el.id === "string" && /^LB/.test(el.id) ? el.id : parentId;
            for (const key in el) {
              try {
                const val = el[key];
                if (Array.isArray(val) && val.some((it) => it && typeof it === "object" && "type" in it)) {
                  walk(val, depth + 1, ownId);
                }
              } catch (_e) {
                /* observable getters can throw */
              }
            }
          }
        };
        walk(rootArray, 0, undefined);
        return out;
      };
      // The animation part of an element's model entry (every walk spreads it into its own entry).
      const readAnimationEntry = (el, parentId) => ({
        ...(parentId ? { parentId } : {}),
        ...readScheduleFacts(el),
        animation: extractAnimation(el),
      });
      // Page-level animation ("Animate page"): ONE preset for the whole page, stored as
      // page.animation = <id> from the PAGE enum (a separate enum from the element presets), with its
      // config as a sibling prop (today `Xw`, found by name first, then structurally). An absent config
      // means Canva's default (an outro only when a next page exists); a stored one — even `{}` —
      // replaces it whole, so `config` travels only when the page really stores one.
      const looksLikeAnimationConfig = (candidate) => {
        if (!isPlainObject(candidate)) return false;
        const keys = Object.keys(candidate);
        if (!keys.length || keys.length > 16 || "transparency" in candidate) return false;
        let known = 0;
        for (const key of keys) {
          const value = candidate[key];
          // A leg is a track record — or an empty `{}` (default timing) under a known leg name.
          const isLeg =
            looksLikeTrack(value) ||
            (isPlainObject(value) && !Object.keys(value).length && (IN_TRACK_KEYS.includes(key) || OUT_TRACK_KEYS.includes(key)));
          if (isLeg || CONFIG_SCALAR_KEYS.includes(key)) {
            known += 1;
          } else if (value !== null && value !== undefined && typeof value === "object") {
            return false;
          }
        }
        return known > 0;
      };
      const readPageAnimation = (obj) => {
        try {
          if (!obj || typeof obj !== "object") return null;
          const preset = Number(unwrapCanvaValue(obj.animation));
          if (!Number.isFinite(preset) || preset <= 0) return null;
          const result = { preset };
          let config = unwrapCanvaValue(obj.Xw);
          if (!isPlainObject(config)) {
            config = null;
            for (const key of Object.keys(obj)) {
              if (key === "animation") continue;
              let candidate;
              try {
                candidate = unwrapCanvaValue(obj[key]);
              } catch (_e) {
                continue;
              }
              if (looksLikeAnimationConfig(candidate)) {
                config = candidate;
                break;
              }
            }
          }
          if (config) {
            const { inTrack, outTrack } = classifyTracks(config);
            result.config = normalizeAnimationConfig(config, inTrack, outTrack);
            const direction = readCanvaDirection(unwrapCanvaValue(config.direction));
            const scale = Number(unwrapCanvaValue(config.scale));
            const Vd = Number(unwrapCanvaValue(config.Vd));
            const writingStyle = Number(unwrapCanvaValue(config.ID));
            const color = unwrapCanvaValue(config.color);
            if (direction) result.direction = direction;
            if (Number.isFinite(scale) && scale !== 0) result.scale = scale;
            if (Number.isFinite(Vd)) result.Vd = Math.max(0, Math.min(1, Vd));
            if (Number.isFinite(writingStyle) && writingStyle > 0) result.writingStyle = writingStyle;
            if (typeof color === "string" && color) result.color = color;
            result.hasIn = Boolean(inTrack);
            result.hasOut = Boolean(outTrack);
            if (inTrack) result.inMs = usToMs(unwrapCanvaValue(inTrack.durationUs));
            if (outTrack) {
              result.outMs = usToMs(unwrapCanvaValue(outTrack.durationUs));
              if (unwrapCanvaValue(outTrack.reverse) === true) result.reverse = true;
            }
          }
          return result;
        } catch (_e) {
          return null;
        }
      };
      // The design's pages in order: doc.pages is an ARRAY on older Canva models but an iterable keyed
      // COLLECTION on current ones (spreading yields the page objects; [key, page] pairs unwrapped).
      const listCanvaPages = (doc) => {
        try {
          const raw = doc && doc.pages;
          let pages = Array.isArray(raw)
            ? raw
            : raw && typeof raw === "object" && typeof raw[Symbol.iterator] === "function"
              ? [...raw]
              : [];
          if (pages.length && Array.isArray(pages[0]) && pages[0].length === 2 && pages[0][1] && typeof pages[0][1] === "object") {
            pages = pages.map((entry) => entry[1]);
          }
          return pages.filter((page) => page && typeof page === "object");
        } catch (_e) {
          return [];
        }
      };
      // A page's own length (raw µs; undefined when the author never re-timed it — Canva then plays
      // its nominal 5 s) and design size (Drift / Tectonic / Tumble / Stomp read it).
      const readPageDurationUs = (obj) => {
        const us = obj ? readRawMicros(obj.durationUs) : undefined;
        return us !== undefined && us > 0 ? us : undefined;
      };
      // The end of the longest timed element on a page, in ms (0 when nothing on it is timed). A page
      // whose own length is unset runs for its longest video / animated element: the 12.7 s blooming
      // stickers on DAHOnhalEeI kept the page at 0:12 while its untimed texts imported with the nominal
      // 5 s and vanished from the preview at 0:05.
      const longestTimedElementEndMs = (elements) => {
        let endMs = 0;
        if (!elements || typeof elements !== "object") return endMs;
        for (const key of Object.keys(elements)) {
          if (key.startsWith("__")) continue;
          const entry = elements[key];
          if (!entry || typeof entry !== "object") continue;
          const durationUs = Number(entry.durationUs);
          if (!Number.isFinite(durationUs) || durationUs <= 0) continue;
          const startUs = Number.isFinite(Number(entry.startUs)) ? Number(entry.startUs) : 0;
          endMs = Math.max(endMs, Math.round((startUs + durationUs) / 1000));
        }
        return endMs;
      };
      const readPageSize = (obj) => {
        try {
          if (!obj || typeof obj !== "object") return null;
          for (const candidate of [obj.dimensions, obj.size, obj]) {
            const value = unwrapCanvaValue(candidate);
            if (!value || typeof value !== "object") continue;
            const width = Number(unwrapCanvaValue(value.width));
            const height = Number(unwrapCanvaValue(value.height));
            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
              return { width, height };
            }
          }
        } catch (_e) {
          /* best-effort */
        }
        return null;
      };
// ── canva-animation-extract:end ───────────────────────────────────────────────────────────
      const extractText = (el) => {
        try {
          const stream = el.text && el.text.stream;
          if (!stream) return null;
          let plaintext = "";
          const cells = stream.cells || {};
          // run-strings array (was cells.xc — minified names rotate): first all-string array
          let runs = Array.isArray(cells.xc) ? cells.xc : null;
          if (!runs) {
            for (const k of Object.keys(cells)) {
              const v = cells[k];
              if (Array.isArray(v) && v.length && v.every((x) => typeof x === "string")) {
                runs = v;
                break;
              }
            }
          }
          if (Array.isArray(runs)) plaintext = runs.join("");
          plaintext = String(plaintext == null ? "" : plaintext);
          const items = stream.attrs && stream.attrs.items;
          let style = {};
          if (Array.isArray(items) && items.length) {
            // Style bag prop name rotates between deploys (observed j7→q7, Pdb→Xdb) — resolve
            // STRUCTURALLY: any child object carrying CSS-ish keys; the inner keys ("color",
            // "font-family", …) are stable. Mixed-script text (Arabic name + Latin year) splits into
            // runs whose FIRST run may lack font/size — merge across ALL runs, first defined wins.
            const merged = {};
            // Every size the runs name: a stale run size can sit beside the paragraph's real one
            // (DAHNlANrhmQ: 14.92 on the letters, 156.65 on the paragraph — Canva draws 156.65).
            const fontSizes = [];
            for (const item of items) {
              if (!item || typeof item !== "object") continue;
              let bag = null;
              for (const k of Object.keys(item)) {
                const v = item[k];
                if (!v || typeof v !== "object") continue;
                if (!("font-family" in v) && !("color" in v) && !("font-size" in v)) continue;
                if (!bag || typeof v["font-size"] === "number") bag = v;
              }
              if (!bag) continue;
              if (Number(bag["font-size"]) > 0 && !fontSizes.includes(Number(bag["font-size"]))) fontSizes.push(Number(bag["font-size"]));
              for (const prop of ["color", "font-family", "font-size", "text-align", "direction"]) {
                if (merged[prop] === undefined && bag[prop] !== undefined) merged[prop] = bag[prop];
              }
            }
            style = {
              color: typeof merged.color === "string" ? merged.color : undefined,
              fontFamilyToken: typeof merged["font-family"] === "string" ? merged["font-family"] : undefined,
              fontSize: Number(merged["font-size"]) > 0 ? Number(merged["font-size"]) : undefined,
              ...(fontSizes.length > 1 ? { fontSizes } : {}),
              textAlign: typeof merged["text-align"] === "string" ? merged["text-align"] : undefined,
              direction: typeof merged.direction === "string" ? merged.direction : undefined,
            };
          }
          return { plaintext, ...style };
        } catch (_e) {
          return null;
        }
      };
      // ── canva-media-draw-rect:start
      // The media's draw rect inside its element frame ({ left, top, width, height, rotation }). Canva
      // re-minifies this key with releases (`sb` → `xb` → `wb`, seen 2026-10-05) and a stale name read no
      // crop at all — a 90°-turned photo then had its slice measured on screen and came in squeezed. Find
      // it by SHAPE: the image record's plain object carrying numeric left/top/width/height.
      const findMediaDrawRect = (record) => {
        if (!record || typeof record !== "object") return null;
        const isRect = (value) =>
          Boolean(value) &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          ["left", "top", "width", "height"].every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
        for (const key of ["wb", "xb", "sb"]) if (isRect(record[key])) return record[key];
        for (const key of Object.keys(record)) {
          try {
            if (isRect(record[key])) return record[key];
          } catch (_error) {
            // A throwing getter is not the rect.
          }
        }
        return null;
      };
      // ── canva-media-draw-rect:end
      const extractImage = (el) => {
        try {
          const img = el.fill && el.fill.image;
          const media = img && img.media;
          if (!media || typeof media.id !== "string") return null;
          const sb = findMediaDrawRect(img);
          return {
            mediaId: media.id,
            version: Number(media.version) || undefined,
            crop: sb
              ? {
                  top: Number(sb.top) || 0,
                  left: Number(sb.left) || 0,
                  width: Number(sb.width) || 0,
                  height: Number(sb.height) || 0,
                  rotation: Number(sb.rotation) || 0,
                }
              : null,
            transparency: Number(img.transparency) || 0,
            // fill-level mirroring (e.g. paired corner decorations) — lost = wrong orientation
            flipX: Boolean(el.fill && el.fill.flipX),
            flipY: Boolean(el.fill && el.fill.flipY),
          };
        } catch (_e) {
          return null;
        }
      };
      // Corner radius of a shape path, in DESIGN px. Stored as a MINIFIED numeric prop on the path
      // (observed `mb`: photo frames 27/23, pill labels 51, contact bar 61; 0 = sharp) — verified
      // against the rendered DOM's bezier corners. Known name first, then structural fallback (the
      // only numeric own-prop on the path besides none — `d` is a string, fill/stroke are objects).
      const readPathCornerRadius = (p0) => {
        try {
          if (!p0 || typeof p0 !== "object") return 0;
          if (typeof p0.mb === "number" && Number.isFinite(p0.mb)) return Math.max(0, Math.round(p0.mb));
          for (const k of Object.keys(p0)) {
            const v = p0[k];
            if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.max(0, Math.round(v));
          }
        } catch (_e) {
          /* ignore */
        }
        return 0;
      };
      // Canva 'shape' elements (paths + viewBox + fill) RENDER as protected raster images in the DOM,
      // so the DOM capture path can only snapshot-crop them (baked background). The model holds the
      // clean vector — classify a SIMPLE solid-colour circle/rect (the icon-circle & banner-bar cases)
      // so it imports as an EDITABLE editor shape instead. Complex/image-filled paths → null (image).
      const extractShape = (el) => {
        try {
          const paths = Array.isArray(el.paths) ? el.paths : null;
          if (!paths || paths.length !== 1) return null;
          const p0 = paths[0] || {};
          // A path FILLED WITH AN IMAGE is a Canva photo-frame (the shape clips a photo), NOT an
          // editable shape — leave it to the image path so the photo is preserved.
          if (p0.fill && typeof p0.fill === "object" && p0.fill.image) return null;
          const d = String(p0.d || "").trim();
          let shapeKind = null;
          if (/^M0[ ,]0\s*H[\d.]+\s*V[\d.]+\s*H0\s*z?$/i.test(d)) shapeKind = "rect";
          else if (/A/.test(d) && !/[LlCcQqSsTtHhVv]/.test(d)) shapeKind = "circle";
          if (!shapeKind) return null;
          // Solid fill AND/OR an outline stroke — Canva photo frames, pill labels and dividers are
          // stroke-only rects/circles (no fill). Emit whichever paint(s) the shape carries so the
          // editable shape reproduces the fill and/or the outline instead of a rasterized snapshot.
          const fillColor = p0.fill && typeof p0.fill.color === "string" ? p0.fill.color : null;
          const stroke = p0.stroke && typeof p0.stroke === "object" ? p0.stroke : null;
          const strokeColor = stroke && typeof stroke.color === "string" ? stroke.color : null;
          const strokeWidth =
            stroke && Number(stroke.weight) > 0 ? Math.max(1, Math.round(Number(stroke.weight))) : 0;
          if (!fillColor && !(strokeColor && strokeWidth > 0)) return null;
          return { shapeKind, fillColor, strokeColor, strokeWidth, cornerRadius: readPathCornerRadius(p0) };
        } catch (_e) {
          return null;
        }
      };
      // Border + corner radius for an IMAGE-filled shape (Canva photo-frame): the shape clips a
      // photo AND draws a stroke outline / rounds the corners. extractShape bails on image-filled
      // shapes (to keep the photo), so pull the outline + radius here and apply them to the captured
      // image layer (stroke color + weight and radius all in design px).
      const extractBorder = (el) => {
        try {
          const paths = Array.isArray(el.paths) ? el.paths : null;
          const p0 = paths && paths.length === 1 ? paths[0] : null;
          if (!p0 || !(p0.fill && typeof p0.fill === "object" && p0.fill.image)) return null;
          const stroke = p0.stroke && typeof p0.stroke === "object" ? p0.stroke : null;
          const strokeColor = stroke && typeof stroke.color === "string" ? stroke.color : null;
          const strokeWidth =
            stroke && Number(stroke.weight) > 0 ? Math.max(1, Math.round(Number(stroke.weight))) : 0;
          const cornerRadius = readPathCornerRadius(p0);
          const d = String(p0.d || "").trim();
          // rectFrame: the frame is a PLAIN RECT path, so frame + radius + stroke are fully
          // reproducible by the editor (image cornerRadius/stroke props) — the rendered
          // snapshot is never needed for such layers.
          const rectFrame = /^M0[ ,]0\s*H[\d.]+\s*V[\d.]+\s*H0\s*z?$/i.test(d);
          // circleFrame: an arc-only path is Canva's round photo frame — a true ELLIPSE inscribed
          // in the box, a circle only when that box is square. The editor reproduces it via
          // `mediaShape: "circle"` at any aspect, so the layer keeps its clean fetched asset
          // instead of the isolation snapshot (which has no alpha outside the mask, and so
          // came back as an opaque rectangle with the page baked into its corners).
          const circleFrame = !rectFrame && /A/.test(d) && !/[LlCcQqSsTtHhVv]/.test(d);
          // A circle frame is worth reporting even with no stroke and no radius — the round mask
          // itself is the thing the editor needs to know about.
          if (!(strokeColor && strokeWidth > 0) && !(cornerRadius > 0) && !circleFrame) return null;
          return { strokeColor, strokeWidth, cornerRadius, rectFrame, circleFrame };
        } catch (_e) {
          return null;
        }
      };
      // ── Drop shadow ───────────────────────────────────────────────────────────────────────────
      // Canva keeps a layer's effects in an array on the element: an entry `{ id: "shadow" }`
      // holding a nested array with `{ type: "drop-shadow", fill, offset, blur, direction }`.
      // BOTH array keys are minified (observed `vd` → `vd`) and minified names rotate between
      // Canva deploys, so this walks for the two STABLE anchors instead: the literal `"shadow"`
      // id and the `"drop-shadow"` type.
      //
      // Units verified against the layer's own rendered CSS: model {offset:20, blur:10,
      // direction:-45} renders as `drop-shadow(rgba(0,0,0,0.3) 14.142px 14.142px 10px)`, i.e.
      //   • offset and blur are DESIGN px, 1:1 (14.142 = 20·cos45, and blur passes straight
      //     through — CSS and canvas both treat the radius as 2σ, so Konva's shadowBlur matches);
      //   • the angle runs anticlockwise from +x while the y axis points DOWN, hence the -sin;
      //   • alpha = 1 - fill.transparency, the same convention as every other Canva paint.
      const hexToRgba = (hex, alpha) => {
        const raw = String(hex || "").trim().replace(/^#/, "");
        const full =
          raw.length === 3
            ? raw
                .split("")
                .map((c) => c + c)
                .join("")
            : raw;
        if (!/^[0-9a-f]{6}$/i.test(full)) return null;
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${Math.round(alpha * 1000) / 1000})`;
      };
      const extractShadow = (el) => {
        try {
          for (const key in el) {
            let bucket;
            try {
              bucket = el[key];
            } catch (_e) {
              continue;
            }
            if (!Array.isArray(bucket)) continue;
            for (const entry of bucket) {
              if (!entry || typeof entry !== "object" || entry.id !== "shadow") continue;
              for (const innerKey in entry) {
                const effects = entry[innerKey];
                if (!Array.isArray(effects)) continue;
                const drop = effects.find((e) => e && String(e.type || "") === "drop-shadow");
                if (!drop) continue;
                const blur = Math.max(0, Number(drop.blur) || 0);
                const offset = Math.max(0, Number(drop.offset) || 0);
                // A shadow with no blur AND no offset sits exactly behind its layer: invisible.
                if (blur <= 0 && offset <= 0) return null;
                let transparency = Number(drop.fill && drop.fill.transparency) || 0;
                if (transparency > 1) transparency /= 100;
                const alpha = Math.max(0, Math.min(1, 1 - transparency));
                if (alpha <= 0) return null;
                const color = hexToRgba((drop.fill && drop.fill.color) || "#000000", alpha);
                if (!color) return null;
                const radians = ((Number(drop.direction) || 0) * Math.PI) / 180;
                return {
                  color,
                  blur: Math.round(blur * 100) / 100,
                  offsetX: Math.round(-offset * Math.sin(radians) * 100) / 100,
                  offsetY: Math.round(offset * Math.cos(radians) * 100) / 100,
                };
              }
            }
          }
        } catch (_e) {
          return null;
        }
        return null;
      };
      // ── Vector rebuild for shapes that aren't a simple circle/rect ────────────────────────────
      // A Canva `shape` with an arch / blob / badge path (or a gradient fill) has no editable
      // editor equivalent, so it used to fall through to the image path — and its DOM node is a
      // PROTECTED raster, so the only capture available was a screenshot crop. That crop has no
      // alpha: everything outside the path comes back as whatever was painted behind it, which is
      // why a rounded arch imported as a hard-edged rectangle with the page baked into its
      // corners. The model holds the real vector, so rebuild an SVG from it: exact silhouette,
      // true transparency outside the path, and resolution-independent.
      //
      // `preserveAspectRatio="none"` is deliberate — Canva stretches the path's viewBox to the
      // element box (a 52×64 viewBox drawn at 663×1035), so the SVG must stretch the same way.
      const svgColor = (color, transparency) => {
        const hex = typeof color === "string" ? color.trim() : "";
        if (!hex) return null;
        let t = Number(transparency) || 0;
        if (t > 1) t /= 100;
        const alpha = Math.max(0, Math.min(1, 1 - t));
        return { hex, alpha };
      };
      // ── canva-gradient-line:start
      // Canva's linear gradient `rotation` (degrees) turns the colour line from top→bottom (0) toward
      // left→right (90 — what Canva's own DOM draws for it: x1=0 → x2=width at mid-height on
      // DAHR9xcvsOU's fade bands). The line runs through the box centre along (sin r, cos r), in
      // objectBoundingBox units. Kept identical in canva-fiber-main.js, background.js and
      // canva-scraper.js (extensions/canva-importer/test/gradient-line.test.mjs checks all three).
      const canvaGradientLine = (rotation) => {
        const raw = rotation && typeof rotation.get === "function" ? rotation.get() : rotation;
        const degrees = Number(raw);
        const radians = ((Number.isFinite(degrees) ? degrees : 0) * Math.PI) / 180;
        const round = (value) => Math.round(value * 10000) / 10000 + 0;
        const dx = Math.sin(radians) / 2;
        const dy = Math.cos(radians) / 2;
        return { x1: round(0.5 - dx), y1: round(0.5 - dy), x2: round(0.5 + dx), y2: round(0.5 + dy) };
      };
      // ── canva-gradient-line:end
      const svgPaintFromFill = (fill, gradientId) => {
        // → { paint, alpha, defs } where paint is a colour or url(#id).
        if (!fill || typeof fill !== "object") return null;
        const gradient = fill.gradient && typeof fill.gradient === "object" ? fill.gradient : null;
        if (gradient && Array.isArray(gradient.stops) && gradient.stops.length > 0) {
          const stops = gradient.stops
            .map((stop) => {
              const paint = svgColor(stop && stop.color, stop && stop.transparency);
              if (!paint) return null;
              const offset = Math.max(0, Math.min(1, Number(stop.position) || 0));
              return `<stop offset="${offset}" stop-color="${paint.hex}" stop-opacity="${paint.alpha}"/>`;
            })
            .filter(Boolean);
          if (stops.length === 0) return null;
          const isRadial = String(gradient.type || "").toLowerCase() === "radial";
          const line = canvaGradientLine(gradient.rotation);
          const cx = Number(gradient.center && gradient.center.left);
          const cy = Number(gradient.center && gradient.center.top);
          const defs = isRadial
            ? `<radialGradient id="${gradientId}" cx="${Number.isFinite(cx) ? cx : 0.5}" cy="${
                Number.isFinite(cy) ? cy : 0.5
              }" r="0.75">${stops.join("")}</radialGradient>`
            : // The line follows Canva's `rotation` (canvaGradientLine); none = top→bottom.
              `<linearGradient id="${gradientId}" x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}">${stops.join("")}</linearGradient>`;
          return { paint: `url(#${gradientId})`, alpha: 1, defs };
        }
        const solid = svgColor(fill.color, fill.transparency);
        if (!solid) return null;
        return { paint: solid.hex, alpha: solid.alpha, defs: "" };
      };
      // Canva resizes a shape by SLICING, not stretching: `el.slice.source` is the band of the viewBox
      // that stretches (a 55×64 hexagon stretches only rows 16..48), everything outside keeps its size,
      // and the sliced result is then scaled UNIFORMLY into the box. Stretching the whole viewBox to the
      // box (a 739×883 badge) steepened its caps from 105 px to 221 px. The slice record also carries
      // the stretched sizes of that band under minified names; they are the pair whose sliced viewBox
      // has the box's own aspect ratio.
      const readShapeSlice = (el, vbWidth, vbHeight, boxWidth, boxHeight) => {
        const slice = el.slice && typeof el.slice === "object" ? el.slice : null;
        const source = slice && slice.source && typeof slice.source === "object" ? slice.source : null;
        if (!source) return null;
        const srcLeft = Number(source.left) || 0;
        const srcTop = Number(source.top) || 0;
        const srcWidth = Number(source.width) || 0;
        const srcHeight = Number(source.height) || 0;
        if (!(srcWidth > 0 && srcHeight > 0)) return null;
        const sizes = Object.keys(slice)
          .filter((key) => key !== "source" && key !== "horizontal" && key !== "vertical")
          .map((key) => Number(slice[key]))
          .filter((value) => Number.isFinite(value) && value > 0);
        let best = null;
        for (let i = 0; i < sizes.length; i += 1) {
          for (let j = 0; j < sizes.length; j += 1) {
            if (i === j) continue;
            const width = sizes[i] + (vbWidth - srcWidth);
            const height = sizes[j] + (vbHeight - srcHeight);
            if (!(width > 0 && height > 0)) continue;
            const error = Math.abs(boxWidth / width - boxHeight / height) / (boxWidth / width);
            if (!best || error < best.error) best = { error, stretchedWidth: sizes[i], stretchedHeight: sizes[j], width, height };
          }
        }
        if (!best || best.error > 0.01) return null;
        const axis = (start, size, stretched) => (value) =>
          value <= start ? value : value >= start + size ? value + (stretched - size) : start + ((value - start) * stretched) / size;
        return {
          width: best.width,
          height: best.height,
          mapX: axis(srcLeft, srcWidth, best.stretchedWidth),
          mapY: axis(srcTop, srcHeight, best.stretchedHeight),
        };
      };
      // A path's points mapped through (mapX, mapY): parsed to absolute M/L/C/Q/Z first, since a
      // piecewise map can't be applied to relative offsets. Null for arcs (their radii can't be sliced)
      // or anything unparseable — the caller then stretches as before.
      const mapSvgPathPoints = (d, mapX, mapY) => {
        const tokens = String(d).match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
        if (!tokens || !/^[Mm]$/.test(tokens[0])) return null;
        const out = [];
        const fmt = (value) => String(Math.round(value * 1000) / 1000);
        const point = (x, y) => `${fmt(mapX(x))} ${fmt(mapY(y))}`;
        let index = 0;
        let command = "";
        let x = 0;
        let y = 0;
        let startX = 0;
        let startY = 0;
        let lastControlX = null;
        let lastControlY = null;
        let lastCommand = "";
        const next = () => {
          const value = Number(tokens[index]);
          index += 1;
          if (!Number.isFinite(value)) throw new Error("bad path");
          return value;
        };
        while (index < tokens.length) {
          if (/^[A-Za-z]$/.test(tokens[index])) {
            command = tokens[index];
            index += 1;
          } else if (!command) {
            return null;
          }
          const relative = command === command.toLowerCase();
          const upper = command.toUpperCase();
          const dx = relative ? x : 0;
          const dy = relative ? y : 0;
          if (upper === "A") return null;
          if (upper === "Z") {
            out.push("Z");
            x = startX;
            y = startY;
            lastControlX = null;
            lastCommand = "Z";
            continue;
          }
          if (upper === "M") {
            x = next() + dx;
            y = next() + dy;
            startX = x;
            startY = y;
            out.push(`M${point(x, y)}`);
            command = relative ? "l" : "L";
            lastControlX = null;
            lastCommand = "M";
          } else if (upper === "L") {
            x = next() + dx;
            y = next() + dy;
            out.push(`L${point(x, y)}`);
            lastControlX = null;
            lastCommand = "L";
          } else if (upper === "H") {
            x = next() + (relative ? x : 0);
            out.push(`L${point(x, y)}`);
            lastControlX = null;
            lastCommand = "H";
          } else if (upper === "V") {
            y = next() + (relative ? y : 0);
            out.push(`L${point(x, y)}`);
            lastControlX = null;
            lastCommand = "V";
          } else if (upper === "C" || upper === "S") {
            let x1;
            let y1;
            if (upper === "C") {
              x1 = next() + dx;
              y1 = next() + dy;
            } else {
              const smooth = lastCommand === "C" && lastControlX !== null;
              x1 = smooth ? 2 * x - lastControlX : x;
              y1 = smooth ? 2 * y - lastControlY : y;
            }
            const x2 = next() + dx;
            const y2 = next() + dy;
            x = next() + dx;
            y = next() + dy;
            out.push(`C${point(x1, y1)} ${point(x2, y2)} ${point(x, y)}`);
            lastControlX = x2;
            lastControlY = y2;
            lastCommand = "C";
          } else if (upper === "Q" || upper === "T") {
            let x1;
            let y1;
            if (upper === "Q") {
              x1 = next() + dx;
              y1 = next() + dy;
            } else {
              const smooth = lastCommand === "Q" && lastControlX !== null;
              x1 = smooth ? 2 * x - lastControlX : x;
              y1 = smooth ? 2 * y - lastControlY : y;
            }
            x = next() + dx;
            y = next() + dy;
            out.push(`Q${point(x1, y1)} ${point(x, y)}`);
            lastControlX = x1;
            lastControlY = y1;
            lastCommand = "Q";
          } else {
            return null;
          }
        }
        return out.join("");
      };
      const extractVectorShape = (el) => {
        try {
          const paths = Array.isArray(el.paths) ? el.paths : null;
          if (!paths || paths.length === 0 || paths.length > 12) return null;
          // An image-filled path is a photo frame — keep the photo (extractBorder handles it). So is a
          // VIDEO-filled one: drawn as a vector it kept only its other paths — DAHNlJePGh0's oval
          // clip came in as its bare outline ring, and its video id never reached the clip capture.
          if (paths.some((p) => p && p.fill && typeof p.fill === "object" && (p.fill.image || p.fill.video))) return null;
          const viewBox = el.viewBox && typeof el.viewBox === "object" ? el.viewBox : null;
          const vbWidth = Number(viewBox && viewBox.width) || 0;
          const vbHeight = Number(viewBox && viewBox.height) || 0;
          if (!(vbWidth > 0 && vbHeight > 0)) return null;
          const vbLeft = Number(viewBox.left) || 0;
          const vbTop = Number(viewBox.top) || 0;
          const boxWidth = Math.max(1, Number(el.width) || vbWidth);
          const boxHeight = Math.max(1, Number(el.height) || vbHeight);

          // Slice the geometry when Canva does (and every path can be mapped); else stretch as before.
          const slice = readShapeSlice(el, vbWidth, vbHeight, boxWidth, boxHeight);
          const slicedPaths = slice
            ? paths.map((p) => (p && typeof p.d === "string" ? mapSvgPathPoints(p.d.trim(), slice.mapX, slice.mapY) : null))
            : null;
          const useSlice = Boolean(slicedPaths && slicedPaths.every((d, i) => d || !(paths[i] && paths[i].d)));
          const outViewBox = useSlice ? `0 0 ${slice.width} ${slice.height}` : `${vbLeft} ${vbTop} ${vbWidth} ${vbHeight}`;
          // Design px per viewBox unit (uniform when sliced; the geometric mean of a stretch otherwise).
          const unitScale = useSlice
            ? boxWidth / slice.width
            : Math.sqrt((boxWidth / vbWidth) * (boxHeight / vbHeight));

          const defs = [];
          const body = [];
          paths.forEach((p, i) => {
            const rawD = p && typeof p.d === "string" ? p.d.trim() : "";
            const d = useSlice ? slicedPaths[i] : rawD;
            if (!d) return;
            const fillPaint = svgPaintFromFill(p.fill, `g${i}`);
            const stroke = p.stroke && typeof p.stroke === "object" ? p.stroke : null;
            const strokePaint = stroke ? svgColor(stroke.color, stroke.transparency) : null;
            const strokeWeight = stroke && Number(stroke.weight) > 0 ? Number(stroke.weight) : 0;
            if (!fillPaint && !(strokePaint && strokeWeight > 0)) return;
            if (fillPaint && fillPaint.defs) defs.push(fillPaint.defs);
            const safeD = d.replace(/"/g, "'");
            body.push(
              `<path d="${safeD}" ${fillPaint ? `fill="${fillPaint.paint}"` : 'fill="none"'}${
                fillPaint && fillPaint.alpha < 1 ? ` fill-opacity="${fillPaint.alpha}"` : ""
              }/>`
            );
            if (strokePaint && strokeWeight > 0) {
              // Canva's border is `weight` DESIGN px wide and lies INSIDE the shape: it draws a
              // non-scaling stroke of twice the weight clipped to the path. In viewBox units that is
              // 2·weight / unitScale; the old rebuild used `weight` viewBox units centred on the edge,
              // which a 13× stretch turned into a 67 px band (34 px of it left inside the image).
              const closed = /[Zz]\s*$/.test(d);
              const widthUnits = ((closed ? 2 : 1) * strokeWeight) / Math.max(0.0001, unitScale);
              const clipId = `c${i}`;
              if (closed) defs.push(`<clipPath id="${clipId}"><path d="${safeD}"/></clipPath>`);
              body.push(
                `<path d="${safeD}" fill="none" stroke="${strokePaint.hex}" stroke-width="${
                  Math.round(widthUnits * 10000) / 10000
                }"${strokePaint.alpha < 1 ? ` stroke-opacity="${strokePaint.alpha}"` : ""}${
                  closed ? ` clip-path="url(#${clipId})"` : ""
                }/>`
              );
            }
          });
          if (body.length === 0) return null;

          // Rasterized server-side, so give it real pixels: the element's own design size, capped.
          const cap = 2048;
          const scale = Math.min(1, cap / Math.max(boxWidth, boxHeight));
          const outWidth = Math.max(1, Math.round(boxWidth * scale));
          const outHeight = Math.max(1, Math.round(boxHeight * scale));
          const svg =
            `<svg xmlns="http://www.w3.org/2000/svg" width="${outWidth}" height="${outHeight}" ` +
            `viewBox="${outViewBox}" preserveAspectRatio="none">` +
            (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
            body.join("") +
            `</svg>`;
          return { svg, width: outWidth, height: outHeight };
        } catch (_e) {
          return null;
        }
      };
      // Canva 'line' elements (dividers / rules) are thin strokes the DOM capture's thin-vector gate
      // often drops entirely, leaving a visible gap. The model always has them: a straight stroke
      // with a color + weight (thickness). Recover them as a thin filled rect downstream.
      const extractLine = (el) => {
        try {
          const color =
            typeof el.color === "string"
              ? el.color
              : el.fill && typeof el.fill.color === "string"
                ? el.fill.color
                : null;
          if (!color) return null;
          const weight =
            Number(el.weight) > 0 ? Number(el.weight) : Number(el.height) > 0 ? Number(el.height) : 1;
          return { color, weight: Math.max(1, Math.round(weight)) };
        } catch (_e) {
          return null;
        }
      };
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      // zOrder: Canva's element array order IS the paint order (index 0 = bottom). Stamped
      // EXPLICITLY because the model crosses executeScript arg serialization, which SORTS object
      // keys alphabetically — Object.keys() insertion order does NOT survive the boundary.
      const mapElement = (el, zOrder, parentId) => ({
        zOrder,
        type: typeof el.type === "string" ? el.type : "",
        left: num(el.left),
        top: num(el.top),
        width: num(el.width),
        height: num(el.height),
        rotation: num(el.rotation),
        transparency: num(el.transparency),
        // parentId, raw startUs / durationUs (UNDEFINED when Canva left them unset — never 0),
        // animationState / animationType, maxFontSize, layoutWidth, hasMediaFill, animation:
        // everything Canva's scheduler reads (see the shared canva-animation-extract block).
        ...readAnimationEntry(el, parentId),
        text: el.type === "text" ? extractText(el) : null,
        image: el.type === "rect" ? extractImage(el) : null,
        // The fill's own mirroring, whatever it holds. `image` carries it for photo fills, but a
        // VIDEO fill (Canva's animated stickers) has no image media, so its flip was lost and
        // five of six watercolours on DAHOhOaWZTw imported un-mirrored.
        fillFlip:
          el.type === "rect" && el.fill
            ? { flipX: Boolean(el.fill.flipX), flipY: Boolean(el.fill.flipY) }
            : null,
        shape: el.type === "shape" ? extractShape(el) : null,
        line: el.type === "line" ? extractLine(el) : null,
        border: el.type === "shape" ? extractBorder(el) : null,
        // Only for shapes extractShape can't make editable — an editable circle/rect always wins.
        vector: el.type === "shape" && !extractShape(el) ? extractVectorShape(el) : null,
        // Any layer type can carry a drop shadow in Canva, so this is not gated on `type`.
        shadow: extractShadow(el),
      });
      const buildElementMap = (rootArray) => {
        const out = {};
        if (!Array.isArray(rootArray)) return out;
        let zOrder = 0;
        for (const { el, parentId } of collectCanvaElements(rootArray)) {
          const id = String((el && el.id) || "");
          if (!id || !/^LB/.test(id)) continue;
          out[id] = mapElement(el, zOrder++, parentId);
        }
        return out;
      };
      Object.assign(result, buildElementMap(elementsArray));

      // ── Page BACKGROUND clip track (video designs) ──────────────────────────────────────────────
      // The full-canvas backdrop of a Canva video is NOT an LB element — it's a per-scene clip array
      // on the PAGE object (each item: {durationUs, color, video:{video:"VA…", rb placement,
      // transparency, trim}}). Video FILES are signed/protected, but the poster JPGs on
      // video-public.canva.com are public and the editor page has already loaded them — harvest the
      // exact URLs from resource timing. Found structurally (prop names rotate).
      try {
        let pageObj = null;
        const pseen = new Set();
        (function findPage(n, depth) {
          if (pageObj || depth > 12 || !n || typeof n !== "object" || pseen.has(n)) return;
          pseen.add(n);
          if (!Array.isArray(n)) {
            for (const k of Object.keys(n)) {
              const v = n[k];
              if (
                Array.isArray(v) &&
                v.length &&
                v.some((it) => it && typeof it.id === "string" && /^LB/.test(it.id))
              ) {
                pageObj = n;
                return;
              }
            }
          }
          const keys = Array.isArray(n) ? [...n.keys()] : Object.keys(n);
          for (const k of keys) {
            try {
              findPage(n[k], depth + 1);
            } catch (_e) {
              /* ignore */
            }
          }
        })(doc, 0);
        const findClipsOnPageObj = (targetPageObj) => {
          if (!targetPageObj) return null;
          let clips = null;
          for (const k of Object.keys(targetPageObj)) {
            const v = targetPageObj[k];
            if (!Array.isArray(v) || !v.length) continue;
            const looksLikeClips = v.every(
              (it) =>
                it &&
                typeof it === "object" &&
                Number(it.durationUs) > 0 &&
                !("id" in it && /^LB/.test(String(it.id)))
            );
            if (looksLikeClips) {
              clips = v;
              break;
            }
          }
          if (!clips) return null;
          const findVideoRef = (clip) => {
            for (const k of Object.keys(clip)) {
              const v = clip[k];
              if (!v || typeof v !== "object" || Array.isArray(v)) continue;
              // a video clip object carries a VA… reference + trim/autoplay/volume-ish fields
              const refKey = Object.keys(v).find(
                (kk) => typeof v[kk] === "string" && /^VA/.test(v[kk])
              );
              if (refKey && ("trim" in v || "autoplay" in v || "volume" in v)) {
                let rb = null;
                for (const kk of Object.keys(v)) {
                  const cand = v[kk];
                  if (
                    cand &&
                    typeof cand === "object" &&
                    Number.isFinite(Number(cand.width)) &&
                    Number.isFinite(Number(cand.left)) &&
                    Number(cand.width) > 0
                  ) {
                    rb = {
                      left: Number(cand.left) || 0,
                      top: Number(cand.top) || 0,
                      width: Number(cand.width) || 0,
                      height: Number(cand.height) || 0,
                      // A landscape clip turned to fill a portrait page keeps its turn here, as the
                      // fill-slot box does — DAHNlPG57uU's bokeh backdrop (1920×1084, -90°) lay
                      // flat across the middle of every scene with the page white above and below.
                      rotation: Number(cand.rotation) || 0,
                    };
                    break;
                  }
                }
                return { videoId: v[refKey], transparency: Number(v.transparency) || 0, rb };
              }
            }
            return null;
          };
          const outClips = [];
          for (const clip of clips) {
            outClips.push({
              durationMs: Math.round(Number(clip.durationUs) / 1000),
              color: typeof clip.color === "string" ? clip.color : null,
              video: findVideoRef(clip),
            });
          }
          return outClips;
        };
        const posters = {};
        try {
          for (const entry of performance.getEntriesByType("resource")) {
            const m = String(entry.name || "").match(
              /https:\/\/video-public\.canva\.com\/([^/]+)\/([pl])\/[^?#]+\.jpe?g/i
            );
            if (!m) continue;
            const [url, vid, tier] = [entry.name, m[1], m[2].toLowerCase()];
            // prefer the larger /l/ poster over /p/
            if (!posters[vid] || (tier === "l" && !/\/l\//.test(posters[vid]))) posters[vid] = url;
          }
        } catch (_e) {
          /* resource timing unavailable */
        }
        // The editor paints a paused background video as a plain <img> of its poster; read it
        // from the DOM too — the resource-timing buffer (250 entries) evicts it on long sessions.
        try {
          document.querySelectorAll('img[src*="video-public.canva.com"]').forEach((img) => {
            const m = String(img.currentSrc || img.src || "").match(
              /https:\/\/video-public\.canva\.com\/([^/]+)\/([pl])\/[^?#]+\.jpe?g/i
            );
            if (!m) return;
            const [url, vid, tier] = [m[0], m[1], m[2].toLowerCase()];
            if (!posters[vid] || (tier === "l" && !/\/l\//.test(posters[vid]))) posters[vid] = url;
          });
        } catch (_e) {
          /* ignore */
        }
        // The page's OWN fill — a colour and, optionally, a background image drawn over it. It is
        // not an LB element, so the DOM/element walk never sees it, and every page div reports
        // a transparent background-color; the server then guessed the page colour from the
        // snapshot and picked the frame's sage (#a9ab94) instead of the real cream (#efe9dc).
        // Observed shape: page.Vb.ctx.bxf[0] = { color, transparency, image: { media, xb,
        // transparency }, flipX, flipY }.
        // Observable-style model fields expose their value through get().
        const unwrapObservable = (v) => (v && typeof v.get === "function" ? v.get() : v);
        // The page's fill record, found by SHAPE rather than by key. The minified name rotates
        // between Canva deploys — `page.Vb.ctx.bxf[0]` on one, a plain `page.Ub[0]` array on the
        // next — and hardcoding one of them silently lost the whole page background: a design whose
        // background is a VIDEO imported as a still, with the page colour guessed from the snapshot.
        const looksLikePageFill = (value) =>
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          "transparency" in value &&
          ("color" in value || "image" in value || "video" in value);
        const findPageFillRecord = (obj) => {
          if (!obj || typeof obj !== "object") return null;
          for (const key of Object.keys(obj)) {
            let value;
            try {
              value = unwrapObservable(obj[key]);
            } catch (_e) {
              continue;
            }
            if (!value || typeof value !== "object") continue;
            if (Array.isArray(value)) {
              const first = unwrapObservable(value[0]);
              if (looksLikePageFill(first)) return first;
              continue;
            }
            // Older deploys nest it one level down as <key>.ctx.bxf[0].
            let nested = null;
            try {
              nested = value.ctx ? unwrapObservable(value.ctx.bxf) : null;
            } catch (_e) {
              nested = null;
            }
            if (Array.isArray(nested)) {
              const first = unwrapObservable(nested[0]);
              if (looksLikePageFill(first)) return first;
            }
          }
          return null;
        };
        const readPageFill = (obj) => {
          try {
            const fill = findPageFillRecord(obj);
            if (!fill || typeof fill !== "object") return null;
            const get = unwrapObservable;
            const color = String(get(fill.color) || "").trim();
            const img = fill.image && fill.image.media && typeof fill.image.media.id === "string" ? fill.image : null;
            const box = img ? findMediaDrawRect(img) : null;
            // Current model: a page background VIDEO is the fill's `video` slot — {video:"VA…",
            // xb placement rect (page px, may exceed the page), transparency, autoplay, volume}.
            // Older designs carried a per-scene clip ARRAY on the page object instead (see
            // findClipsOnPageObj); both feed the same __background contract.
            const vid =
              fill.video && typeof fill.video === "object" && typeof get(fill.video.video) === "string"
                ? fill.video
                : null;
            const vbox = vid ? findMediaDrawRect(vid) : null;
            return {
              color: /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color) ? color.toLowerCase() : "",
              transparency: Number(get(fill.transparency)) || 0,
              // The fill mirrors its media at the FILL level (a page photo flipped to put the
              // minaret on the left); the DOM transform never shows it, so it must ride here.
              flipX: Boolean(get(fill.flipX)),
              flipY: Boolean(get(fill.flipY)),
              durationUs: Number(get(fill.durationUs)) || 0,
              video: vid
                ? {
                    videoId: String(get(vid.video)),
                    transparency: Number(get(vid.transparency)) || 0,
                    // `rotation` (degrees) rides along like the image box's: a story whose landscape
                    // clip is turned 90° to fill the portrait page keeps its 2434×1387 rect rotated in
                    // the model — dropping it imported the clip lying sideways across the middle.
                    box:
                      vbox && typeof vbox === "object"
                        ? {
                            left: Number(vbox.left) || 0,
                            top: Number(vbox.top) || 0,
                            width: Number(vbox.width) || 0,
                            height: Number(vbox.height) || 0,
                            rotation: Number(vbox.rotation) || 0,
                          }
                        : null,
                  }
                : null,
              image: img
                ? {
                    mediaId: img.media.id,
                    transparency: Number(img.transparency) || 0,
                    box: box && typeof box === "object"
                      ? { left: Number(box.left) || 0, top: Number(box.top) || 0, width: Number(box.width) || 0, height: Number(box.height) || 0, rotation: Number(box.rotation) || 0 }
                      : null,
                  }
                : null,
            };
          } catch (_e) {
            return null;
          }
        };
        // One synthetic clip for a fill-slot video: the page's own duration is the clip length.
        const clipsFromFill = (fill, pageLike) => {
          if (!fill || !fill.video || !fill.video.videoId) return null;
          const pageDurationUs = Number(unwrapObservable(pageLike && pageLike.durationUs)) || 0;
          const durationUs = fill.durationUs > 0 ? fill.durationUs : pageDurationUs;
          return [
            {
              durationMs: Math.round(durationUs / 1000),
              color: fill.color || null,
              video: {
                videoId: fill.video.videoId,
                transparency: fill.video.transparency,
                rb: fill.video.box,
              },
            },
          ];
        };
        // A Canva page's own length. Unset on a page the author never re-timed, where Canva plays
        // it for its longest timed element (a 12.7 s animated sticker keeps the page at 0:12) and
        // never shorter than its nominal 5s (what the editor's 0:05 shows on an empty page).
        // (Page animation, page size and the page list come from the shared
        // canva-animation-extract block: readPageAnimation / readPageSize / listCanvaPages.)
        const readPageDurationMs = (obj, fillRecord, elements) => {
          try {
            const us = Number(unwrapObservable(obj && obj.durationUs));
            if (Number.isFinite(us) && us > 0) return Math.round(us / 1000);
            // A page whose background is a VIDEO runs for the video's length, which the model does
            // not state — the importer fills it in from the captured clip.
            if (fillRecord && fillRecord.video) return 0;
            return Math.max(5000, longestTimedElementEndMs(elements));
          } catch (_e) {
            return 5000;
          }
        };
        if (pageObj) {
          const livePages = listCanvaPages(doc);
          // Canva's page scheduler needs to know whether a page follows (its default page outro and
          // the last-page rule depend on it).
          if (livePages.length) result.__pageCount = livePages.length;
          // The walk finds a serialized copy of the page (same id, plain `elements` array) with no
          // live Vb.ctx.bxf — the fill only exists on the live page from doc.pages.
          const pageFill = readPageFill(livePages[0]) || readPageFill(pageObj);
          if (pageFill && (pageFill.color || pageFill.image || pageFill.video)) result.__pageFill = pageFill;
          const pageAnimation = readPageAnimation(livePages[0]) || readPageAnimation(pageObj);
          if (pageAnimation) result.__pageAnimation = pageAnimation;
          result.__pageDurationMs =
            readPageDurationMs(livePages[0], pageFill, result) ||
            readPageDurationMs(pageObj, pageFill, result);
          const pageDimensions = readPageSize(livePages[0]) || readPageSize(pageObj) || readPageSize(doc);
          if (pageDimensions) {
            result.__pageWidth = pageDimensions.width;
            result.__pageHeight = pageDimensions.height;
          }
          const outClips = findClipsOnPageObj(pageObj) || clipsFromFill(pageFill, livePages[0] || pageObj);
          if (outClips && outClips.some((c) => c.video)) {
            result.__background = { clips: outClips, posters };
          }
        }

        // ── Multi-page designs: per-page element maps ─────────────────────────────────────────────
        // doc.pages (when it is a real array with 2+ entries) holds one subtree per design page in
        // page order. Each subtree gets the same structural walk as the whole-doc pass: first
        // LB-element array = that page's paint-ordered elements; the object holding it = the page
        // object carrying the background clip track. Page 1's map ALSO stays merged at the result
        // top level so every single-page consumer keeps working unchanged.
        try {
          // doc.pages is an ARRAY on older Canva models but an iterable keyed COLLECTION
          // ({type, domain, ctx, cells, ...}) on current ones — spreading yields the page
          // objects ({id, elements, ...}) in page order. Map-like [key, page] pairs are
          // unwrapped for safety.
          let pagesArray = Array.isArray(doc.pages) ? doc.pages : null;
          if (
            !pagesArray &&
            doc.pages &&
            typeof doc.pages === "object" &&
            typeof doc.pages[Symbol.iterator] === "function"
          ) {
            try {
              pagesArray = [...doc.pages];
            } catch (_spreadError) {
              pagesArray = null;
            }
          }
          if (
            pagesArray &&
            pagesArray.length &&
            Array.isArray(pagesArray[0]) &&
            pagesArray[0].length === 2 &&
            pagesArray[0][1] &&
            typeof pagesArray[0][1] === "object"
          ) {
            pagesArray = pagesArray.map((entry) => entry[1]);
          }
          if (pagesArray && pagesArray.length > 1) {
            const findElementsArrayIn = (root) => {
              let found = null;
              const localSeen = new Set();
              (function walk(obj, depth) {
                if (found || !obj || typeof obj !== "object" || depth > 14 || localSeen.has(obj)) {
                  return;
                }
                localSeen.add(obj);
                if (Array.isArray(obj)) {
                  if (
                    obj.length &&
                    obj.some(
                      (it) => it && typeof it.id === "string" && /^LB/.test(it.id) && "animation" in it
                    )
                  ) {
                    found = obj;
                    return;
                  }
                  for (const it of obj) walk(it, depth + 1);
                } else {
                  for (const key in obj) {
                    try {
                      walk(obj[key], depth + 1);
                    } catch (_e) {
                      /* observable getters can throw */
                    }
                  }
                }
              })(root, 0);
              return found;
            };
            const findPageObjIn = (root) => {
              let found = null;
              const localSeen = new Set();
              (function walk(n, depth) {
                if (found || depth > 12 || !n || typeof n !== "object" || localSeen.has(n)) return;
                localSeen.add(n);
                if (!Array.isArray(n)) {
                  for (const k of Object.keys(n)) {
                    const v = n[k];
                    if (
                      Array.isArray(v) &&
                      v.length &&
                      v.some((it) => it && typeof it.id === "string" && /^LB/.test(it.id))
                    ) {
                      found = n;
                      return;
                    }
                  }
                }
                const keys = Array.isArray(n) ? [...n.keys()] : Object.keys(n);
                for (const k of keys) {
                  try {
                    walk(n[k], depth + 1);
                  } catch (_e) {
                    /* ignore */
                  }
                }
              })(root, 0);
              return found;
            };
            // Each page's elements come from the design's PLAIN snapshot (…CCf.pages[i], real arrays
            // all the way down — paths, fills, text cells), matched to the live page by id. The live
            // page objects hold observable collections instead, which every extractor here
            // (extractShape / extractVectorShape / extractBorder / extractText) can't read. The old
            // structural search from each LIVE page walked keys in order, and a current page lists
            // `audio` before `elements`: audio.tracks.ctx… climbs to that snapshot and lands on
            // pages[0].elements — so EVERY page got page 1's model. Page 2 of DAHPQGZn2Tw imported
            // page 1's title and line (model supplement), lost its own line, and its shapes fell back
            // to zoom-scaled DOM captures; page 1's clips and animation stood in for later pages'.
            const isPlainPage = (value) =>
              value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.elements);
            let plainPages = null;
            (function findPlainPages(obj, depth, seenSet) {
              if (plainPages || !obj || typeof obj !== "object" || depth > 16 || seenSet.has(obj)) return;
              seenSet.add(obj);
              if (Array.isArray(obj)) {
                if (
                  obj.length &&
                  obj.every(isPlainPage) &&
                  obj.some((page) => page.elements.some((it) => it && typeof it.id === "string" && /^LB/.test(it.id)))
                ) {
                  plainPages = obj;
                  return;
                }
                for (const it of obj) findPlainPages(it, depth + 1, seenSet);
                return;
              }
              for (const key in obj) {
                try {
                  findPlainPages(obj[key], depth + 1, seenSet);
                } catch (_e) {
                  /* observable getters can throw */
                }
                if (plainPages) return;
              }
            })(doc, 0, new Set());
            const plainPageFor = (pageRoot, pageIndex) => {
              if (!plainPages) return null;
              const id = pageRoot && typeof pageRoot.id === "string" ? pageRoot.id : "";
              const byId = id ? plainPages.find((page) => page.id === id) : null;
              if (byId) return byId;
              // Same page count and no ids to match on: the snapshot is in page order too.
              return plainPages.length === pagesArray.length ? plainPages[pageIndex] || null : null;
            };
            const pages = [];
            for (let pageIndex = 0; pageIndex < pagesArray.length; pageIndex += 1) {
              const pageRoot = pagesArray[pageIndex];
              const plainPage = plainPageFor(pageRoot, pageIndex);
              const pageElements = buildElementMap(plainPage ? plainPage.elements : findElementsArrayIn(pageRoot));
              // Clips live on the snapshot's page object; the fill only on the live page.
              const pageObjForPage = plainPage || findPageObjIn(pageRoot);
              const pageFillForPage = readPageFill(pageRoot) || readPageFill(pageObjForPage);
              const pageClips =
                findClipsOnPageObj(pageObjForPage) || clipsFromFill(pageFillForPage, pageRoot);
              pages.push({
                index: pageIndex,
                elements: pageElements,
                background:
                  pageClips && pageClips.some((c) => c.video)
                    ? { clips: pageClips, posters }
                    : null,
                fill: pageFillForPage,
                animation: readPageAnimation(pageRoot) || readPageAnimation(pageObjForPage),
                durationMs: readPageDurationMs(pageRoot, pageFillForPage, pageElements),
                ...(readPageSize(pageRoot) || readPageSize(pageObjForPage) || {}),
              });
            }
            if (pages.some((p) => Object.keys(p.elements).length > 0)) {
              result.__pages = pages;
            }
          }
        } catch (_pagesError) {
          /* best-effort */
        }
      } catch (_bgError) {
        /* best-effort */
      }
    } catch (_e) {
      /* fiber shape changed — best-effort */
    }
    return result;
  }

  // ── canva-timeline-seek:start
  // Seconds a timeline ruler label stands for: "10ث", "10s", "1:00", Eastern-Arabic digits too.
  // null for anything else.
  function timelineLabelSeconds(text) {
    const value = String(text || "")
      .trim()
      .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
      .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0));
    let match = value.match(/^(\d+):(\d{2})$/);
    if (match) return Number(match[1]) * 60 + Number(match[2]);
    match = value.match(/^(\d+(?:[.,]\d+)?)\s*[^\d\s:.,%]{0,4}$/);
    return match ? Number(match[1].replace(",", ".")) : null;
  }
  // The ruler's mapping from its labels ({ seconds, x } — a label starts at its tick): px per
  // second and the x of 0 s. Needs two labels at different times, in order along the ruler.
  function timelineRulerScale(labels) {
    const points = (Array.isArray(labels) ? labels : [])
      .filter((label) => Number.isFinite(label?.seconds) && Number.isFinite(label?.x))
      .sort((a, b) => a.seconds - b.seconds);
    if (points.length < 2) return null;
    const first = points[0];
    const last = points[points.length - 1];
    if (!(last.seconds > first.seconds)) return null;
    const pxPerSecond = (last.x - first.x) / (last.seconds - first.seconds);
    if (!(pxPerSecond > 0.5)) return null;
    return { pxPerSecond, originX: first.x - first.seconds * pxPerSecond };
  }
  // An ISO-8601 duration as Canva writes the playhead time on <time datetime>: "P7S", "P12.4S",
  // "PT1M5S". null when it is not one.
  function isoDurationSeconds(value) {
    const match = String(value || "").match(/^P(?:T)?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/);
    if (!match || (!match[1] && !match[2] && !match[3])) return null;
    return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
  }
  // ── canva-timeline-seek:end

  // Where to click Canva's timeline ruler to put the playhead on `targetSeconds` (viewport px), and
  // the <time datetime> values now (one of them is the playhead). Canva only mounts the elements
  // whose timeline window holds the playhead, so a capture at 0:00 misses everything that enters
  // later (DAHNZc5myOk: 30 of 35 elements). The ruler is found by its own second labels. The click
  // itself must be a trusted one AFTER a pointer move has settled: Canva seeks to the time its
  // hover tracking last rendered, not to the press position (synthetic presses seek to stale times).
  function canvaTimelinePoint(targetSeconds) {
    const times = Array.from(document.querySelectorAll("time[datetime]")).map((node) => node.getAttribute("datetime"));
    const seconds = times.map(isoDurationSeconds);
    if (targetSeconds === null || targetSeconds === undefined) return { ok: true, times, seconds };
    try {
      const hasPointerDown = (node) => {
        const key = Object.keys(node).find((name) => name.startsWith("__reactProps$"));
        return Boolean(key && node[key] && typeof node[key].onPointerDown === "function");
      };
      const rulers = new Map();
      document.querySelectorAll("p, span").forEach((leaf) => {
        if (leaf.children.length > 0) return;
        const seconds = timelineLabelSeconds(leaf.textContent);
        if (seconds === null) return;
        let ancestor = leaf.parentElement;
        for (let depth = 0; ancestor && depth < 6; depth += 1) {
          if (hasPointerDown(ancestor)) {
            const list = rulers.get(ancestor) || [];
            list.push({ seconds, x: leaf.getBoundingClientRect().left });
            rulers.set(ancestor, list);
            return;
          }
          ancestor = ancestor.parentElement;
        }
      });
      let ruler = null;
      let scale = null;
      rulers.forEach((labels, node) => {
        const candidate = timelineRulerScale(labels);
        if (candidate && (!ruler || labels.length > rulers.get(ruler).length)) {
          ruler = node;
          scale = candidate;
        }
      });
      if (!ruler || !scale) return { ok: false, reason: "no-ruler", times, seconds };
      const box = ruler.getBoundingClientRect();
      // A hair inside the ruler's left edge, so 0 s still lands on the ruler.
      const x = Math.max(box.left + 2, scale.originX + Math.max(0, Number(targetSeconds) || 0) * scale.pxPerSecond);
      if (x > box.right - 1) return { ok: false, reason: "off-ruler", times, seconds };
      return { ok: true, x, y: box.top + box.height / 2, times, seconds };
    } catch (error) {
      return { ok: false, reason: String(error && error.message ? error.message : error), times, seconds };
    }
  }

  // Expose for the read-back func, and eagerly stash this run's result so background.js can read it
  // off globalThis with a trivial (never-changing → cache-immune) func after this file is injected.
  try {
    globalThis.__canvaImporterTimelinePoint = canvaTimelinePoint;
  } catch (_e) {
    /* ignore */
  }
  try {
    globalThis.__canvaExtractFiberModel = extractCanvaFiberModel;
  } catch (_e) {
    /* ignore */
  }
  try {
    globalThis.__canvaFiberModelResult = extractCanvaFiberModel();
  } catch (_e) {
    globalThis.__canvaFiberModelResult = {};
  }
})();
