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
      const allElements = [];
      const collected = new Set();
      const collect = (items, depth) => {
        if (!Array.isArray(items) || depth > 10) return;
        for (const el of items) {
          if (!el || typeof el !== "object" || collected.has(el)) continue;
          collected.add(el);
          allElements.push(el);
          for (const key in el) {
            try {
              const val = el[key];
              if (Array.isArray(val) && val.some((it) => it && typeof it === "object" && "type" in it)) {
                collect(val, depth + 1);
              }
            } catch (_e) {
              /* ignore */
            }
          }
        }
      };
      collect(elementsArray, 0);

      // Canva custom "create an animation" motion paths are DELTA-encoded keyframe streams: a time
      // array (per-sample ms deltas, all ≥0, summing ≈ durationUs/1000) + x/y px delta arrays.
      // MINIFIED NAMES ROTATE BETWEEN CANVA DEPLOYS (observed: dts/eGd/gGd → dts/SGd/UGd), so the
      // arrays are identified STRUCTURALLY: time = the non-negative array whose sum best matches the
      // track duration; x/y = the remaining two by known-name priority, else alphabetical order.
      const decodeMotionPath = (track) => {
        try {
          if (!track || typeof track !== "object") return null;
          const arrays = Object.keys(track).filter(
            (k) => Array.isArray(track[k]) && track[k].length >= 2 && track[k].every((v) => Number.isFinite(Number(v)))
          );
          if (arrays.length < 2) return null;
          const durationMsTarget = Number(track.durationUs) > 0 ? Number(track.durationUs) / 1000 : null;
          const sums = {};
          for (const k of arrays) sums[k] = track[k].reduce((a, v) => a + (Number(v) || 0), 0);
          // time array: all non-negative; when several qualify, the one closest to the track duration
          let timeKey = null;
          let bestScore = Infinity;
          for (const k of arrays) {
            if (!track[k].every((v) => Number(v) >= 0)) continue;
            const score = durationMsTarget ? Math.abs(sums[k] - durationMsTarget) : -sums[k];
            if (score < bestScore) {
              bestScore = score;
              timeKey = k;
            }
          }
          if (!timeKey) return null;
          const rest = arrays.filter((k) => k !== timeKey);
          if (!rest.length) return null;
          const X_NAMES = ["eGd", "SGd"];
          const Y_NAMES = ["gGd", "UGd"];
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
          let t = 0;
          let x = 0;
          let y = 0;
          const raw = [];
          for (let i = 0; i < n; i += 1) {
            t += Number(dts[i]) || 0;
            x += Number(xs[i]) || 0;
            y += Number(ys ? ys[i] : 0) || 0;
            raw.push({ t: Math.round(t), x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
          }
          if (raw.length < 2) return null;
          let span = 0;
          for (const p of raw) span = Math.max(span, Math.abs(p.x), Math.abs(p.y));
          if (span < 2) return null;
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
      const extractAnimation = (el) => {
        const anim = el && el.animation;
        if (!anim || typeof anim !== "object") return null;
        // Track CONTAINER found structurally (was anim.Sv, now anim.Tv — names rotate): the first
        // object-valued prop whose children include a track ({durationUs > 0}).
        let container = null;
        for (const key of Object.keys(anim)) {
          const v = anim[key];
          if (!v || typeof v !== "object" || Array.isArray(v)) continue;
          for (const kk of Object.keys(v)) {
            const t = v[kk];
            if (t && typeof t === "object" && Number(t.durationUs) > 0) {
              container = v;
              break;
            }
          }
          if (container) break;
        }
        // classify tracks by SHAPE: ≥2 numeric arrays = keyframe/loop track; else plain duration
        // tracks — entrance/exit resolved by known names first (Wf=in; tf/sf=out), else by order.
        let inTrack = null;
        let outTrack = null;
        let kfCandidate = null;
        if (container) {
          const plain = [];
          for (const kk of Object.keys(container)) {
            const t = container[kk];
            if (!t || typeof t !== "object" || !(Number(t.durationUs) > 0)) continue;
            const arrayCount = Object.keys(t).filter((a) => Array.isArray(t[a]) && t[a].length >= 2).length;
            if (arrayCount >= 2) kfCandidate = t;
            else plain.push({ key: kk, track: t });
          }
          const inPlain = plain.find((p) => ["Wf", "in", "enter"].includes(p.key)) || plain[0] || null;
          const outPlain =
            plain.find((p) => ["tf", "sf", "out", "exit"].includes(p.key)) ||
            plain.find((p) => p !== inPlain) ||
            null;
          inTrack = inPlain ? inPlain.track : null;
          outTrack = outPlain && outPlain !== inPlain ? outPlain.track : null;
        }
        const motionPath = kfCandidate ? decodeMotionPath(kfCandidate) : null;
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
        const canvaPreset = Number.isFinite(Number(anim.animation)) ? Number(anim.animation) : null;
        if (canvaPreset === null && !mode && !motionPath) return null;
        return {
          canvaPreset,
          family: typeof anim.type === "string" ? anim.type : undefined,
          mode,
          inMs: inTrack ? usToMs(inTrack.durationUs) : undefined,
          outMs: outTrack ? usToMs(outTrack.durationUs) : undefined,
          loopMs: loopTrack ? usToMs(loopTrack.durationUs) : undefined,
          durationMs,
          delayMs: usToMs(el.startUs),
          easing: Number.isFinite(Number(easingRaw)) ? Number(easingRaw) : undefined,
          ...(motionPath ? { motionPath } : {}),
        };
      };
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
              for (const prop of ["color", "font-family", "font-size", "text-align", "direction"]) {
                if (merged[prop] === undefined && bag[prop] !== undefined) merged[prop] = bag[prop];
              }
            }
            style = {
              color: typeof merged.color === "string" ? merged.color : undefined,
              fontFamilyToken: typeof merged["font-family"] === "string" ? merged["font-family"] : undefined,
              fontSize: Number(merged["font-size"]) > 0 ? Number(merged["font-size"]) : undefined,
              textAlign: typeof merged["text-align"] === "string" ? merged["text-align"] : undefined,
              direction: typeof merged.direction === "string" ? merged.direction : undefined,
            };
          }
          return { plaintext, ...style };
        } catch (_e) {
          return null;
        }
      };
      const extractImage = (el) => {
        try {
          const img = el.fill && el.fill.image;
          const media = img && img.media;
          if (!media || typeof media.id !== "string") return null;
          const sb = img.sb && typeof img.sb === "object" ? img.sb : null;
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
          if (!(strokeColor && strokeWidth > 0) && !(cornerRadius > 0)) return null;
          // rectFrame: the frame is a PLAIN RECT path, so frame + radius + stroke are fully
          // reproducible by the editor (image cornerRadius/stroke props) — the rendered
          // snapshot is never needed for such layers (blob/circle frames stay false).
          const rectFrame = /^M0[ ,]0\s*H[\d.]+\s*V[\d.]+\s*H0\s*z?$/i.test(String(p0.d || "").trim());
          return { strokeColor, strokeWidth, cornerRadius, rectFrame };
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
      let zOrder = 0;
      for (const el of allElements) {
        const id = String((el && el.id) || "");
        if (!id || !/^LB/.test(id)) continue;
        result[id] = {
          zOrder: zOrder++,
          type: typeof el.type === "string" ? el.type : "",
          left: num(el.left),
          top: num(el.top),
          width: num(el.width),
          height: num(el.height),
          rotation: num(el.rotation),
          transparency: num(el.transparency),
          startUs: num(el.startUs),
          durationUs: num(el.durationUs),
          animation: extractAnimation(el),
          text: el.type === "text" ? extractText(el) : null,
          image: el.type === "rect" ? extractImage(el) : null,
          shape: el.type === "shape" ? extractShape(el) : null,
          line: el.type === "line" ? extractLine(el) : null,
          border: el.type === "shape" ? extractBorder(el) : null,
        };
      }

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
        if (pageObj) {
          let clips = null;
          for (const k of Object.keys(pageObj)) {
            const v = pageObj[k];
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
          if (clips) {
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
            if (outClips.some((c) => c.video)) {
              result.__background = { clips: outClips, posters };
            }
          }
        }
      } catch (_bgError) {
        /* best-effort */
      }
    } catch (_e) {
      /* fiber shape changed — best-effort */
    }
    return result;
  }

  // Expose for the read-back func, and eagerly stash this run's result so background.js can read it
  // off globalThis with a trivial (never-changing → cache-immune) func after this file is injected.
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
