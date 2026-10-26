(() => {
  async function canvaImporterGetCaptureMeta(runtimeOptions = {}) {
      const shouldCollectLayerMetadata = Boolean(runtimeOptions?.captureMetadata);
      const viewportCenter = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      };

      const isVisible = (element, rect) => {
        if (!element || !rect) return false;
        if (rect.width < 80 || rect.height < 80) return false;
        const style = window.getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) > 0.01
        );
      };
      // The 80px floor above is for page frames and image candidates; an SVG shape is real at any
      // size — the 45px-on-screen dashed connectors of DAHP1gDecK4 (and DAHP1vJ1HHw's) were
      // "invisible" to it and never got serialized, so their layers fell to solid rects.
      // ── canva-page-slice-gate:start
      // Whether a layer is on the page enough to import. A layer mostly outside the page used to
      // be dropped once under 20% of its own box showed — but Canva clips to the page, so what
      // matters is how much of the PAGE the slice covers: DAHR4D4QJR4's torn-paper strips hang
      // above and below the page and show only 17% / 6% of themselves, yet paint 11% / 4% of the
      // page (the white torn edges at its top and bottom). A slice worth 2% of the page is real.
      const layerShowsOnPage = ({ coverage, visibleArea, pageArea }) =>
        (Number(coverage) || 0) >= 0.2 ||
        ((Number(pageArea) || 0) > 0 && (Number(visibleArea) || 0) >= (Number(pageArea) || 0) * 0.02);
      // ── canva-page-slice-gate:end

      const isVisibleSvg = (element, rect) => {
        if (!element || !rect) return false;
        if (rect.width < 4 || rect.height < 4) return false;
        const style = window.getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) > 0.01
        );
      };

      const scoreRect = (rect) => {
        const area = rect.width * rect.height;
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const distance = Math.hypot(centerX - viewportCenter.x, centerY - viewportCenter.y);
        const normalizedDistance = distance / Math.max(window.innerWidth, window.innerHeight, 1);
        const centerBias = 1 - Math.min(normalizedDistance, 1) * 0.55;
        return area * centerBias;
      };

      const parsePx = (value) => {
        const match = String(value || "").match(/([0-9.]+)px/i);
        const numeric = Number(match?.[1]);
        return Number.isFinite(numeric) ? numeric : 0;
      };

      const parseStyleDimension = (styleText, key) => {
        const match = String(styleText || "").match(
          new RegExp(`${key}\\s*:\\s*([0-9.]+)px`, "i")
        );
        const numeric = Number(match?.[1]);
        return Number.isFinite(numeric) ? numeric : 0;
      };

      const sleep = (ms) =>
        new Promise((resolve) => {
          window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
        });

      const sanitizeMetadataText = (value) =>
        String(value || "").replace(/\s+/g, " ").trim();

      const uniqueMetadataStrings = (values) =>
        Array.from(
          new Set(
            (Array.isArray(values) ? values : [])
              .map((value) => sanitizeMetadataText(value))
              .filter(Boolean)
          )
        );

      const parseCssTimeToMs = (value) => {
        const firstToken = String(value || "")
          .split(",")
          .map((token) => token.trim())
          .find(Boolean);
        if (!firstToken) return 0;
        if (/ms$/i.test(firstToken)) {
          const numeric = Number.parseFloat(firstToken);
          return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
        }
        if (/s$/i.test(firstToken)) {
          const numeric = Number.parseFloat(firstToken);
          return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric * 1000)) : 0;
        }
        const numeric = Number.parseFloat(firstToken);
        return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
      };

      const normalizeAnimationLabel = (value) =>
        sanitizeMetadataText(String(value || "").replace(/[_-]+/g, " "));

      const mapAnimationHintToType = (rawValue) => {
        const value = normalizeAnimationLabel(rawValue).toLowerCase();
        if (!value) return null;
        const matchers = [
          { type: "NONE", label: "None", regex: /\b(none|no animation|instant|instant show|instant hide|hard cut|show hide)\b|بدون|بدون حركة/ },
          { type: "FADE", label: "Fade", regex: /\b(static|fade|fade in|fade out|dissolve|soft dissolve)\b|ثابت|تلاشي/ },
          { type: "RISE", label: "Rise", regex: /\b(rise)\b|ارتقاء|ارتفاع/ },
          { type: "PAN", label: "Pan", regex: /\b(pan|quick slide)\b|تأرجح|ترنح|انزلاق سريع/ },
          { type: "POP", label: "Pop", regex: /\b(pop|zoom|zoom in|zoom out)\b|انبثاق/ },
          { type: "BLOCK", label: "Block", regex: /\bblock\b|شريط/ },
          { type: "WIPE", label: "Wipe", regex: /\b(directional wipe|wipe|brush reveal)\b|المسح|اسحب الفرشاة/ },
          { type: "BLUR", label: "Blur", regex: /\b(blur|soft blur)\b|تمويه/ },
          { type: "SUCCESSION", label: "Succession", regex: /\b(succession|zoom fade)\b|التتابع/ },
          { type: "BREATHE", label: "Breathe", regex: /\b(breathe|slow reveal|photo zoom)\b|ظهور بطيء|تكبير الصورة/ },
          { type: "BASELINE", label: "Baseline", regex: /\b(baseline|bounce)\b|baseline|خط الأساس/ },
          { type: "DRIFT", label: "Drift", regex: /\b(drift|slide|slide in|slide out|image flow|slow motion)\b|انجراف|انسيابية الصورة|حركة بطيئة/ },
          // تموج (Ripple) is its own loop for us; nothing else in this list undulates.
          { type: "WAVE", label: "Wave", regex: /\b(ripple|wave)\b|تموج/ },
          { type: "TECTONIC", label: "Tectonic", regex: /\b(soft gradient wipe|wipe gradient|gradient wipe|tectonic)\b|حركة تكتونية/ },
          { type: "TUMBLE", label: "Tumble", regex: /\b(tumble|turn|radial sweep reveal|radial sweep|radial)\b|دوران/ },
          { type: "NEON", label: "Neon", regex: /\b(neon|soft circular reveal|circular fade)\b|نيون/ },
          { type: "SCRAPBOOK", label: "Scrapbook", regex: /\b(scrapbook)\b|سجل قصاصات/ },
          { type: "STOMP", label: "Stomp", regex: /\b(stomp|circular reveal|circular|aerial)\b|سقوط هوائي/ },
          { type: "ROTATE", label: "Rotate", regex: /\b(continuous rotation|rotation|spin|rotate)\b|تدوير/ },
          { type: "FLICKER", label: "Flicker", regex: /\b(flicker|old tv|chromatic)\b|ومض|التلفزيون القديم|موجة الانحراف اللوني/ },
          { type: "PULSE", label: "Pulse", regex: /\b(pulse|pulse zoom|shake zoom|squash and stretch|heart beat|heartbeat)\b|تقلص العنصر وتمدد|نبض|تكبير اهتزازي/ },
          { type: "WIGGLE", label: "Wiggle", regex: /\b(wiggle|directional shake|shake)\b|اهتزاز سريع|اهتزاز سريع بالاتجاه/ },
        ];
        return matchers.find((entry) => entry.regex.test(value)) || null;
      };

      const inferAnimationDirection = (values) => {
        const text = uniqueMetadataStrings(values).join(" ").toLowerCase();
        if (!text) return "";
        if (/\b(left|leftward)\b|يسار/.test(text)) return "LEFT";
        if (/\b(right|rightward)\b|يمين/.test(text)) return "RIGHT";
        if (/\b(top|up|upward)\b|أعلى|فوق/.test(text)) return "UP";
        if (/\b(bottom|down|downward)\b|أسفل|تحت/.test(text)) return "DOWN";
        if (/\b(counterclockwise|anti clockwise|anticlockwise)\b/.test(text)) return "COUNTERCLOCKWISE";
        if (/\b(clockwise)\b/.test(text)) return "CLOCKWISE";
        return "";
      };

      const inferAnimationMode = (values, isInfinite) => {
        if (isInfinite) return "LOOP";
        const text = uniqueMetadataStrings(values).join(" ").toLowerCase();
        if (/\b(out|exit|leave|disappear|hide|closing|close)\b/.test(text)) return "OUT";
        return "IN";
      };

      const collectAnimationHintStrings = (node, supplementalNodes = []) => {
        const results = [];
        const push = (value) => {
          const normalized = normalizeAnimationLabel(value);
          if (!normalized || normalized.length > 400) return;
          results.push(normalized);
        };
        const addNodeSignals = (candidate) => {
          if (!candidate) return;
          push(candidate.getAttribute?.("aria-label"));
          push(candidate.getAttribute?.("title"));
          push(candidate.getAttribute?.("data-element-name"));
          push(candidate.className);
          push(candidate.getAttribute?.("style"));
          if (candidate.attributes) {
            Array.from(candidate.attributes).forEach((attribute) => {
              const name = String(attribute?.name || "");
              if (!/(anim|motion|transition|enter|exit)/i.test(name)) return;
              push(`${name}:${attribute?.value || ""}`);
            });
          }
          if (candidate.dataset) {
            Object.entries(candidate.dataset).forEach(([key, value]) => {
              if (!/(anim|motion|transition|enter|exit)/i.test(key)) return;
              push(`${key}:${value || ""}`);
            });
          }
          try {
            const style = window.getComputedStyle(candidate);
            push(style.animationName);
            push(style.animationTimingFunction);
            push(style.transitionProperty);
          } catch (_error) {
            // Ignore style inspection failures on detached nodes.
          }
        };

        addNodeSignals(node);
        (Array.isArray(supplementalNodes) ? supplementalNodes : []).forEach((candidate) =>
          addNodeSignals(candidate)
        );
        let ancestor = node?.parentElement || null;
        let depth = 0;
        while (ancestor && depth < 2) {
          addNodeSignals(ancestor);
          ancestor = ancestor.parentElement;
          depth += 1;
        }
        return uniqueMetadataStrings(results);
      };

      const extractLayerAnimationMeta = (node, supplementalNodes = []) => {
        const inspectionNodes = [node, ...(Array.isArray(supplementalNodes) ? supplementalNodes : [])].filter(Boolean);
        const hintStrings = collectAnimationHintStrings(node, inspectionNodes);
        let matched = null;
        for (let index = 0; index < hintStrings.length; index += 1) {
          matched = mapAnimationHintToType(hintStrings[index]);
          if (matched) break;
        }

        let computedDurationMs = 0;
        let computedDelayMs = 0;
        let computedInfinite = false;
        let computedRawName = "";
        for (let index = 0; index < inspectionNodes.length; index += 1) {
          const candidate = inspectionNodes[index];
          try {
            const style = window.getComputedStyle(candidate);
            const animationName = String(style.animationName || "")
              .split(",")
              .map((token) => normalizeAnimationLabel(token))
              .find((token) => token && token.toLowerCase() !== "none");
            if (!computedRawName && animationName) {
              computedRawName = animationName;
            }
            if (!computedDurationMs) {
              computedDurationMs = parseCssTimeToMs(style.animationDuration);
            }
            if (!computedDelayMs) {
              computedDelayMs = parseCssTimeToMs(style.animationDelay);
            }
            if (!computedInfinite) {
              const iterationCount = String(style.animationIterationCount || "")
                .split(",")
                .map((token) => token.trim().toLowerCase())
                .find(Boolean);
              computedInfinite =
                iterationCount === "infinite" ||
                (Number.isFinite(Number(iterationCount)) && Number(iterationCount) > 1);
            }
            if (!matched && animationName) {
              matched = mapAnimationHintToType(animationName);
            }
          } catch (_error) {
            // Ignore computed-style failures.
          }
        }

        if (!matched && !computedRawName) {
          return null;
        }

        const rawAnimationName = computedRawName || hintStrings.find(Boolean) || "";
        const animationDirection = inferAnimationDirection([rawAnimationName, ...hintStrings]);
        return {
          animationType: matched?.type || "",
          animationLabel: matched?.label || normalizeAnimationLabel(rawAnimationName),
          rawAnimationName: normalizeAnimationLabel(rawAnimationName),
          animationMode: inferAnimationMode([rawAnimationName, ...hintStrings], computedInfinite),
          animationInfinite: computedInfinite,
          animationDurationMs: computedDurationMs > 0 ? computedDurationMs : undefined,
          animationDelayMs: computedDelayMs > 0 ? computedDelayMs : undefined,
          animationDirection: animationDirection || undefined,
        };
      };

      // Per-element animation config from Canva's LIVE design-document model, which hangs off the
      // React fiber. The rendered DOM layers are static (Canva animates in its own compositor), so
      // the ONLY reliable source is this model. Returns { [elementId]: { canvaPreset, family, mode,
      // inMs, outMs, loopMs, durationMs, delayMs, easing } } keyed by the SAME LB ids the layer
      // records use. Defensive: minified keys churn across Canva releases, so we walk by SHAPE
      // (structural search), never hardcoded keys, and return {} on any failure. Replaces the old
      // DOM-label-matching extractLayerAnimationMeta, which never fired (labels are obfuscated).
      const usToMs = (us) =>
        Number.isFinite(Number(us)) && Number(us) > 0 ? Math.round(Number(us) / 1000) : undefined;

      // Full per-element design model from Canva's LIVE document (hangs off the React fiber). This
      // is a SUPERSET of the DOM: a timeline/video design renders only the current frame's layers,
      // but the model holds ALL elements with geometry, text, image refs, and animation — the only
      // way to import a video design's complete layer set. Returns { [elementId]: { type, left, top,
      // width, height, rotation, transparency, startUs, durationUs, animation, text, image } } keyed
      // by the SAME LB ids the DOM layer records use, so model + DOM captures merge by id. Geometry
      // is in design px with the page top-left as origin — identical to the scraper's record space
      // (verified: model↔DOM scale == 1/zoom, model (0,0) == page origin). Defensive structural walk
      // (no hardcoded minified chains); returns {} on any failure.
      const buildFiberElementModel = () => {
        const result = {};
        try {
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
          // structural DFS for the elements array (items with an LB id + animation field)
          const seen = new Set();
          let elementsArray = null;
          const findElements = (obj, depth) => {
            if (elementsArray || !obj || typeof obj !== "object" || depth > 14 || seen.has(obj)) return;
            seen.add(obj);
            if (Array.isArray(obj)) {
              if (
                obj.length &&
                obj.some(
                  (it) => it && typeof it.id === "string" && /^LB/.test(it.id) && "animation" in it
                )
              ) {
                elementsArray = obj;
                return;
              }
              for (const it of obj) findElements(it, depth + 1);
            } else {
              for (const key in obj) {
                try {
                  findElements(obj[key], depth + 1);
                } catch (_error) {
                  /* observable getters can throw */
                }
              }
            }
          };
          findElements(doc, 0);
          if (!elementsArray) return result;
          // (groups are flattened by the shared collectCanvaElements, which also records each child's
          // group — see the canva-animation-extract block below)

          // Track container + track/array names are MINIFIED and ROTATE between Canva deploys
          // (observed: Sv→Tv, tf→sf, Acb→Lcb, eGd→SGd, gGd→UGd; Wf/dts survived one rotation).
          // Everything is therefore resolved STRUCTURALLY, mirroring background.js's
          // extractCanvaFiberModel — keep the two in sync.
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

          // Plaintext + run style from a text element's rich-text stream. Minified names ROTATE
          // between Canva deploys (style bag observed as j7→q7 / Pdb→Xdb), so both the run-strings
          // array and the style bag are resolved STRUCTURALLY; the style bag's INNER keys ("color",
          // "font-family", "font-size", …) are stable CSS-ish names. Mirrors background.js.
          const extractText = (el) => {
            try {
              const stream = el.text && el.text.stream;
              if (!stream) return null;
              let plaintext = "";
              const cells = stream.cells || {};
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
                // Mixed-script text splits into runs whose first run may lack font/size —
                // merge across ALL runs, first defined value per property wins.
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

          // Image media reference + in-frame crop from a rect's fill. media.id is shared across every
          // instance of the same image (Canva instances one media many times), so one rendered
          // instance resolves the pixels for all — each element supplies its own crop (fill.sb).
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

          // Corner radius of a shape path, in DESIGN px — minified numeric prop on the path
          // (observed `mb`); known name first, structural numeric fallback. 0 = sharp.
          const readPathCornerRadius = (p0) => {
            try {
              if (!p0 || typeof p0 !== "object") return 0;
              if (typeof p0.mb === "number" && Number.isFinite(p0.mb)) {
                return Math.max(0, Math.round(p0.mb));
              }
              for (const k of Object.keys(p0)) {
                const v = p0[k];
                if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
                  return Math.max(0, Math.round(v));
                }
              }
            } catch (_e) {
              /* ignore */
            }
            return 0;
          };
          // Simple solid-colour circle/rect Canva shapes → editable editor shapes (they render as
          // protected raster images in the DOM otherwise). Mirrors background.js's extractShape.
          const extractShape = (el) => {
            try {
              const paths = Array.isArray(el.paths) ? el.paths : null;
              if (!paths || paths.length !== 1) return null;
              const p0 = paths[0] || {};
              // Image-filled path = Canva photo-frame (clips a photo), NOT an editable shape.
              if (p0.fill && typeof p0.fill === "object" && p0.fill.image) return null;
              const d = String(p0.d || "").trim();
              let shapeKind = null;
              if (/^M0[ ,]0\s*H[\d.]+\s*V[\d.]+\s*H0\s*z?$/i.test(d)) shapeKind = "rect";
              else if (/A/.test(d) && !/[LlCcQqSsTtHhVv]/.test(d)) shapeKind = "circle";
              if (!shapeKind) return null;
              // Solid fill AND/OR an outline stroke (frames/pills/dividers are stroke-only).
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
          // Border + corner radius for an image-filled shape (Canva photo-frame).
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
              // rectFrame: plain rect frame → editor reproduces frame+radius+stroke exactly;
              // rendered snapshot never needed.
              const rectFrame = /^M0[ ,]0\s*H[\d.]+\s*V[\d.]+\s*H0\s*z?$/i.test(d);
              // circleFrame: an arc-only path is Canva's round photo frame — a true ELLIPSE inscribed
              // in the box, a circle only when that box is square. The editor reproduces it via
              // `mediaShape: "circle"` at any aspect, so the layer keeps its clean fetched asset
              // instead of the isolation snapshot (which has no alpha outside the mask, and so
              // came back as an opaque rectangle with the page baked into its corners).
              const circleFrame = !rectFrame && /A/.test(d) && !/[LlCcQqSsTtHhVv]/.test(d);
              if (!(strokeColor && strokeWidth > 0) && !(cornerRadius > 0) && !circleFrame) return null;
              return { strokeColor, strokeWidth, cornerRadius, rectFrame, circleFrame };
            } catch (_e) {
              return null;
            }
          };
          // Drop shadow: found STRUCTURALLY (the array keys are minified and rotate between
          // deploys) via the stable "shadow" id + "drop-shadow" type. offset/blur are design px
          // 1:1, angle is anticlockwise from +x with y pointing down, alpha = 1 - transparency.
          // See the canonical, commented copy in canva-fiber-main.js.
          const hexToRgba = (hex, alpha) => {
            const raw = String(hex || "").trim().replace(/^#/, "");
            const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
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
          // Rebuild a non-simple shape (arch / blob / gradient fill) as an SVG — Canva renders
          // these as protected rasters, and a screenshot crop has no alpha so the silhouette is
          // lost. See the canonical, commented copy in canva-fiber-main.js.
          const svgColor = (color, transparency) => {
            const hex = typeof color === "string" ? color.trim() : "";
            if (!hex) return null;
            let t = Number(transparency) || 0;
            if (t > 1) t /= 100;
            return { hex, alpha: Math.max(0, Math.min(1, 1 - t)) };
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
                : `<linearGradient id="${gradientId}" x1="${line.x1}" y1="${line.y1}" x2="${line.x2}" y2="${line.y2}">${stops.join("")}</linearGradient>`;
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
              // An image-filled path is a photo frame — keep the photo (extractBorder handles it). So
              // is a VIDEO-filled one (see canva-fiber-main.js).
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
          // Recover Canva 'line' dividers (thin strokes the DOM gate drops) from the model.
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
                Number(el.weight) > 0
                  ? Number(el.weight)
                  : Number(el.height) > 0
                    ? Number(el.height)
                    : 1;
              return { color, weight: Math.max(1, Math.round(weight)) };
            } catch (_e) {
              return null;
            }
          };

          const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
          // zOrder: Canva's element array order IS the paint order (index 0 = bottom). Stamped
          // EXPLICITLY because the model crosses executeScript arg serialization, which SORTS
          // object keys alphabetically — Object.keys() insertion order does NOT survive it.
          let zOrder = 0;
          for (const { el, parentId } of collectCanvaElements(elementsArray)) {
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
              // parentId, raw startUs / durationUs (undefined stays undefined), animation facts —
              // the shared canva-animation-extract block, identical in all three walks.
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
              vector: el.type === "shape" && !extractShape(el) ? extractVectorShape(el) : null,
              shadow: extractShadow(el),
            };
          }
          // The page facts Canva's scheduler reads (docs §8.5): the page animation + config, its
          // length, its size and how many pages the design has.
          try {
            const livePages = listCanvaPages(doc);
            const firstPage = livePages[0] || null;
            const pageAnimation = readPageAnimation(firstPage);
            if (pageAnimation) result.__pageAnimation = pageAnimation;
            const pageDurationUs = readPageDurationUs(firstPage);
            if (pageDurationUs) result.__pageDurationMs = Math.round(pageDurationUs / 1000);
            else {
              // An un-timed page runs for its longest timed element (never under the nominal 5s,
              // which the consumers already assume when this stays unset).
              const longestMs = longestTimedElementEndMs(result);
              if (longestMs > 5000) result.__pageDurationMs = longestMs;
            }
            const pageSize = readPageSize(firstPage) || readPageSize(doc);
            if (pageSize) {
              result.__pageWidth = pageSize.width;
              result.__pageHeight = pageSize.height;
            }
            if (livePages.length) result.__pageCount = livePages.length;
          } catch (_pageError) {
            /* best-effort */
          }
        } catch (_error) {
          /* fiber shape changed — best-effort, return whatever we have */
        }
        return result;
      };

      const normalizeMetadataKey = (value) =>
        sanitizeMetadataText(value)
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s]+/gu, " ")
          .replace(/\s+/g, " ")
          .trim();

      const tokenizeMetadataLabel = (value) =>
        uniqueMetadataStrings(
          normalizeMetadataKey(value)
            .split(/\s+/)
            .filter((token) => token.length >= 2)
        );

      const getImageElementTitleHint = (element) => {
        if (!element) return "";
        return sanitizeMetadataText(
          element.getAttribute?.("alt") ||
            element.getAttribute?.("aria-label") ||
            element.getAttribute?.("title") ||
            ""
        );
      };

      const looksLikeDecorativeFrameLabel = (value) =>
        /\b(frame|border)\b/.test(
          sanitizeMetadataText(value)
            .toLowerCase()
        );

      const isVisibleDomElement = (element) => {
        if (!element || typeof element.getBoundingClientRect !== "function") return false;
        const rect = element.getBoundingClientRect();
        if (!rect || rect.width < 2 || rect.height < 2) return false;
        const style = window.getComputedStyle(element);
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) > 0.01
        );
      };

      const isKeywordChipButton = (element) => {
        if (!element) return false;
        const text = sanitizeMetadataText(element.textContent || "");
        if (!text || text.length < 2 || text.length > 40) return false;
        const aria = sanitizeMetadataText(
          element.getAttribute?.("aria-label") ||
            element.getAttribute?.("title") ||
            ""
        ).toLowerCase();
        const className = sanitizeMetadataText(element.className || "").toLowerCase();
        return (
          aria.includes("الكلمة الرئيسية") ||
          aria.includes("keyword") ||
          className.includes("chip") ||
          className.includes("tag")
        );
      };

      const isKeywordExpandToggle = (element) => {
        if (!element) return false;
        const text = sanitizeMetadataText(
          element.textContent || element.getAttribute?.("aria-label") || element.getAttribute?.("title") || ""
        ).toLowerCase();
        if (!text) return false;
        const mentionsKeywords =
          text.includes("keyword") ||
          text.includes("keywords") ||
          text.includes("كلمات رئيسية") ||
          text.includes("الكلمات الرئيسية");
        const wantsMore =
          text.includes(" more") ||
          text.startsWith("more") ||
          text.includes("show all") ||
          text.includes("all keywords") ||
          text.includes("عرض كل") ||
          text.includes("كل الكلمات") ||
          text.includes("المزيد") ||
          text.includes("أكثر");
        const wantsLess =
          text.includes(" less") ||
          text.includes("fewer") ||
          text.includes("show fewer") ||
          text.includes("show less") ||
          text.includes("عرض أقل") ||
          text.includes("أقل");
        return mentionsKeywords && wantsMore && !wantsLess;
      };

      const expandVisibleCanvaKeywordList = async () => {
        const toggle = Array.from(document.querySelectorAll("button,[role='button']")).find(
          (candidate) => isVisibleDomElement(candidate) && isKeywordExpandToggle(candidate)
        );
        if (!toggle) return false;
        toggle.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
          })
        );
        await sleep(180);
        return true;
      };

      const findMetadataContainerForChip = (element) => {
        let current = element?.parentElement || null;
        let depth = 0;
        let best = null;
        let bestCount = 0;
        while (current && depth < 8) {
          const visibleKeywordButtons = Array.from(
            current.querySelectorAll("button,[role='button']")
          ).filter((candidate) => isVisibleDomElement(candidate) && isKeywordChipButton(candidate));
          const hasHeading = Array.from(current.querySelectorAll("h1,h2,h3,h4")).some(
            (heading) =>
              isVisibleDomElement(heading) &&
              sanitizeMetadataText(heading.textContent).length >= 3
          );
          if (visibleKeywordButtons.length >= 2 && hasHeading) {
            if (visibleKeywordButtons.length >= bestCount) {
              best = current;
              bestCount = visibleKeywordButtons.length;
            }
          }
          current = current.parentElement;
          depth += 1;
        }
        return best;
      };

      const scrapeVisibleCanvaAssetMetadata = () => {
        const keywordButtons = Array.from(document.querySelectorAll("button,[role='button']"))
          .filter((candidate) => isVisibleDomElement(candidate) && isKeywordChipButton(candidate));
        if (keywordButtons.length === 0) return null;

        const containers = new Map();
        keywordButtons.forEach((button) => {
          const container = findMetadataContainerForChip(button);
          if (!container) return;
          const existing = containers.get(container) || [];
          existing.push(button);
          containers.set(container, existing);
        });

        const selected =
          Array.from(containers.entries())
            .map(([container, buttons]) => ({ container, buttons }))
            .sort((left, right) => right.buttons.length - left.buttons.length)[0] || null;
        if (!selected) return null;

        const titleNode = Array.from(selected.container.querySelectorAll("h1,h2,h3,h4")).find(
          (heading) =>
            isVisibleDomElement(heading) &&
            sanitizeMetadataText(heading.textContent).length >= 3
        );
        const titleEn = sanitizeMetadataText(titleNode?.textContent || "");
        const tagsEn = uniqueMetadataStrings(
          selected.buttons
            .map((button) => sanitizeMetadataText(button.textContent || ""))
            .filter((value) => value.length >= 2)
        );

        if (!titleEn && tagsEn.length === 0) return null;

        return {
          titleEn,
          tagsEn,
          labelsEn: uniqueMetadataStrings([titleEn, ...tagsEn, ...tokenizeMetadataLabel(titleEn)]),
        };
      };

      const dispatchSyntheticLayerClick = (node) => {
        if (!node || typeof node.dispatchEvent !== "function") return;
        const rect = node.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        const pointTarget = document.elementFromPoint?.(clientX, clientY);
        const target =
          (pointTarget && node.contains(pointTarget) ? pointTarget : null) ||
          node.querySelector?.("img,image,canvas") ||
          node;
        ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
          target.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
              clientX,
              clientY,
            })
          );
        });
      };

      const dispatchSyntheticContextMenu = (node) => {
        if (!node || typeof node.dispatchEvent !== "function") return;
        const rect = node.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        const pointTarget = document.elementFromPoint?.(clientX, clientY);
        const target =
          (pointTarget && node.contains(pointTarget) ? pointTarget : null) ||
          node.querySelector?.("img,image,canvas") ||
          node;
        ["pointerdown", "mousedown", "contextmenu", "mouseup"].forEach((type) => {
          target.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
              clientX,
              clientY,
              button: 2,
              buttons: type === "mouseup" ? 0 : 2,
            })
          );
        });
      };

      const findVisibleEditorActionButtonNearNode = (node) => {
        if (!node || typeof node.getBoundingClientRect !== "function") return null;
        const rect = node.getBoundingClientRect();
        let best = null;
        let bestScore = Number.POSITIVE_INFINITY;
        Array.from(document.querySelectorAll("button,[role='button']")).forEach((candidate) => {
          if (!isVisibleDomElement(candidate)) return;
          if (candidate === node || node.contains(candidate) || candidate.contains(node)) return;
          const candidateRect = candidate.getBoundingClientRect?.();
          if (!candidateRect || candidateRect.width <= 0 || candidateRect.height <= 0) return;
          if (candidateRect.width < 18 || candidateRect.width > 80) return;
          if (candidateRect.height < 18 || candidateRect.height > 80) return;
          const verticalDistance =
            candidateRect.bottom < rect.top
              ? rect.top - candidateRect.bottom
              : candidateRect.top > rect.bottom
                ? candidateRect.top - rect.bottom
                : 0;
          const horizontalDistance =
            candidateRect.right < rect.left
              ? rect.left - candidateRect.right
              : candidateRect.left > rect.right
                ? candidateRect.left - rect.right
                : 0;
          if (verticalDistance > 180 || horizontalDistance > 180) return;
          const iconLike =
            sanitizeMetadataText(candidate.textContent || "").length <= 2 ||
            Boolean(candidate.querySelector?.("svg"));
          if (!iconLike) return;
          const score = verticalDistance * 4 + horizontalDistance;
          if (score < bestScore) {
            best = candidate;
            bestScore = score;
          }
        });
        return best;
      };

      const openVisibleCanvaMetadataForNode = async (node) => {
        if (!node) return false;
        if (scrapeVisibleCanvaAssetMetadata()) return true;
        dispatchSyntheticContextMenu(node);
        await sleep(220);
        await expandVisibleCanvaKeywordList();
        if (scrapeVisibleCanvaAssetMetadata()) return true;
        const actionButton = findVisibleEditorActionButtonNearNode(node);
        if (actionButton) {
          if (typeof actionButton.click === "function") {
            actionButton.click();
          }
          actionButton.dispatchEvent(
            new MouseEvent("click", {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
            })
          );
          await sleep(320);
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await expandVisibleCanvaKeywordList();
            if (scrapeVisibleCanvaAssetMetadata()) return true;
            await sleep(200);
          }
        }
        return false;
      };

      const isBackgroundLikeMetadataCandidate = (candidate, pageWidth, pageHeight) => {
        if (!candidate) return true;
        if (candidate.isBackgroundNode || candidate.isFullPageBackground) return true;
        const width = Math.max(1, Number(candidate.width || 0));
        const height = Math.max(1, Number(candidate.height || 0));
        const pageArea = Math.max(1, Number(pageWidth || 0) * Number(pageHeight || 0));
        const areaRatio = (width * height) / pageArea;
        return areaRatio >= 0.8 || (width >= pageWidth * 0.9 && height >= pageHeight * 0.9);
      };

      const metadataMatchesCandidate = (metadata, candidate) => {
        if (!metadata || !candidate) return false;
        const metadataTitle = normalizeMetadataKey(metadata.titleEn);
        const candidateName = normalizeMetadataKey(candidate.name);
        if (!metadataTitle || !candidateName) return false;
        if (metadataTitle === candidateName) return true;
        if (metadataTitle.includes(candidateName) || candidateName.includes(metadataTitle)) return true;
        const metadataTokens = new Set(tokenizeMetadataLabel(metadataTitle));
        const candidateTokens = tokenizeMetadataLabel(candidateName);
        if (metadataTokens.size === 0 || candidateTokens.length === 0) return false;
        const shared = candidateTokens.filter((token) => metadataTokens.has(token)).length;
        return shared >= Math.max(1, Math.min(metadataTokens.size, candidateTokens.length) - 1);
      };

      const collectCanvaLayerMetadata = async (candidates, pageWidth, pageHeight) => {
        const byId = new Map();
        const pending = (Array.isArray(candidates) ? candidates : []).filter(
          (candidate) =>
            candidate &&
            candidate.kind === "image" &&
            candidate.node &&
            !isBackgroundLikeMetadataCandidate(candidate, pageWidth, pageHeight)
        );
        if (pending.length === 0) return byId;

        await expandVisibleCanvaKeywordList();
        const visibleMetadata = scrapeVisibleCanvaAssetMetadata();
        if (visibleMetadata) {
          const matchedCandidate = pending.find((candidate) =>
            metadataMatchesCandidate(visibleMetadata, candidate)
          );
          if (matchedCandidate) {
            byId.set(matchedCandidate.id, visibleMetadata);
          }
        }

        const maxMetadataScrapes = Math.min(18, pending.length);
        for (let index = 0; index < maxMetadataScrapes; index += 1) {
          const candidate = pending[index];
          if (byId.has(candidate.id)) continue;
          dispatchSyntheticLayerClick(candidate.node);
          await sleep(180);
          await openVisibleCanvaMetadataForNode(candidate.node);
          await expandVisibleCanvaKeywordList();
          let scraped = null;
          for (let attempt = 0; attempt < 4; attempt += 1) {
            scraped = scrapeVisibleCanvaAssetMetadata();
            if (scraped && (scraped.tagsEn.length > 0 || scraped.titleEn)) break;
            await sleep(120);
          }
          if (!scraped) continue;
          if (!metadataMatchesCandidate(scraped, candidate) && scraped.tagsEn.length === 0) continue;
          byId.set(candidate.id, scraped);
        }

        return byId;
      };

      const parseComputedTransform = (transformText = "") => {
        const value = String(transformText || "").trim();
        if (!value || value === "none") {
          return { angle: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, hasReflection: false };
        }
        try {
          const matrix = new DOMMatrixReadOnly(value);
          const a = Number(matrix.a) || 0;
          const b = Number(matrix.b) || 0;
          const c = Number(matrix.c) || 0;
          const d = Number(matrix.d) || 0;
          const magnitudeX = Math.hypot(a, b);
          const safeScaleX = magnitudeX > 0.000001 ? magnitudeX : 1;
          const determinant = a * d - b * c;
          let signedScaleY = determinant / safeScaleX;
          if (!Number.isFinite(signedScaleY) || Math.abs(signedScaleY) < 0.000001) {
            const magnitudeY = Math.hypot(c, d);
            signedScaleY = magnitudeY > 0.000001 ? magnitudeY : 1;
          }
          const angle = (Math.atan2(b, a) * 180) / Math.PI;
          const flipX = false;
          const flipY = signedScaleY < 0;
          return {
            angle,
            scaleX: Math.max(0.001, safeScaleX),
            scaleY: Math.max(0.001, Math.abs(signedScaleY)),
            flipX,
            flipY,
            hasReflection: flipX !== flipY,
          };
        } catch (_error) {
          return { angle: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false, hasReflection: false };
        }
      };

      // ── canva-style-transform:start
      const parseStyleTransform = (styleText = "") => {
        const source = String(styleText || "");
        const translateMatch = source.match(
          /translate\(\s*([-0-9.e]+)px\s*,\s*([-0-9.e]+)px\s*\)/i
        );
        const rotateMatch = source.match(/rotate\(\s*([-0-9.e]+)deg\s*\)/i);
        return {
          hasTranslate: Boolean(translateMatch),
          x: Number.isFinite(Number(translateMatch?.[1])) ? Number(translateMatch[1]) : 0,
          y: Number.isFinite(Number(translateMatch?.[2])) ? Number(translateMatch[2]) : 0,
          // `hasAngle` says a rotate() is WRITTEN, not that the element turns: Canva's first wrapper
          // inside every picture carries `rotate(0deg)`. Ask inlineRotationIsMeaningful for the turn.
          hasAngle: Boolean(rotateMatch),
          angle: Number.isFinite(Number(rotateMatch?.[1])) ? Number(rotateMatch[1]) : 0,
        };
      };
      // Whether an inline transform really turns the element. Reading `hasAngle` alone marked every
      // picture in DAHYoZnBs9Y rotated (its `rotate(0deg)` wrapper), which forced each one down to a
      // design-size screen crop — the 800 px timeline dots came back as 33 px smudges.
      const inlineRotationIsMeaningful = (inlineTransform) =>
        Boolean(inlineTransform?.hasAngle) && Math.abs(Number(inlineTransform.angle || 0)) > 0.2;
      // ── canva-style-transform:end

      const rectArea = (rect) => Math.max(0, Number(rect?.width || 0)) * Math.max(0, Number(rect?.height || 0));

      const intersectRects = (a, b) => {
        if (!a || !b) return null;
        const left = Math.max(Number(a.left ?? a.x ?? 0), Number(b.left ?? b.x ?? 0));
        const top = Math.max(Number(a.top ?? a.y ?? 0), Number(b.top ?? b.y ?? 0));
        const right = Math.min(
          Number((a.left ?? a.x ?? 0) + (a.width ?? 0)),
          Number((b.left ?? b.x ?? 0) + (b.width ?? 0))
        );
        const bottom = Math.min(
          Number((a.top ?? a.y ?? 0) + (a.height ?? 0)),
          Number((b.top ?? b.y ?? 0) + (b.height ?? 0))
        );
        const width = Math.max(0, right - left);
        const height = Math.max(0, bottom - top);
        if (width < 1 || height < 1) return null;
        return {
          x: left,
          y: top,
          left,
          top,
          width,
          height,
          right,
          bottom,
        };
      };

      const getTransformedViewportRect = (element, frameRect) => {
        if (!element || !frameRect) return null;
        const rawRect = element.getBoundingClientRect();
        const intersection = intersectRects(rawRect, {
          left: frameRect.x,
          top: frameRect.y,
          width: frameRect.width,
          height: frameRect.height,
        });
        if (!intersection) return null;
        const rawArea = rectArea(rawRect);
        const visibleArea = rectArea(intersection);
        const coverage = rawArea > 0 ? visibleArea / rawArea : 0;
        return {
          x: intersection.x,
          y: intersection.y,
          width: intersection.width,
          height: intersection.height,
          rawRect,
          rawArea,
          visibleArea,
          coverage,
        };
      };

      const getEffectiveOpacity = (element, stopAtNode) => {
        let opacity = 1;
        let node = element;
        let depth = 0;
        const currentLayerNode = element?.closest?.('[id^="LB"]') || null;
        while (node && node !== stopAtNode && depth < 12) {
          const style = window.getComputedStyle(node);
          const localOpacity = Number(style.opacity);
          if (Number.isFinite(localOpacity)) {
            opacity *= localOpacity;
          }
          node = node.parentElement;
          if (
            node &&
            currentLayerNode &&
            node !== currentLayerNode &&
            String(node.id || "").trim().startsWith("LB")
          ) {
            break;
          }
          depth += 1;
        }
        return Math.max(0, Math.min(opacity, 1));
      };

      const getCompositeScaleToAncestor = (element, stopAtNode) => {
        let scaleX = 1;
        let scaleY = 1;
        let node = element;
        let depth = 0;
        while (node && node !== stopAtNode && depth < 16) {
          const style = window.getComputedStyle(node);
          const parsed = parseComputedTransform(style.transform);
          scaleX *= Number(parsed?.scaleX || 1);
          scaleY *= Number(parsed?.scaleY || 1);
          node = node.parentElement;
          depth += 1;
        }
        return {
          x: Math.max(0.01, scaleX),
          y: Math.max(0.01, scaleY),
        };
      };

      // How far Canva nudges a text's glyphs down inside its own box, in the node's px (= design
      // px). Some fonts get an inner translateY that neither the font size nor the box carries —
      // UKIJ Chiwer Kesme sits 0.1 em lower: translate(0, 12.504px) at 125.04px, inside a
      // scale(1.764) wrapper, so 22 px on a 220 px title. Each translation lives in its PARENT's
      // space, so it is scaled by every scale above it, walking from the node inwards.
      const getInnerTextShiftY = (element, stopAtNode) => {
        const chain = [];
        let current = element;
        let depth = 0;
        while (current && current !== stopAtNode && depth < 16) {
          chain.push(current);
          current = current.parentElement;
          depth += 1;
        }
        if (current !== stopAtNode) return 0;
        let shiftY = 0;
        let scaleAbove = 1;
        for (let index = chain.length - 1; index >= 0; index -= 1) {
          const style = window.getComputedStyle(chain[index]);
          // The same nudge as a relative offset: DAHMphBrpuo's font YADK4JElWZc_0 sits 0.124 em
          // lower through `position: relative; top: 6.944px` on its <p> at 56px — 73 px on the
          // 590 px monogram, 13 px on the names — which the transforms alone never showed. The
          // offset lives in the parent's space, like a translation, so it takes the same scale.
          if (style.position === "relative") {
            const relativeTop = Number.parseFloat(style.top);
            if (Number.isFinite(relativeTop) && /px$/.test(String(style.top))) shiftY += relativeTop * scaleAbove;
          }
          const value = style.transform;
          if (!value || value === "none") continue;
          let matrix = null;
          try {
            matrix = new DOMMatrixReadOnly(value);
          } catch (_error) {
            continue;
          }
          // Only an upright wrapper's own vertical offset counts; a rotated or skewed inner
          // element (curved letters live BELOW the paragraph anyway) is not a font nudge.
          if (Math.abs(matrix.b) > 1e-6 || Math.abs(matrix.c) > 1e-6) return 0;
          shiftY += matrix.f * scaleAbove;
          scaleAbove *= Math.abs(matrix.d) || 1;
        }
        return Math.abs(shiftY) >= 0.5 ? Math.round(shiftY * 100) / 100 : 0;
      };

      // ── canva-player-copy:start
      // Canva's animation PLAYER draws its own copy of every element, under the same LB id, once a
      // design with motion has played — and in a live tab that copy is what the page holds. Its
      // geometry is the current animation FRAME, not the design: the page zoom moves INSIDE the
      // element (its first wrapper carries scale(zoom)), the element's own px are SCREEN px and its
      // own transform is the frame (Breathe = scale 0.9 → 1.03, a fade on opacity). DAHNZYYmqNA,
      // read like an editing copy, brought every text in at the zoom (45.33 px → 12.14 at 27%) and
      // every Breathe layer 6% too big (that frame's scale).
      // How many design px one px of a layer's own (pre-transform) space is: the layer's PARENT's
      // screen scale times the design scale. 1 for an editing copy (the page zoom sits above it);
      // snapped to exactly 1 within 2% so editing copies keep their numbers bit-for-bit.
      const layerUnitsToDesign = (parentScreenScale, designScale) => {
        const units = (Number(parentScreenScale) || 1) * (Number(designScale) || 1);
        return Number.isFinite(units) && units > 0 && Math.abs(units - 1) > 0.02 ? units : 1;
      };
      // A player copy's resting box in design px: the design model's own frame (exact — the model
      // is never animated), taken to page space through its groups like the model passes do; else
      // the captured frame box with the frame's own scale taken out around its centre.
      const playerCopyRestBox = ({ model, modelById, captured, frameScaleX, frameScaleY }) => {
        const finite = (value) => Number.isFinite(Number(value));
        if (model && finite(model.left) && finite(model.top) && Number(model.width) > 0 && Number(model.height) > 0) {
          let dx = 0;
          let dy = 0;
          let parent = model.parentId && modelById ? modelById[String(model.parentId)] : null;
          let hops = 0;
          let reachable = true;
          while (parent && hops < 8) {
            if (Math.abs(Number(parent.rotation) || 0) > 0.5) {
              reachable = false;
              break;
            }
            dx += Number(parent.left) || 0;
            dy += Number(parent.top) || 0;
            parent = parent.parentId ? modelById[String(parent.parentId)] : null;
            hops += 1;
          }
          if (reachable) {
            return {
              x: Number(model.left) + dx,
              y: Number(model.top) + dy,
              width: Number(model.width),
              height: Number(model.height),
              fromModel: true,
            };
          }
        }
        if (!captured) return null;
        const sx = Number(frameScaleX) > 0.01 ? Number(frameScaleX) : 1;
        const sy = Number(frameScaleY) > 0.01 ? Number(frameScaleY) : 1;
        const width = captured.width / sx;
        const height = captured.height / sy;
        return {
          x: captured.x + captured.width / 2 - width / 2,
          y: captured.y + captured.height / 2 - height / 2,
          width,
          height,
          fromModel: false,
        };
      };
      // ── canva-player-copy:end

      // Screen scale of an element's coordinate space: every transform from it to the document.
      const getScreenScale = (element) => {
        let scaleX = 1;
        let scaleY = 1;
        let current = element;
        let depth = 0;
        while (current && current.nodeType === 1 && depth < 80) {
          const parsed = parseComputedTransform(window.getComputedStyle(current).transform);
          scaleX *= Number(parsed?.scaleX || 1);
          scaleY *= Number(parsed?.scaleY || 1);
          current = current.parentElement;
          depth += 1;
        }
        return { x: scaleX, y: scaleY };
      };

      // Whether the page zoom (`zoom`, ≈ 1 / units) sits on a wrapper INSIDE the layer — the player
      // copy's signature (its first wrapper, a few levels down for photos). Nested layers are not
      // entered: their own wrappers are theirs.
      const zoomSitsInsideLayer = (layerNode, zoom) => {
        if (!layerNode || !(zoom > 0)) return false;
        let level = Array.from(layerNode.children || []);
        for (let depth = 0; depth < 5 && level.length; depth += 1) {
          const next = [];
          for (const child of level) {
            if (/^LB/.test(String(child.id || ""))) continue;
            const parsed = parseComputedTransform(window.getComputedStyle(child).transform);
            const scale = Number(parsed?.scaleY || 1);
            if (Math.abs(scale - zoom) <= zoom * 0.02 && Math.abs(scale - 1) > 0.02) return true;
            next.push(...Array.from(child.children || []));
          }
          level = next.slice(0, 200);
        }
        return false;
      };

      const hasMeaningfulTransformBetween = (element, stopAtNode) => {
        let node = element?.parentElement || null;
        let depth = 0;
        while (node && node !== stopAtNode && depth < 12) {
          const styleText = node.getAttribute?.("style") || "";
          const computedStyle = window.getComputedStyle(node);
          const computedTransform = parseComputedTransform(computedStyle.transform || styleText);
          const inlineTransform = parseStyleTransform(styleText);
          const hasMeaningfulScale =
            Math.abs(Number(computedTransform.scaleX || 1) - 1) > 0.02 ||
            Math.abs(Number(computedTransform.scaleY || 1) - 1) > 0.02;
          const hasMeaningfulAngle =
            Math.abs(Number(computedTransform.angle || 0)) > 0.2 ||
            inlineRotationIsMeaningful(inlineTransform);
          if (
            hasMeaningfulScale ||
            hasMeaningfulAngle ||
            Boolean(computedTransform.flipX) ||
            Boolean(computedTransform.flipY) ||
            Boolean(computedTransform.hasReflection)
          ) {
            return true;
          }
          node = node.parentElement;
          depth += 1;
        }
        return false;
      };

      // Like hasMeaningfulTransformBetween but IGNORES pure scale. A rectangular crop
      // that merely zooms/pans the photo inside its frame is faithfully reproducible
      // from the original asset cropped to the visible rect, so scale alone must NOT
      // force the rendered snapshot. Rotation / flip / reflection still must.
      const hasRotationOrFlipBetween = (element, stopAtNode) => {
        let node = element?.parentElement || null;
        let depth = 0;
        while (node && node !== stopAtNode && depth < 12) {
          const styleText = node.getAttribute?.("style") || "";
          const computedStyle = window.getComputedStyle(node);
          const computedTransform = parseComputedTransform(computedStyle.transform || styleText);
          const inlineTransform = parseStyleTransform(styleText);
          const hasMeaningfulAngle =
            Math.abs(Number(computedTransform.angle || 0)) > 0.2 || inlineRotationIsMeaningful(inlineTransform);
          if (
            hasMeaningfulAngle ||
            Boolean(computedTransform.flipX) ||
            Boolean(computedTransform.flipY) ||
            Boolean(computedTransform.hasReflection)
          ) {
            return true;
          }
          node = node.parentElement;
          depth += 1;
        }
        return false;
      };

      const getNumericZIndex = (element, stopAtNode) => {
        let best = null;
        let node = element;
        let depth = 0;
        while (node && node !== stopAtNode && depth < 12) {
          const style = window.getComputedStyle(node);
          const numeric = Number(style.zIndex);
          if (Number.isFinite(numeric)) {
            best = best === null ? numeric : Math.max(best, numeric);
          }
          node = node.parentElement;
          depth += 1;
        }
        return best;
      };

      const getImageElementSource = (imageElement) => {
        if (!imageElement) return "";
        const xlinkNs = "http://www.w3.org/1999/xlink";
        const candidates = [
          imageElement.currentSrc,
          imageElement.src,
          imageElement.getAttribute?.("src"),
          imageElement.getAttribute?.("href"),
          imageElement.getAttribute?.("xlink:href"),
          imageElement.getAttributeNS?.(xlinkNs, "href"),
          imageElement.href?.baseVal,
          imageElement.href?.animVal,
        ];
        // An <img src=""> reflects the DOCUMENT's URL in `.src`: the editor page, never a picture
        // (DAHNlFf3ad4's not-yet-loaded arch posters came through as www.canva.com/design/…/edit).
        const pageUrl = String(window.location?.href || "").split("#")[0];
        for (let index = 0; index < candidates.length; index += 1) {
          const normalized = normalizeAssetUrl(candidates[index]);
          if (normalized && (!pageUrl || normalized.split("#")[0] !== pageUrl)) return normalized;
        }
        return "";
      };

      // ── canva-paragraph-repeats:start
      // Whether a text's paragraphs are all genuine lines: each sits on its own spot. Canva's hidden
      // second copy of a paragraph block lands exactly on top of the first, so a repeated line in a
      // DIFFERENT place is real — DAHQBfoqED4's price column is ten "$4.25" rows 16 px apart, and
      // the duplicate filter below collapsed it to one. Takes [{top, left, height}] (rounded px).
      const paragraphsAreDistinctRows = (rects) => {
        const list = Array.isArray(rects) ? rects : [];
        if (list.length < 2) return false;
        if (!list.every((rect) => rect && Number(rect.height) > 0)) return false;
        const seen = new Set();
        for (const rect of list) {
          const key = `${Math.round(Number(rect.top))}|${Math.round(Number(rect.left))}|${Math.round(Number(rect.height))}`;
          if (seen.has(key)) return false;
          seen.add(key);
        }
        return true;
      };
      // ── canva-paragraph-repeats:end

      const dedupeTextLines = (value, options = {}) => {
        const rawLines = String(value || "")
          .split("\n")
          .map((line) => line.replace(/\s+/g, " ").trim());
        const lines = rawLines.filter(Boolean);
        if (lines.length === 0) return "";

        const shortLineCount = lines.filter((line) => line.length <= 2).length;
        const isCharacterStack =
          lines.length >= 4 && shortLineCount / Math.max(1, lines.length) >= 0.7;
        if (isCharacterStack) {
          // Curved text arrives one <p> per LETTER — and its word gaps as whitespace-only rows.
          // Dropping the blank rows before joining fused "HAPPY UAE NATIONAL DAY" into one word,
          // so a blank row between letters is the space it was.
          return rawLines
            .map((line) => (line === "" ? " " : line))
            .join("")
            .replace(/\s+/g, " ")
            .trim();
        }

        // Canva renders a text box's paragraphs more than once inside the same LB node (two
        // hidden logical copies of every <p>), so querySelectorAll("p") hands back the whole
        // paragraph block twice, back to back. Consecutive-line dedupe never sees that — the
        // repeat starts four lines later — and a four-line greeting imported as eight. When the
        // sequence is an exact repetition of its own prefix, keep one copy.
        const collapseRepeatedBlock = (items) => {
          for (let period = 1; period <= items.length / 2; period += 1) {
            if (items.length % period !== 0) continue;
            let repeats = true;
            for (let index = period; index < items.length && repeats; index += 1) {
              if (items[index] !== items[index % period]) repeats = false;
            }
            if (repeats) return items.slice(0, period);
          }
          return items;
        };

        // Every paragraph on its own row: repeats are content, keep them all.
        if (options.keepRepeats) return lines.join("\n");

        const deduped = [];
        collapseRepeatedBlock(lines).forEach((line) => {
          if (deduped[deduped.length - 1] !== line) {
            deduped.push(line);
          }
        });
        return deduped.join("\n");
      };

      const parseFontWeight = (value) => {
        const numeric = Number(String(value || "").replace(/[^\d]/g, ""));
        if (Number.isFinite(numeric) && numeric > 0) return numeric;
        return String(value || "").toLowerCase().includes("bold") ? 700 : 400;
      };

      const normalizeFontStyle = (value) => {
        const source = String(value || "").trim().toLowerCase();
        if (!source) return "normal";
        if (source.includes("italic") || source.includes("oblique") || source.includes("slant")) {
          return "italic";
        }
        return "normal";
      };

      const parseFontFaceWeightRange = (value) => {
        const source = String(value || "").trim().toLowerCase();
        if (!source) return { min: 400, max: 400 };
        if (source === "normal") return { min: 400, max: 400 };
        if (source === "bold") return { min: 700, max: 700 };
        const numericParts = source
          .split(/[\s,]+/)
          .map((part) => Number.parseInt(part.replace(/[^\d]/g, ""), 10))
          .filter((part) => Number.isFinite(part) && part > 0);
        if (numericParts.length === 1) {
          const valueWeight = numericParts[0];
          return { min: valueWeight, max: valueWeight };
        }
        if (numericParts.length >= 2) {
          const first = numericParts[0];
          const second = numericParts[1];
          return first <= second ? { min: first, max: second } : { min: second, max: first };
        }
        return { min: 400, max: 400 };
      };

      const GENERIC_FONT_FAMILIES = new Set([
        "sans-serif",
        "serif",
        "monospace",
        "cursive",
        "fantasy",
        "system-ui",
        "ui-sans-serif",
        "ui-serif",
        "ui-monospace",
        "emoji",
        "math",
        "fangsong",
      ]);

      // Canva draws every letter a text's font lacks with its own fallback family `_fb_` — for Arabic
      // that is Noto Sans Arabic (same advances, ascent 1.37 em, descent 0.74 em; measured against
      // our library copy). A Latin-only font on an Arabic line therefore SHOWS Noto in Canva, while
      // our editor and the app would each fall back to a different system font (Geeza Pro, Noto
      // Naskh, SF Arabic): an Arimo label that wrapped after four words in Canva wrapped after five
      // in the editor. Test it where the font is loaded: when the family has no Arabic glyphs,
      // "family, _fb_" and "_fb_" alone draw the very same letters. No spaces in the sample — a
      // Latin font does have a space, and it would differ.
      const ARABIC_LETTER_PATTERN = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
      const ARABIC_COVERAGE_SAMPLE = "\u0627\u0628\u062a\u062b\u062c\u062d\u062e\u062f\u0630\u0631\u0632\u0633\u0634\u0635\u0636\u0637\u0638\u0639\u063a\u0641\u0642\u0643\u0644\u0645\u0646\u0647\u0648\u064a";
      const arabicCoverageCache = new Map();
      let arabicCoverageContext = null;
      const fontLacksArabicGlyphs = (cssFontFamily, fontWeight, fontStyle) => {
        const family =
          String(cssFontFamily || "").split(",")[0]?.replace(/^['"]+|['"]+$/g, "").trim() || "";
        if (!family || family === "_fb_" || GENERIC_FONT_FAMILIES.has(family.toLowerCase())) return false;
        const key = `${family}|${fontWeight}|${fontStyle}`;
        if (arabicCoverageCache.has(key)) return arabicCoverageCache.get(key);
        let lacks = false;
        try {
          // Only a LOADED face can be tested: an unloaded one draws everything in the fallback.
          const loaded = Array.from(document.fonts || []).some(
            (face) => String(face.family || "").replace(/^['"]+|['"]+$/g, "") === family && face.status === "loaded"
          );
          const prefix = `${String(fontStyle || "") === "italic" ? "italic " : ""}${fontWeight || 400} 40px`;
          const quotedFamily = `"${family.replace(/"/g, "")}"`;
          // …and it must be the CUT this text uses. "Some face of the family is loaded" let a family
          // whose 400 was loaded while its 700 still downloaded measure the 700 sample entirely in
          // `_fb_` — so it "lacked" Arabic, the answer was cached, and every Arabic text of
          // DAHP7rbsCzc ("RTL-Adam Script" 700) was swapped to Noto Sans Arabic. Not ready yet:
          // keep the font, ask for the cut, and leave the answer uncached for the next text.
          let cutReady = false;
          try {
            cutReady = loaded && document.fonts.check(`${prefix} ${quotedFamily}`, ARABIC_COVERAGE_SAMPLE);
          } catch (_error) {
            cutReady = false;
          }
          if (loaded && !cutReady) {
            try {
              document.fonts.load(`${prefix} ${quotedFamily}`, ARABIC_COVERAGE_SAMPLE).catch(() => {});
            } catch (_error) {
              /* best effort */
            }
            return false;
          }
          if (loaded) {
            arabicCoverageContext = arabicCoverageContext || document.createElement("canvas").getContext("2d");
            arabicCoverageContext.font = `${prefix} ${quotedFamily}, _fb_`;
            const withFamily = arabicCoverageContext.measureText(ARABIC_COVERAGE_SAMPLE).width;
            arabicCoverageContext.font = `${prefix} _fb_`;
            const fallbackOnly = arabicCoverageContext.measureText(ARABIC_COVERAGE_SAMPLE).width;
            lacks = withFamily > 0 && Math.abs(withFamily - fallbackOnly) < 0.01;
          }
        } catch (_error) {
          lacks = false;
        }
        arabicCoverageCache.set(key, lacks);
        return lacks;
      };

      // The same question for LATIN letters, asked per text. A display font drawn for Arabic often
      // has no a–z, and Canva then draws them with `_fb_`'s Latin face — Noto Sans: HS Headline's
      // "www.nayroz.com" measured 899 px in Canva's own stack, 899 in `_fb_` alone and 776 in HS
      // Headline alone, and Noto Sans Bold sits within 0.15% of `_fb_`. Our editor and app have no
      // `_fb_`, so they fell back to their own default — a serif. Measured where the fonts are
      // loaded: a character the family lacks renders identically in "family, _fb_" and "_fb_", and
      // in "family, monospace" and "monospace". True only when EVERY letter and digit of the text
      // falls back (HS Headline does carry digits and dots); a mixed text keeps its family.
      const textFallsBackToCanvaLatin = (cssFontFamily, fontWeight, fontStyle, text) => {
        const family =
          String(cssFontFamily || "").split(",")[0]?.replace(/^['"]+|['"]+$/g, "").trim() || "";
        if (!family || family === "_fb_" || GENERIC_FONT_FAMILIES.has(family.toLowerCase())) return false;
        const characters = [
          ...new Set(Array.from(String(text || "")).filter((character) => /[A-Za-z0-9\u00C0-\u024F]/.test(character))),
        ];
        if (!characters.length) return false;
        try {
          arabicCoverageContext = arabicCoverageContext || document.createElement("canvas").getContext("2d");
          const context = arabicCoverageContext;
          const prefix = `${String(fontStyle || "") === "italic" ? "italic " : ""}${fontWeight || 400} 40px`;
          const quoted = `"${family.replace(/"/g, "")}"`;
          const sample = characters.join("");
          // An unloaded face measures as whatever comes next, which would prove nothing.
          if (!document.fonts.check(`${prefix} ${quoted}`, sample) || !document.fonts.check(`${prefix} _fb_`, sample)) {
            return false;
          }
          context.fontKerning = "none";
          const width = (font, value) => {
            context.font = font;
            return context.measureText(value).width;
          };
          return characters.every(
            (character) =>
              Math.abs(width(`${prefix} ${quoted}, _fb_`, character) - width(`${prefix} _fb_`, character)) < 0.01 &&
              Math.abs(width(`${prefix} ${quoted}, monospace`, character) - width(`${prefix} monospace`, character)) < 0.01
          );
        } catch (_error) {
          return false;
        }
      };

      // Canva's own line breaks, as the range of box widths that reproduce them in OUR renderers.
      // Canva lays text out with kerning and the liga/clig/calt features OFF and draws the letters a
      // font lacks with `_fb_`; the editor (Konva) and the app measure with kerning ON and draw the
      // whole text in the family the import stores (Noto Sans Arabic when the Canva font has no
      // Arabic). Same box, different line widths: an 819 px paragraph Canva broke 1.7 px before
      // "القهوة." pulled that word up onto the line above in the editor. So each of Canva's lines is
      // measured here the way our renderers measure (canvas measureText, default kerning, the stored
      // family) and the import is told
      //   min — the widest line: any narrower box breaks one of Canva's lines;
      //   max — the narrowest "line + space + next line's first word": any wider box joins two.
      // Both in em of the font size, so they hold through any later rescale of the text. Only plain
      // single-style text Canva soft-wrapped at spaces gets a range; anything else → null and the
      // import keeps its usual box.
      let wrapMeasureContext = null;
      // ── canva-glyph-lines:start
      // Rendered lines in logical order from per-glyph client rects. A new line starts where the
      // glyph box's TOP moves (every glyph of one line shares its inline box, so their tops agree
      // to a hair), or where the paragraph changes (a hard break — words never wrap across it).
      // It used to start where the glyph box's middle dropped by half the box's height, which
      // never fires when the box is taller than the line pitch: FS Albert Arabic's inline box is
      // two em tall while its lines sit 1.1 em apart, so a three-line paragraph on DAHFEg4hhOk
      // measured as two lines and its wrap range came out double (box 1088 px for a 541 px text).
      const groupGlyphsIntoLines = (chars) => {
        const lines = [];
        let pendingHardBreak = false;
        for (const item of chars) {
          const last = lines[lines.length - 1];
          if (item.hardBreak) {
            pendingHardBreak = true;
            continue;
          }
          const newBlock = Boolean(last) && item.block !== last.block;
          const movedDown =
            Boolean(last) &&
            (Number.isFinite(item.top) && Number.isFinite(last.top)
              ? Math.abs(item.top - last.top) > Math.max(1.5, Math.min(last.h, item.h) * 0.05)
              : item.mid - last.mid > Math.max(2, Math.min(last.h, item.h) * 0.5));
          if (!last || pendingHardBreak || newBlock || movedDown) {
            if (last) last.hardBreak = pendingHardBreak || newBlock;
            lines.push({ text: item.ch, top: item.top, mid: item.mid, h: item.h, block: item.block, hardBreak: false });
            pendingHardBreak = false;
          } else {
            last.text += item.ch;
          }
        }
        return lines;
      };
      // ── canva-glyph-lines:end

      // ── canva-laid-wrap:start
      // Canva lays some texts out with its OWN engine: every line a `white-space: nowrap` span, the
      // wraps drawn as <br>, and the space at a wrap dropped from the page (DAHMphBrpuo's
      // "قاعات الفرح" — one line in Canva's model, two on its page, though the browser would fit
      // it on one). The page alone can't tell such a wrap from a line break the author typed, so
      // measureTextWrapRange hands those breaks over as `pending` and this decides them against
      // the model's plaintext once it is known: whitespace there = a soft wrap (its "line + next
      // word" bounds the range), a newline = a hard break (no bound), nothing = a break inside a
      // word (no range at all). `afterLetters` counts the non-whitespace characters up to the break.
      const resolveCanvaLaidWrapRange = (pending, modelText) => {
        if (!pending || typeof modelText !== "string") return null;
        const breaks = Array.isArray(pending.breaks) ? pending.breaks : [];
        let max =
          pending.maxEm != null && Number(pending.maxEm) > 0 ? Number(pending.maxEm) : Number.POSITIVE_INFINITY;
        let softBreaks = Number(pending.softBreaks) || 0;
        const characters = Array.from(modelText);
        for (const item of breaks) {
          let letters = 0;
          let index = 0;
          while (index < characters.length && letters < item.afterLetters) {
            if (!/\s/.test(characters[index])) letters += 1;
            index += 1;
          }
          if (letters < item.afterLetters) return null;
          let gap = "";
          while (index < characters.length && /\s/.test(characters[index])) {
            gap += characters[index];
            index += 1;
          }
          if (!gap) return null;
          if (/[\r\n\u2028\u2029]/.test(gap)) continue;
          max = Math.min(max, Number(item.joinEm));
          softBreaks += 1;
        }
        const min = Number(pending.minEm);
        if (!softBreaks || !(min > 0) || !(max > min) || !Number.isFinite(max)) return null;
        return { minEm: min, maxEm: max, lines: pending.lines };
      };
      // ── canva-laid-wrap:end

      const measureTextWrapRange = (layerNode, text, lacksArabic) => {
        try {
          if (!layerNode) return null;
          // A Latin font on mixed Latin + Arabic keeps its own family, and every renderer then
          // falls back to a different system Arabic font: nothing to measure against.
          if (lacksArabic && /[A-Za-z]/.test(String(text || ""))) return null;
          const styleKey = (s) => `${s.fontFamily}|${s.fontSize}|${s.fontWeight}|${s.fontStyle}|${s.letterSpacing}`;
          // The letters' own style: the first visible run sets it, every other run must match. (A
          // paragraph's <p> can say 400 while every span in it is 700.)
          let glyphStyle = null;

          const chars = [];
          const range = document.createRange();
          // One copy of the paragraphs. A gradient-coloured text is laid out twice (an invisible copy
          // for layout and a second one carrying the gradient paint) — both copies' letters in one
          // walk would merge into a single impossible line.
          const paragraphs = Array.from(layerNode.querySelectorAll(TEXT_BLOCK_SELECTOR));
          const firstCopy = paragraphs.filter((paragraph) => paragraph.parentElement === paragraphs[0]?.parentElement);
          const walkers = (firstCopy.length ? firstCopy : [layerNode]).map((root) =>
            document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          );
          const nextTextNode = () => {
            while (walkers.length) {
              const next = walkers[0].nextNode();
              if (next) return next;
              walkers.shift();
            }
            return null;
          };
          let textNode = nextTextNode();
          while (textNode) {
            const data = String(textNode.data || "");
            const parent = textNode.parentElement;
            let checkedStyle = false;
            for (let index = 0; parent && index < data.length; ) {
              const size = data.codePointAt(index) > 0xffff ? 2 : 1;
              const ch = data.slice(index, index + size);
              range.setStart(textNode, index);
              range.setEnd(textNode, index + size);
              const rect = Array.from(range.getClientRects()).find((candidate) => candidate.height > 0);
              if (ch === "\n") {
                chars.push({ ch, hardBreak: true });
              } else if (rect) {
                if (!checkedStyle) {
                  // Mixed sizes / families / spacing: one font string cannot measure it.
                  const parentStyle = window.getComputedStyle(parent);
                  if (!glyphStyle) glyphStyle = parentStyle;
                  else if (styleKey(parentStyle) !== styleKey(glyphStyle)) return null;
                  checkedStyle = true;
                }
                chars.push({
                  ch,
                  top: rect.top,
                  mid: rect.top + rect.height / 2,
                  h: rect.height,
                  block: parent.closest(`${TEXT_BLOCK_SELECTOR},li`),
                });
              }
              index += size;
            }
            textNode = nextTextNode();
          }

          const lines = groupGlyphsIntoLines(chars);
          if (lines.length < 2 || !glyphStyle) return null;
          const fontSizeCss = Number.parseFloat(glyphStyle.fontSize || "") || 0;
          if (!(fontSizeCss > 0)) return null;
          if (String(glyphStyle.textTransform || "none") !== "none") return null;
          if (parseNumericPx(glyphStyle.wordSpacing || "") !== 0) return null;
          if (/^pre$/.test(String(glyphStyle.whiteSpace || ""))) return null;
          // nowrap = Canva's own line layout (see resolveCanvaLaidWrapRange): its breaks are <br>s.
          const canvaLaidOut = /^nowrap$/.test(String(glyphStyle.whiteSpace || ""));
          const letterSpacingCss = parseNumericPx(glyphStyle.letterSpacing || "");

          const families = lacksArabic
            ? ["_fb_"]
            : String(glyphStyle.fontFamily || "")
                .split(",")
                .map((family) => family.trim().replace(/^['"]+|['"]+$/g, ""))
                .filter((family) => family && !/^(auto|inherit|initial|unset)$/i.test(family));
          if (!families.length) return null;
          wrapMeasureContext = wrapMeasureContext || document.createElement("canvas").getContext("2d");
          const context = wrapMeasureContext;
          if (!context) return null;
          context.font = "10px sans-serif";
          context.font = `${glyphStyle.fontStyle === "italic" ? "italic " : ""}${glyphStyle.fontWeight || 400} ${fontSizeCss}px ${families
            .map((family) => (GENERIC_FONT_FAMILIES.has(family.toLowerCase()) ? family : `"${family.replace(/"/g, "")}"`))
            .join(", ")}`;
          if (!String(context.font).includes(families[0])) return null;
          // Konva and the app keep the browser's / platform's default kerning.
          context.fontKerning = "auto";
          if ("letterSpacing" in context) context.letterSpacing = `${letterSpacingCss || 0}px`;
          else if (letterSpacingCss) return null;
          const measure = (value) => context.measureText(value).width / fontSizeCss;

          let min = 0;
          let max = Number.POSITIVE_INFINITY;
          let softBreaks = 0;
          const pendingBreaks = [];
          let lettersSoFar = 0;
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const body = line.text.trim();
            lettersSoFar += line.text.replace(/\s+/g, "").length;
            if (!body) continue;
            min = Math.max(min, measure(body));
            const next = lines[index + 1];
            if (!next || line.hardBreak) continue;
            const nextWord = next.text.trim().split(/\s+/)[0];
            if (!/\s$/.test(line.text) && !/^\s/.test(next.text)) {
              // A break inside a word (an over-long word Canva split) has no space to wrap at —
              // unless Canva laid the line out itself and dropped the space: the model decides.
              if (!canvaLaidOut || !nextWord) return null;
              pendingBreaks.push({ afterLetters: lettersSoFar, joinEm: measure(`${body} ${nextWord}`) });
              continue;
            }
            if (!nextWord) continue;
            max = Math.min(max, measure(`${body} ${nextWord}`));
            softBreaks += 1;
          }
          if (pendingBreaks.length) {
            return {
              pending: {
                minEm: Math.round(min * 1e5) / 1e5,
                maxEm: Number.isFinite(max) ? Math.round(max * 1e5) / 1e5 : null,
                softBreaks,
                lines: lines.length,
                breaks: pendingBreaks.map((item) => ({ ...item, joinEm: Math.round(item.joinEm * 1e5) / 1e5 })),
              },
            };
          }
          if (!softBreaks || !(max > min)) return null;
          return {
            minEm: Math.round(min * 1e5) / 1e5,
            maxEm: Math.round(max * 1e5) / 1e5,
            lines: lines.length,
          };
        } catch (_error) {
          return null;
        }
      };

      // ── canva-text-gradient:start
      // Canva paints a gradient text colour as an SVG image clipped to the glyphs
      // (`background-clip: text`): <svg viewBox width height> holding one linear/radial gradient
      // that fills a rect over the viewBox, drawn at the paragraph's background-position. The
      // editor and the app paint a gradient over the text BOX instead (src/lib/editor/textFill.ts):
      // an angle, and stops along the ramp from the box centre out to its farthest corners. So the
      // SVG's user space is mapped into the box's content coordinates, each Canva stop lands where
      // its point falls on that ramp, and the ends are clipped to 0..1 with the colour Canva shows
      // there. Pure (string + numbers in, plain object out) so the test can run it as shipped.
      //   layout: { width, height } content box, { bgX, bgY } background-position (px),
      //   { originOffsetX, originOffsetY } content-box offset from the background origin,
      //   { imageWidth, imageHeight } drawn image size, or null for the SVG's own size.
      const canvaTextGradientToFill = (svgText, layout) => {
        const svg = String(svgText || "");
        const attr = (tag, name) => {
          const match = String(tag || "").match(new RegExp(`\\s${name}\\s*=\\s*(['"])(.*?)\\1`, "i"));
          return match ? match[2].trim() : null;
        };
        const styleProp = (tag, name) => {
          const style = attr(tag, "style") || "";
          const match = style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i"));
          return match ? match[1].trim() : null;
        };
        const toHex = (value) => {
          const raw = String(value || "").trim().toLowerCase();
          if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
          if (/^#[0-9a-f]{3}$/.test(raw)) return `#${raw.slice(1).split("").map((d) => d + d).join("")}`;
          const rgb = raw.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
          if (!rgb) return "";
          return `#${rgb.slice(1, 4).map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))).toString(16).padStart(2, "0")).join("")}`;
        };
        const width = Number(layout?.width);
        const height = Number(layout?.height);
        if (!(width > 0) || !(height > 0)) return null;

        const svgTag = (svg.match(/<svg\b[^>]*>/i) || [])[0];
        const gradientTag = (svg.match(/<(linear|radial)Gradient\b[^>]*>/i) || [])[0];
        if (!svgTag || !gradientTag) return null;
        const radial = /^<radial/i.test(gradientTag);
        const viewBox = String(attr(svgTag, "viewBox") || "").split(/[\s,]+/).map(Number);
        const hasViewBox = viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0;
        const [vbX, vbY, vbW, vbH] = hasViewBox ? viewBox : [0, 0, Number(attr(svgTag, "width")), Number(attr(svgTag, "height"))];
        if (!(vbW > 0) || !(vbH > 0)) return null;
        const drawnWidth = Number(layout.imageWidth) > 0 ? Number(layout.imageWidth) : Number(attr(svgTag, "width")) || vbW;
        const drawnHeight = Number(layout.imageHeight) > 0 ? Number(layout.imageHeight) : Number(attr(svgTag, "height")) || vbH;
        const scaleX = drawnWidth / vbW;
        const scaleY = drawnHeight / vbH;
        const toBox = (point) => ({
          x: (point.x - vbX) * scaleX + (Number(layout.bgX) || 0) - (Number(layout.originOffsetX) || 0),
          y: (point.y - vbY) * scaleY + (Number(layout.bgY) || 0) - (Number(layout.originOffsetY) || 0),
        });

        // The painted rect = the gradient's bounding box when its units are objectBoundingBox.
        const rectTag = (svg.match(/<rect\b[^>]*>/i) || [])[0];
        const bbox = {
          x: Number(attr(rectTag, "x")) || vbX,
          y: Number(attr(rectTag, "y")) || vbY,
          width: Number(attr(rectTag, "width")) || vbW,
          height: Number(attr(rectTag, "height")) || vbH,
        };
        const userSpace = String(attr(gradientTag, "gradientUnits") || "").toLowerCase() === "userspaceonuse";
        const length = (value, fallback, axis) => {
          const raw = value === null ? fallback : value;
          const percent = /%$/.test(raw);
          const numeric = Number.parseFloat(raw);
          if (!Number.isFinite(numeric)) return Number.parseFloat(fallback) / (/%$/.test(fallback) ? 100 : 1);
          if (!percent) return numeric;
          return userSpace ? (numeric / 100) * (axis === "x" ? vbW : vbH) + (axis === "x" ? vbX : vbY) : numeric / 100;
        };
        // gradientTransform, as one matrix [a b c d e f].
        let matrix = [1, 0, 0, 1, 0, 0];
        const multiply = (m, n) => [
          m[0] * n[0] + m[2] * n[1],
          m[1] * n[0] + m[3] * n[1],
          m[0] * n[2] + m[2] * n[3],
          m[1] * n[2] + m[3] * n[3],
          m[0] * n[4] + m[2] * n[5] + m[4],
          m[1] * n[4] + m[3] * n[5] + m[5],
        ];
        for (const op of String(attr(gradientTag, "gradientTransform") || "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
          const args = op[2].split(/[\s,]+/).filter(Boolean).map(Number);
          const name = op[1].toLowerCase();
          if (name === "matrix" && args.length === 6) matrix = multiply(matrix, args);
          else if (name === "translate") matrix = multiply(matrix, [1, 0, 0, 1, args[0] || 0, args[1] || 0]);
          else if (name === "scale") matrix = multiply(matrix, [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0]);
          else if (name === "rotate") {
            const r = ((args[0] || 0) * Math.PI) / 180;
            const cx = args[1] || 0;
            const cy = args[2] || 0;
            matrix = multiply(matrix, [1, 0, 0, 1, cx, cy]);
            matrix = multiply(matrix, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
            matrix = multiply(matrix, [1, 0, 0, 1, -cx, -cy]);
          } else return null;
        }
        const toUser = (point) => {
          const p = {
            x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
            y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
          };
          return userSpace ? p : { x: bbox.x + p.x * bbox.width, y: bbox.y + p.y * bbox.height };
        };

        const stops = Array.from(svg.matchAll(/<stop\b[^>]*>/gi))
          .map(([tag]) => {
            const color = toHex(attr(tag, "stop-color") || styleProp(tag, "stop-color"));
            const opacityRaw = attr(tag, "stop-opacity") ?? styleProp(tag, "stop-opacity");
            const opacity = opacityRaw === null ? 1 : Math.max(0, Math.min(1, Number(opacityRaw)));
            const offsetRaw = attr(tag, "offset") || "0";
            const offset = Number.parseFloat(offsetRaw) / (/%$/.test(offsetRaw) ? 100 : 1);
            return color && Number.isFinite(offset) && Number.isFinite(opacity)
              ? { color, opacity, offset: Math.max(0, Math.min(1, offset)) }
              : null;
          })
          .filter(Boolean)
          .sort((a, b) => a.offset - b.offset);
        if (stops.length < 2) return null;

        let angle = 0;
        let mapped;
        if (radial) {
          // The renderers' radial ramp runs from the box centre to half its diagonal; Canva's from
          // its own centre to `r`. Scale the stops by the radius ratio (the centres coincide for
          // Canva's default radial text gradient).
          const center = toBox(toUser({ x: length(attr(gradientTag, "cx"), "50%", "x"), y: length(attr(gradientTag, "cy"), "50%", "y") }));
          const edge = toBox(toUser({ x: length(attr(gradientTag, "cx"), "50%", "x") + length(attr(gradientTag, "r"), "50%", "x"), y: length(attr(gradientTag, "cy"), "50%", "y") }));
          const radius = Math.hypot(edge.x - center.x, edge.y - center.y);
          const ramp = Math.hypot(width, height) / 2;
          if (!(radius > 0)) return null;
          mapped = stops.map((stop) => ({ ...stop, position: (stop.offset * radius) / ramp }));
        } else {
          const start = toBox(toUser({ x: length(attr(gradientTag, "x1"), "0%", "x"), y: length(attr(gradientTag, "y1"), "0%", "y") }));
          const end = toBox(toUser({ x: length(attr(gradientTag, "x2"), "100%", "x"), y: length(attr(gradientTag, "y2"), "0%", "y") }));
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const span = Math.hypot(dx, dy);
          if (!(span > 1e-6)) return null;
          const ux = dx / span;
          const uy = dy / span;
          const half = Math.abs(ux) * (width / 2) + Math.abs(uy) * (height / 2);
          const rampStartX = width / 2 - ux * half;
          const rampStartY = height / 2 - uy * half;
          const startAlong = (start.x - rampStartX) * ux + (start.y - rampStartY) * uy;
          mapped = stops.map((stop) => ({ ...stop, position: (startAlong + stop.offset * span) / (2 * half) }));
          angle = (((Math.atan2(dy, dx) * 180) / Math.PI) % 360 + 360) % 360;
        }

        // Clip the ramp to the box: whatever Canva shows at 0 and 1 becomes the end stop there.
        const mix = (a, b, t) => {
          const channel = (index) =>
            Math.round(
              Number.parseInt(a.color.slice(index, index + 2), 16) * (1 - t) +
                Number.parseInt(b.color.slice(index, index + 2), 16) * t
            )
              .toString(16)
              .padStart(2, "0");
          return { color: `#${channel(1)}${channel(3)}${channel(5)}`, opacity: a.opacity * (1 - t) + b.opacity * t };
        };
        const colorAt = (position) => {
          if (position <= mapped[0].position) return mapped[0];
          const last = mapped[mapped.length - 1];
          if (position >= last.position) return last;
          for (let index = 1; index < mapped.length; index += 1) {
            const a = mapped[index - 1];
            const b = mapped[index];
            if (position <= b.position) {
              const span = b.position - a.position;
              return span > 0 ? mix(a, b, (position - a.position) / span) : b;
            }
          }
          return last;
        };
        let clipped = mapped.filter((stop) => stop.position >= 0 && stop.position <= 1);
        if (mapped[0].position < 0) clipped.unshift({ ...colorAt(0), position: 0 });
        if (mapped[mapped.length - 1].position > 1) clipped.push({ ...colorAt(1), position: 1 });
        if (clipped.length < 2) clipped = [{ ...colorAt(0), position: 0 }, { ...colorAt(1), position: 1 }];
        return {
          type: "gradient",
          gradientKind: radial ? "radial" : "linear",
          angle: Math.round(angle * 1000) / 1000,
          stops: clipped.map((stop) => ({
            color: stop.color,
            ...(stop.opacity < 1 ? { opacity: Math.round(stop.opacity * 1000) / 1000 } : {}),
            position: Math.round(stop.position * 1e4) / 1e4,
          })),
        };
      };
      // ── canva-text-gradient:end

      // The gradient fill of a text layer, from the paragraph Canva paints it on; null when the
      // text is a flat colour (or painted with something this cannot express yet, like a photo).
      const readTextGradientFill = (layerNode) => {
        try {
          const painted = [layerNode, ...getScopedDescendants(layerNode)].filter((element) => {
            const style = window.getComputedStyle(element);
            return isTextClippedBackground(style) && /url\(\s*['"]?data:image\/svg\+xml/i.test(String(style.backgroundImage || ""));
          });
          for (const element of painted) {
            const style = window.getComputedStyle(element);
            const url = (String(style.backgroundImage || "").match(/url\((['"]?)(.*?)\1\)/s) || [])[2] || "";
            if (!/^data:image\/svg\+xml/i.test(url)) continue;
            const comma = url.indexOf(",");
            const svgText = /;base64,/i.test(url.slice(0, comma + 1))
              ? atob(url.slice(comma + 1))
              : decodeURIComponent(url.slice(comma + 1));
            const pad = {
              left: parseNumericPx(style.paddingLeft),
              top: parseNumericPx(style.paddingTop),
              right: parseNumericPx(style.paddingRight),
              bottom: parseNumericPx(style.paddingBottom),
            };
            const contentWidth = element.clientWidth - pad.left - pad.right;
            const contentHeight = element.clientHeight - pad.top - pad.bottom;
            const position = String(style.backgroundPosition || "").trim().split(/\s+/);
            const size = String(style.backgroundSize || "auto").trim().split(/\s+/);
            if (!(contentWidth > 0 && contentHeight > 0)) continue;
            if (!position.every((part) => /^-?[\d.]+px$/.test(part))) continue;
            const sizeIsAuto = size.every((part) => part === "auto");
            if (!sizeIsAuto && !size.every((part) => /^[\d.]+px$/.test(part))) continue;
            const origin = String(style.backgroundOrigin || "padding-box");
            const originOffsetX =
              origin === "content-box" ? 0 : pad.left + (origin === "border-box" ? parseNumericPx(style.borderLeftWidth) : 0);
            const originOffsetY =
              origin === "content-box" ? 0 : pad.top + (origin === "border-box" ? parseNumericPx(style.borderTopWidth) : 0);
            // Canva runs the ramp across the LETTERS. A single line gets a box exactly that wide in the
            // editor (snug fit) and in the app (natural width), so measure the ramp against the line's
            // own extent there — against the paragraph box, a right-aligned title's ramp started 10%
            // into its letters. Wrapped text keeps the paragraph box: that is its box on our side too.
            let inkLeft = 0;
            let inkWidth = contentWidth;
            try {
              const textRange = document.createRange();
              textRange.selectNodeContents(element);
              const rects = Array.from(textRange.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
              const mids = rects.map((rect) => rect.top + rect.height / 2);
              const shortest = Math.min(...rects.map((rect) => rect.height));
              const elementRect = element.getBoundingClientRect();
              const screenPerCss = element.offsetWidth > 0 ? elementRect.width / element.offsetWidth : 0;
              // One painted paragraph on one line; a text of several paragraphs is multi-line.
              const singleLine = painted.length === 1 && Math.max(...mids) - Math.min(...mids) < shortest * 0.5;
              if (rects.length && screenPerCss > 0 && singleLine) {
                const left = Math.min(...rects.map((rect) => rect.left));
                const right = Math.max(...rects.map((rect) => rect.right));
                inkLeft = (left - elementRect.left) / screenPerCss - pad.left;
                inkWidth = (right - left) / screenPerCss;
              }
            } catch (_error) {
              inkLeft = 0;
              inkWidth = contentWidth;
            }
            const fill = canvaTextGradientToFill(svgText, {
              width: inkWidth > 0 ? inkWidth : contentWidth,
              height: contentHeight,
              bgX: Number.parseFloat(position[0]),
              bgY: Number.parseFloat(position[1] ?? position[0]),
              originOffsetX: originOffsetX + (inkWidth > 0 ? inkLeft : 0),
              originOffsetY,
              imageWidth: sizeIsAuto ? null : Number.parseFloat(size[0]),
              imageHeight: sizeIsAuto ? null : Number.parseFloat(size[1] ?? size[0]),
            });
            if (fill) return fill;
          }
        } catch (_error) {
          return null;
        }
        return null;
      };

      const normalizeFontFamilyName = (value) => {
        const input = String(value || "").trim();
        if (!input) return "";
        const primary = input.split(",")[0]?.replace(/^['"]+|['"]+$/g, "").trim() || "";
        if (!primary) return "";
        if (GENERIC_FONT_FAMILIES.has(primary.toLowerCase())) return "";
        return resolveCanvaFontToken(primary.replace(/\s+/g, " ").trim());
      };

      // Canva names its @font-face families with an opaque token ("YAGVuEYCNg0_1"), and that token
      // was travelling all the way into the library as the family NAME — a second "IBM Plex Sans
      // Arabic" living under a name nobody can search for. The token's own @font-face src says
      // what it is: ".../YAGVuEYCNg0/0/IBMPlexSansArabic-Bold6106…woff2". Read the file stem up to
      // the weight dash and split the camel case, and the family imports as "IBM Plex Sans Arabic"
      // — which also lets the server's dedupe find the copy it already holds.
      const CANVA_FONT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{6,}$/;
      const UNNAMED_FONT_FILE_STEMS = new Set(["font", "fonts", "file", "index", "webfont"]);
      const canvaFontTokenNames = new Map();
      // The trailing token(s) of a Canva font file stem name the CUT, never the family:
      // "RTL-Banana-Regular", "Amiri-BoldSlanted", "IBMPlexSansArabic-Bold6106…". Only those come
      // off — a family's own dashes stay. Splitting at the FIRST dash instead turned RTL-Mary and
      // RTL-Banana both into "RTL", so the second design deduped onto the first's file and rendered
      // in a font it never used.
      const FONT_CUT_WORDS =
        /^(thin|hairline|extralight|ultralight|light|regular|normal|book|roman|text|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique|slanted|condensed|expanded|var|variable|vf)+$/i;
      const familyNameFromFontFileUrl = (url) => {
        const file = String(url || "").replace(/[?#].*$/, "").split("/").pop() || "";
        // Canva appends hash segments after the first dot: "RTL-Banana-Regular.6264b….2e0d….woff2".
        const stem = file.split(".")[0] || "";
        const parts = stem
          .split("-")
          .map((part) => part.replace(/\d+$/, "").trim())
          .filter(Boolean);
        while (parts.length > 1 && FONT_CUT_WORDS.test(parts[parts.length - 1])) parts.pop();
        const base = parts.join("-");
        if (!/^[A-Za-z][A-Za-z-]{2,}$/.test(base) || UNNAMED_FONT_FILE_STEMS.has(base.toLowerCase())) return "";
        return base
          .split("-")
          .map((part) =>
            part.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([a-z])([A-Z])/g, "$1 $2")
          )
          .join("-")
          .trim();
      };
      const resolveCanvaFontToken = (family) => {
        const name = String(family || "").trim();
        // A real family name has spaces or no digits; a Canva token has neither.
        if (!name || /\s/.test(name) || !/\d/.test(name) || !CANVA_FONT_TOKEN_PATTERN.test(name)) {
          return name;
        }
        if (canvaFontTokenNames.has(name)) return canvaFontTokenNames.get(name) || name;
        let resolved = "";
        try {
          const sheets = Array.from(document.styleSheets || []);
          for (let s = 0; s < sheets.length && !resolved; s += 1) {
            let rules = null;
            try {
              rules = sheets[s].cssRules || [];
            } catch (_error) {
              continue;
            }
            for (let r = 0; r < rules.length && !resolved; r += 1) {
              const rule = rules[r];
              if (!rule || rule.type !== CSSRule.FONT_FACE_RULE) continue;
              const ruleFamily = String(rule.style?.getPropertyValue?.("font-family") || "")
                .replace(/^['"]+|['"]+$/g, "")
                .trim();
              if (ruleFamily !== name) continue;
              const srcMatch = /url\((['"]?)([^'")]+)\1\)/i.exec(rule.style?.getPropertyValue?.("src") || "");
              if (srcMatch) resolved = familyNameFromFontFileUrl(srcMatch[2]);
            }
          }
        } catch (_error) {
          resolved = "";
        }
        canvaFontTokenNames.set(name, resolved);
        return resolved || name;
      };

      const normalizeAssetUrl = (value) => {
        const raw = String(value || "").trim();
        if (!raw) return "";
        if (raw.startsWith("data:image/")) return raw;
        if (raw.startsWith("data:font/")) return raw;
        if (raw.startsWith("data:application/font-")) return raw;
        if (raw.startsWith("data:application/x-font-")) return raw;
        if (raw.startsWith("data:application/vnd.ms-fontobject")) return raw;
        if (raw.startsWith("blob:")) return raw;
        try {
          return new URL(raw, location.href).toString();
        } catch (_error) {
          return raw;
        }
      };

      const guessFontMimeType = (sourceUrl, formatHint) => {
        const format = String(formatHint || "").toLowerCase();
        if (format.includes("truetype") || format.includes("ttf")) return "font/ttf";
        if (format.includes("opentype") || format.includes("otf")) return "font/otf";
        if (format.includes("ttc") || format.includes("collection")) return "font/ttc";
        if (format.includes("woff2")) return "font/woff2";
        if (format.includes("woff")) return "font/woff";
        if (format.includes("embedded-opentype") || format.includes("eot")) {
          return "application/vnd.ms-fontobject";
        }
        const url = String(sourceUrl || "").toLowerCase();
        if (url.includes(".ttf")) return "font/ttf";
        if (url.includes(".otf")) return "font/otf";
        if (url.includes(".ttc")) return "font/ttc";
        if (url.includes(".woff2")) return "font/woff2";
        if (url.includes(".woff")) return "font/woff";
        if (url.includes(".eot")) return "application/vnd.ms-fontobject";
        return "";
      };

      const parseFontMimeTypeFromDataUrl = (value) => {
        const source = String(value || "").trim();
        const match = source.match(/^data:([^;,]+);base64,/i);
        return String(match?.[1] || "").trim().toLowerCase();
      };

      const toDataUrlFromBlob = (blob) =>
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : "");
          reader.onerror = () => resolve("");
          reader.readAsDataURL(blob);
        });
      // Image type from the bytes themselves. CDNs mislabel: video-public.canva.com serves the
      // video poster JPEGs as application/octet-stream, which a Content-Type check alone rejects.
      const sniffImageMimeType = async (blob) => {
        try {
          const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
          if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
          if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
          if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) return "image/gif";
          if (
            head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
            head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
          ) {
            return "image/webp";
          }
          const text = String.fromCharCode(...head.subarray(0, 5)).toLowerCase();
          if (text.startsWith("<svg") || text.startsWith("<?xml")) return "image/svg+xml";
          return "";
        } catch (_e) {
          return "";
        }
      };

      // Hosts where the user's Canva session cookies are appropriate to send.
      // For any other origin, fetch with `credentials: "omit"` to avoid leaking
      // Canva session cookies to third-party CDNs that designs may reference.
      const CANVA_CREDENTIALED_HOST_SUFFIXES = [
        "canva.com",
        "canvacdn.com",
        "canva-apps.com",
      ];

      // Public Canva asset CDNs serve with `Access-Control-Allow-Origin: *` and NO
      // `Access-Control-Allow-Credentials`, so a CREDENTIALED cross-origin fetch is rejected
      // by the browser — the asset then silently falls back to a low-res raster. These must
      // be fetched anonymously, so they take precedence over the credentialed suffixes above.
      const CANVA_PUBLIC_CDN_HOST_SUFFIXES = [
        "media-public.canva.com",
        "media.canva.com",
      ];

      const matchesHostSuffix = (host, suffixes) =>
        suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));

      const shouldSendCredentialsForUrl = (urlString) => {
        try {
          const host = new URL(urlString, location.href).hostname.toLowerCase();
          if (matchesHostSuffix(host, CANVA_PUBLIC_CDN_HOST_SUFFIXES)) return false;
          return matchesHostSuffix(host, CANVA_CREDENTIALED_HOST_SUFFIXES);
        } catch (_error) {
          return false;
        }
      };

      // Canva's animated stickers ("Animated Watercolor …") are rects whose fill is a VIDEO; the
      // editor shows them as a looping GIF from video-public.canva.com that paints in from a
      // BLANK first frame, holds for ~9 s, then paints out to a blank last frame. drawImage()
      // always paints an animated image's first frame, so the raster fallback captured nothing:
      // six watercolours on DAHOhOaWZTw imported as fully transparent PNGs. Decode the animation
      // and keep its fullest frame (most opaque pixels) — the settled look Canva shows at rest.
      // The GIFs run 14–28 MB, which the plain fetch cap below would also have rejected.
      const ANIMATED_IMAGE_MAX_BYTES = 64_000_000;
      const ANIMATED_IMAGE_SAMPLE_FRAMES = 16;
      const settledFrameOfAnimatedImage = async (blob, mimeType) => {
        if (typeof ImageDecoder !== "function") return "";
        let decoder = null;
        try {
          if (!(await ImageDecoder.isTypeSupported(mimeType))) return "";
          decoder = new ImageDecoder({ data: await blob.arrayBuffer(), type: mimeType });
          await decoder.tracks.ready;
          await decoder.completed;
          const track = decoder.tracks.selectedTrack;
          const frameCount = Number(track?.frameCount || 0);
          if (!track || !track.animated || frameCount <= 1) return "";
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) return "";
          const best = document.createElement("canvas");
          let bestCoverage = -1;
          // Increasing frame indices: a GIF decodes sequentially, so this costs one pass.
          const samples = Math.min(ANIMATED_IMAGE_SAMPLE_FRAMES, frameCount);
          for (let sample = 0; sample < samples; sample += 1) {
            const frameIndex = Math.min(frameCount - 1, Math.floor(((sample + 0.5) * frameCount) / samples));
            const { image } = await decoder.decode({ frameIndex });
            try {
              const width = Number(image.displayWidth || image.codedWidth || 0);
              const height = Number(image.displayHeight || image.codedHeight || 0);
              if (width <= 0 || height <= 0) continue;
              if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
              }
              context.clearRect(0, 0, width, height);
              context.drawImage(image, 0, 0);
              const pixels = context.getImageData(0, 0, width, height).data;
              let opaque = 0;
              let seen = 0;
              for (let offset = 3; offset < pixels.length; offset += 16) {
                seen += 1;
                if (pixels[offset] > 16) opaque += 1;
              }
              const coverage = seen > 0 ? opaque / seen : 0;
              // Ties keep the earliest frame (an opaque animation has no "settled" frame).
              if (coverage > bestCoverage) {
                bestCoverage = coverage;
                best.width = width;
                best.height = height;
                const bestContext = best.getContext("2d");
                bestContext.clearRect(0, 0, width, height);
                bestContext.drawImage(canvas, 0, 0);
              }
            } finally {
              image.close();
            }
          }
          if (bestCoverage <= 0) return "";
          const dataUrl = best.toDataURL("image/png");
          return String(dataUrl).startsWith("data:image/png") ? dataUrl : "";
        } catch (_error) {
          return "";
        } finally {
          try {
            decoder?.close();
          } catch (_closeError) {
            /* already closed */
          }
        }
      };

      const readRemoteImageAssetAsDataUrl = async (sourceUrl, maxBytes = 8_000_000) => {
        const normalizedUrl = normalizeAssetUrl(sourceUrl);
        if (!normalizedUrl) return "";
        if (/^data:/i.test(normalizedUrl) || /^blob:/i.test(normalizedUrl)) return "";
        // Try the preferred credentials mode, then fall back to the other. Public CDNs need
        // anonymous (ACAO:*), user-scoped hosts may need cookies — trying both makes the
        // asset fetch succeed regardless of which list a host lands in, instead of silently
        // degrading to a display-resolution raster.
        const modes = shouldSendCredentialsForUrl(normalizedUrl)
          ? ["include", "omit"]
          : ["omit", "include"];
        for (let index = 0; index < modes.length; index += 1) {
          try {
            const response = await fetch(normalizedUrl, {
              credentials: modes[index],
              cache: "force-cache",
            });
            if (!response.ok) continue;
            const blob = await response.blob();
            if (!blob || blob.size <= 0 || blob.size > Math.max(maxBytes, ANIMATED_IMAGE_MAX_BYTES)) continue;
            const mimeType = String(blob.type || "").trim().toLowerCase();
            let typedBlob = blob;
            if (!mimeType.startsWith("image/")) {
              // Trust the magic bytes over the header (see sniffImageMimeType); a genuine
              // non-image still falls through to the next mode / empty result.
              const sniffed = await sniffImageMimeType(blob);
              if (!sniffed) continue;
              typedBlob = new Blob([blob], { type: sniffed });
            }
            if (typedBlob.type === "image/gif" || typedBlob.type === "image/webp") {
              const settled = await settledFrameOfAnimatedImage(typedBlob, typedBlob.type);
              if (settled) return settled;
            }
            if (typedBlob.size > maxBytes) continue;
            const dataUrl = await toDataUrlFromBlob(typedBlob);
            if (String(dataUrl).startsWith("data:image/")) return dataUrl;
          } catch (_error) {
            // Try the next credentials mode.
          }
        }
        return "";
      };

      // The ANIMATED counterpart of readRemoteImageAssetAsDataUrl: fetches the asset and, when it
      // is a real multi-frame GIF / WebP, returns the untouched bytes (so the layer keeps moving in
      // the editor and the app) together with the settled frame as a poster and the animation's
      // frame count / length. Null for a still image or when nothing could be decoded.
      const readRemoteAnimatedImageAsset = async (sourceUrl) => {
        const normalizedUrl = normalizeAssetUrl(sourceUrl);
        if (!normalizedUrl || /^data:/i.test(normalizedUrl) || /^blob:/i.test(normalizedUrl)) return null;
        if (typeof ImageDecoder !== "function") return null;
        const modes = shouldSendCredentialsForUrl(normalizedUrl) ? ["include", "omit"] : ["omit", "include"];
        for (let index = 0; index < modes.length; index += 1) {
          let decoder = null;
          try {
            const response = await fetch(normalizedUrl, { credentials: modes[index], cache: "force-cache" });
            if (!response.ok) continue;
            const blob = await response.blob();
            if (!blob || blob.size <= 0 || blob.size > ANIMATED_IMAGE_MAX_BYTES) continue;
            let typedBlob = blob;
            const mimeType = String(blob.type || "").trim().toLowerCase();
            if (!mimeType.startsWith("image/")) {
              const sniffed = await sniffImageMimeType(blob);
              if (!sniffed) continue;
              typedBlob = new Blob([blob], { type: sniffed });
            }
            if (typedBlob.type !== "image/gif" && typedBlob.type !== "image/webp") return null;
            if (!(await ImageDecoder.isTypeSupported(typedBlob.type))) return null;
            const bytes = await typedBlob.arrayBuffer();
            decoder = new ImageDecoder({ data: bytes, type: typedBlob.type });
            await decoder.tracks.ready;
            await decoder.completed;
            const track = decoder.tracks.selectedTrack;
            const frameCount = Number(track?.frameCount || 0);
            if (!track || !track.animated || frameCount <= 1) return null;
            let durationUs = 0;
            let width = 0;
            let height = 0;
            for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
              const { image } = await decoder.decode({ frameIndex });
              try {
                // A GIF frame with no delay plays at the browsers' 100 ms floor.
                durationUs += Math.max(20000, Number(image.duration || 0) || 100000);
                width = width || Number(image.displayWidth || image.codedWidth || 0);
                height = height || Number(image.displayHeight || image.codedHeight || 0);
              } finally {
                image.close();
              }
            }
            const posterDataUrl = await settledFrameOfAnimatedImage(typedBlob, typedBlob.type);
            const dataUrl = await toDataUrlFromBlob(typedBlob);
            if (!String(dataUrl).startsWith("data:image/")) return null;
            return {
              dataUrl,
              posterDataUrl: String(posterDataUrl || ""),
              width,
              height,
              frameCount,
              durationMs: Math.max(1, Math.round(durationUs / 1000)),
              repetitionCount: Number.isFinite(Number(track.repetitionCount)) ? Number(track.repetitionCount) : null,
            };
          } catch (_error) {
            // Try the next credentials mode.
          } finally {
            try {
              decoder?.close();
            } catch (_closeError) {
              /* already closed */
            }
          }
        }
        return null;
      };

      // Acquire an image for a given <img>/<image> element by trying strategies
      // in correctness-priority order: original-bytes paths first, lossy raster
      // last. Returns { src, dataUrl, provenance } where provenance is:
      //   "data" | "blob" | "fetch" | "fetch-fit" | "raster" | ""  (empty = nothing worked)
      const acquireImageForElement = async (element, targetWidth, targetHeight, options = {}) => {
        if (!element) return { src: "", dataUrl: "", provenance: "" };
        const initialSrc = getImageElementSource(element);
        const fitFetchedToTarget = Boolean(options?.fitFetchedToTarget);
        const cropRegion = options?.cropRegion || null;
        const quarterTurns = Number(options?.quarterTurns) || 0;

        // An animated sticker keeps its animation: the raw GIF is the asset, its settled frame the
        // poster. A GIF that turns out to be a still falls through to the ordinary paths below.
        if (options?.keepAnimated && /^https?:\/\//i.test(String(initialSrc))) {
          const animated = await readRemoteAnimatedImageAsset(initialSrc);
          if (animated) {
            return {
              src: animated.dataUrl,
              dataUrl: animated.dataUrl,
              provenance: "fetch",
              sourceWidth: animated.width,
              sourceHeight: animated.height,
              posterDataUrl: animated.posterDataUrl,
              animatedImage: {
                kind: "gif",
                frameCount: animated.frameCount,
                durationMs: animated.durationMs,
                loop: true,
              },
            };
          }
        }

        // (1) Already a data: URL — done.
        if (String(initialSrc).startsWith("data:image/")) {
          return { src: initialSrc, dataUrl: initialSrc, provenance: "data" };
        }

        // (2) blob: URL - fetch through FileReader while the blob is still live.
        if (String(initialSrc).startsWith("blob:")) {
          const blobDataUrl = await blobUrlToDataUrl(initialSrc);
          if (blobDataUrl) {
            // A blob is the WHOLE media, exactly like a fetched one, so an element that shows a
            // SLICE of it needs the same fit. Returning the blob raw drew the entire "حج مبرور"
            // artwork, shrunk, into the box that was meant to show only "مبرور" — while its
            // sibling, whose blob had already been revoked, fell through to the raster path and
            // came out cropped correctly. Same asset, two results, by luck.
            if (fitFetchedToTarget) {
              const fitted = await fitDataUrlToDisplayedBox(
                blobDataUrl,
                targetWidth,
                targetHeight,
                cropRegion,
                quarterTurns
              );
              if (fitted && String(fitted.dataUrl || "").startsWith("data:image/")) {
                return {
                  src: fitted.dataUrl,
                  dataUrl: fitted.dataUrl,
                  provenance: "fetch-fit",
                  sourceWidth: fitted.width,
                  sourceHeight: fitted.height,
                };
              }
            }
            return { src: blobDataUrl, dataUrl: blobDataUrl, provenance: "blob" };
          }
          // fall through to raster
        }

        // (3) HTTPS/HTTP - fetch the ORIGINAL encoded bytes BEFORE rasterizing.
        // Best fidelity, smallest payload (JPEG/WebP preserved). For canva.com
        // hosts the user's session cookies are sent automatically (see Diff 1).
        if (/^https?:\/\//i.test(String(initialSrc))) {
          const fetched = await readRemoteImageAssetAsDataUrl(initialSrc);
          if (fetched) {
            if (fitFetchedToTarget) {
              const fitted = await fitDataUrlToDisplayedBox(
                fetched,
                targetWidth,
                targetHeight,
                cropRegion,
                quarterTurns
              );
              if (fitted && String(fitted.dataUrl || "").startsWith("data:image/")) {
                return {
                  src: fitted.dataUrl,
                  dataUrl: fitted.dataUrl,
                  provenance: "fetch-fit",
                  sourceWidth: fitted.width,
                  sourceHeight: fitted.height,
                };
              }
            }
            return { src: fetched, dataUrl: fetched, provenance: "fetch" };
          }
          // fall through to raster
        }

        // (4) Last resort - rasterize the decoded <img> into a canvas. Lossy
        // (re-encodes to PNG and scales to the target box) and can throw on
        // CORS-tainted images, but works when (3) is blocked or unavailable.
        const rasterDataUrl = renderElementToDataUrl(element, targetWidth, targetHeight);
        if (rasterDataUrl) {
          return {
            src: initialSrc || rasterDataUrl,
            dataUrl: rasterDataUrl,
            provenance: "raster",
          };
        }

        // Nothing worked - return what we have so the SW can decide whether to
        // run the hide-layer screenshot-diff fallback.
        return { src: initialSrc, dataUrl: "", provenance: "" };
      };

      // Run async tasks with a concurrency cap. Returns results in input order.
      // Worker errors are swallowed (result becomes undefined) because image
      // acquisition is best-effort and callers handle missing results.
      const runWithConcurrency = async (items, limit, worker) => {
        const results = new Array(items.length);
        let cursor = 0;
        const runnerCount = Math.max(1, Math.min(limit, items.length));
        const runners = Array.from({ length: runnerCount }, async () => {
          while (true) {
            const index = cursor++;
            if (index >= items.length) return;
            try {
              results[index] = await worker(items[index], index);
            } catch (_error) {
              results[index] = undefined;
            }
          }
        });
        await Promise.all(runners);
        return results;
      };

      const sanitizeFontFileName = (value, fallback = "imported-font.ttf") => {
        const source = String(value || "").trim();
        const cleaned = source
          .replace(/[?#].*$/, "")
          .split("/")
          .pop()
          ?.replace(/[^\w.\- ]+/g, "")
          .trim();
        if (cleaned) return cleaned.slice(0, 180);
        return fallback;
      };

      const readFontAssetAsDataUrl = async (entry) => {
        const sourceUrl = String(entry?.url || "").trim();
        if (!sourceUrl) return { dataUrl: "", mimeType: "" };
        if (sourceUrl.startsWith("data:")) {
          const hintedMimeType = String(
            entry?.mimeType || guessFontMimeType(sourceUrl, entry?.format || "") || ""
          ).toLowerCase();
          const dataMimeType =
            parseFontMimeTypeFromDataUrl(sourceUrl) ||
            hintedMimeType;
          const normalizedMimeType = String(dataMimeType || "").toLowerCase();
          const finalMimeType =
            normalizedMimeType === "application/octet-stream" && hintedMimeType
              ? hintedMimeType
              : normalizedMimeType;
          return { dataUrl: sourceUrl, mimeType: finalMimeType };
        }
        try {
          const controller = new AbortController();
          const timeoutId = window.setTimeout(() => controller.abort(), 12_000);
          let response = null;
          try {
            response = await fetch(sourceUrl, {
              credentials: "omit",
              cache: "force-cache",
              signal: controller.signal,
            });
          } finally {
            window.clearTimeout(timeoutId);
          }
          if (!response.ok) return { dataUrl: "", mimeType: "" };
          const blob = await response.blob();
          if (!blob || blob.size <= 0 || blob.size > 5_000_000) {
            return { dataUrl: "", mimeType: "" };
          }
          const dataUrl = await toDataUrlFromBlob(blob);
          if (!String(dataUrl).startsWith("data:")) return { dataUrl: "", mimeType: "" };
          const hintedMimeType = String(
            entry?.mimeType || guessFontMimeType(sourceUrl, entry?.format || "") || ""
          ).toLowerCase();
          const mimeType =
            String(blob.type || "").trim().toLowerCase() ||
            hintedMimeType;
          const finalMimeType =
            mimeType === "application/octet-stream" && hintedMimeType ? hintedMimeType : mimeType;
          return { dataUrl, mimeType: finalMimeType };
        } catch (_error) {
          return { dataUrl: "", mimeType: "" };
        }
      };

      const extractFontFaceEntriesFromSrc = (srcValue) => {
        const entries = [];
        const source = String(srcValue || "");
        if (!source) return entries;
        const regex = /url\(([^)]+)\)\s*(?:format\(([^)]+)\))?/gi;
        let match = regex.exec(source);
        while (match) {
          const rawUrl = String(match[1] || "").replace(/^['"]+|['"]+$/g, "").trim();
          const normalizedUrl = normalizeAssetUrl(rawUrl);
          if (normalizedUrl) {
            const formatHint = String(match[2] || "").replace(/^['"]+|['"]+$/g, "").trim();
            const mimeType = guessFontMimeType(normalizedUrl, formatHint);
            entries.push({
              url: normalizedUrl,
              mimeType,
              format: formatHint,
            });
          }
          match = regex.exec(source);
        }
        return entries;
      };

      const collectDocumentFontAssets = () => {
        const byFamily = new Map();
        const addEntry = (familyName, entry) => {
          const normalizedFamily = normalizeFontFamilyName(familyName);
          if (!normalizedFamily) return;
          if (!entry || typeof entry !== "object") return;
          const url = normalizeAssetUrl(entry.url);
          if (!url) return;
          const weightRange = parseFontFaceWeightRange(entry.fontWeight);
          const normalizedStyle = normalizeFontStyle(entry.fontStyle);
          const dedupeKey = `${url}|${normalizedStyle}|${weightRange.min}|${weightRange.max}`;
          const current = byFamily.get(normalizedFamily) || [];
          if (
            current.some(
              (item) =>
                `${String(item?.url || "")}|${String(item?.fontStyle || "")}|${Number(item?.fontWeightMin || 0)}|${Number(item?.fontWeightMax || 0)}` ===
                dedupeKey
            )
          ) {
            return;
          }
          current.push({
            url,
            mimeType: String(entry.mimeType || guessFontMimeType(url, entry.format || "") || ""),
            format: String(entry.format || ""),
            fileName: sanitizeFontFileName(url),
            fontStyle: normalizedStyle,
            fontWeightMin: weightRange.min,
            fontWeightMax: weightRange.max,
          });
          byFamily.set(normalizedFamily, current);
        };

        const styleSheets = Array.from(document.styleSheets || []);
        styleSheets.forEach((sheet) => {
          let rules = null;
          try {
            rules = sheet.cssRules || [];
          } catch (_error) {
            rules = null;
          }
          if (!rules || !rules.length) return;
          Array.from(rules).forEach((rule) => {
            if (!rule || rule.type !== CSSRule.FONT_FACE_RULE) return;
            const familyRaw = rule.style?.getPropertyValue?.("font-family") || "";
            const srcRaw = rule.style?.getPropertyValue?.("src") || "";
            const styleRaw = rule.style?.getPropertyValue?.("font-style") || "";
            const weightRaw = rule.style?.getPropertyValue?.("font-weight") || "";
            const entries = extractFontFaceEntriesFromSrc(srcRaw);
            entries.forEach((entry) =>
              addEntry(familyRaw, {
                ...entry,
                fontStyle: styleRaw,
                fontWeight: weightRaw,
              })
            );
          });
        });

        return Array.from(byFamily.entries()).reduce((accumulator, [family, entries]) => {
          accumulator[family] = entries;
          return accumulator;
        }, {});
      };

      const getFontEntriesByFamily = (fontAssets, familyName) => {
        const family = normalizeFontFamilyName(familyName);
        if (!family) return [];
        const direct = Array.isArray(fontAssets?.[family]) ? fontAssets[family] : [];
        if (direct.length > 0) return direct;
        const key = family.toLowerCase();
        const matched = Object.keys(fontAssets || {}).find(
          (candidate) => String(candidate || "").toLowerCase() === key
        );
        if (!matched) return [];
        return Array.isArray(fontAssets?.[matched]) ? fontAssets[matched] : [];
      };

      const resolveFontAssetsForFamilies = async (fontAssets, families, usedTargetsByFamily = {}) => {
        const result = {};
        const seenFamilies = new Set();
        const sourceFamilies = Array.isArray(families) ? families : [];
        for (let index = 0; index < sourceFamilies.length; index += 1) {
          const family = normalizeFontFamilyName(sourceFamilies[index]);
          if (!family) continue;
          const familyKey = family.toLowerCase();
          if (seenFamilies.has(familyKey)) continue;
          seenFamilies.add(familyKey);

          const entries = getFontEntriesByFamily(fontAssets, family);
          if (entries.length === 0) continue;

          // Canva declares ~36 @font-face variants per family (every weight 100-900
          // x italic/normal) in arbitrary order, so a naive first-N cap can drop the
          // exact face a design relies on (e.g. Poppins Black 900 for big numbers).
          // Order entries by distance to the (weight, style) targets this family's
          // text is actually rendered at, so those faces survive the cap below.
          const usedTargets = Array.isArray(usedTargetsByFamily?.[family])
            ? usedTargetsByFamily[family]
            : [];
          const describeEntry = (entry) => {
            const min = Number.isFinite(Number(entry?.fontWeightMin))
              ? Number(entry.fontWeightMin)
              : 400;
            const max = Number.isFinite(Number(entry?.fontWeightMax))
              ? Number(entry.fontWeightMax)
              : 400;
            return {
              min,
              max,
              mid: (min + max) / 2,
              style: normalizeFontStyle(entry?.fontStyle || ""),
            };
          };
          const distanceToTargets = (entry) => {
            const profile = describeEntry(entry);
            if (usedTargets.length === 0) {
              // No usage info: prefer regular-normal so the family still renders.
              return Math.abs(profile.mid - 400) + (profile.style === "normal" ? 0 : 1000);
            }
            let best = Infinity;
            for (let t = 0; t < usedTargets.length; t += 1) {
              const target = usedTargets[t];
              const targetWeight = Number.isFinite(Number(target?.weight))
                ? Number(target.weight)
                : 400;
              const targetStyle = normalizeFontStyle(target?.style || "");
              const weightDistance =
                targetWeight < profile.min
                  ? profile.min - targetWeight
                  : targetWeight > profile.max
                    ? targetWeight - profile.max
                    : 0;
              const styleDistance = profile.style === targetStyle ? 0 : 1000;
              best = Math.min(best, weightDistance + styleDistance);
            }
            return best;
          };
          const orderedEntries = entries
            .filter(
              (entry) =>
                entry && typeof entry === "object" && String(entry.url || "").trim()
            )
            .map((entry, originalIndex) => ({
              entry,
              originalIndex,
              distance: distanceToTargets(entry),
            }))
            .sort((a, b) => a.distance - b.distance || a.originalIndex - b.originalIndex);

          const resolvedEntries = [];
          const seenVariantKeys = new Set();
          for (let entryIndex = 0; entryIndex < orderedEntries.length; entryIndex += 1) {
            const entry = orderedEntries[entryIndex].entry;
            const url = String(entry.url || "").trim();
            if (!url) continue;
            // Dedupe by resolved (weight, style) so the 4 slots hold distinct faces.
            const profile = describeEntry(entry);
            const variantKey = `${Math.round(profile.mid)}|${profile.style}`;
            if (seenVariantKeys.has(variantKey)) continue;
            seenVariantKeys.add(variantKey);
            const resolved = await readFontAssetAsDataUrl(entry);
            resolvedEntries.push({
              url,
              dataUrl: String(resolved?.dataUrl || ""),
              mimeType: String(
                resolved?.mimeType ||
                  entry.mimeType ||
                  guessFontMimeType(url, entry.format || "") ||
                  ""
              ).toLowerCase(),
              format: String(entry.format || ""),
              fileName: sanitizeFontFileName(entry.fileName || url, `${family}.ttf`),
              fontStyle: normalizeFontStyle(entry.fontStyle || ""),
              fontWeightMin: Number.isFinite(Number(entry.fontWeightMin))
                ? Number(entry.fontWeightMin)
                : 400,
              fontWeightMax: Number.isFinite(Number(entry.fontWeightMax))
                ? Number(entry.fontWeightMax)
                : 400,
            });
            if (resolvedEntries.length >= 4) break;
          }
          if (resolvedEntries.length > 0) {
            result[family] = resolvedEntries;
          }
        }
        return result;
      };

      const parseBackgroundImageUrl = (value) => {
        const source = String(value || "");
        const match = source.match(/url\((['"]?)(.*?)\1\)/i);
        return match?.[2] ? normalizeAssetUrl(match[2]) : "";
      };

      // A background clipped to the TEXT is the glyphs' own paint (Canva's gradient text colour), not
      // a box behind them. Read as a background image it turned every gradient-coloured text into an
      // image layer: a solid gradient slab with a flat-colour copy of the words on top.
      const TEXT_CLIP_PATTERN = /(^|[\s,])text([\s,]|$)/;
      const isTextClippedBackground = (style) =>
        TEXT_CLIP_PATTERN.test(String(style?.backgroundClip || "")) ||
        TEXT_CLIP_PATTERN.test(String(style?.webkitBackgroundClip || ""));

      const findCssImageUrl = (element) => {
        if (!element) return "";
        const searchSources = [];
        const pushStyle = (style) => {
          if (!style) return;
          if (!isTextClippedBackground(style)) searchSources.push(style.backgroundImage);
          searchSources.push(style.maskImage);
          searchSources.push(style.webkitMaskImage);
          searchSources.push(style.content);
        };
        try {
          pushStyle(window.getComputedStyle(element));
          pushStyle(window.getComputedStyle(element, "::before"));
          pushStyle(window.getComputedStyle(element, "::after"));
        } catch (_error) {
          // Ignore pseudo-style errors.
        }
        for (let index = 0; index < searchSources.length; index += 1) {
          const found = parseBackgroundImageUrl(searchSources[index]);
          if (found) return found;
        }
        return "";
      };

      const isInsideForeignLayer = (element, ownerNode) => {
        const layerAncestor = element?.closest?.('[id^="LB"]');
        if (!layerAncestor) return false;
        if (!ownerNode) return true;
        return layerAncestor !== ownerNode;
      };

      // ── canva-canvas-photo:start
      // A canvas's pixels as a PNG data URL, or "" when they cannot be read or show nothing: a
      // tainted canvas throws, and a WebGL canvas whose drawing buffer was already presented reads
      // back fully transparent — a blank picture would be worse than the screenshot crop.
      const isBlankPixelData = (data) => {
        if (!data || data.length < 4) return true;
        for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) return false;
        return true;
      };
      const readCanvasPhotoDataUrl = (canvas) => {
        try {
          const probe = document.createElement("canvas");
          probe.width = 16;
          probe.height = 16;
          const context = probe.getContext("2d");
          if (!context) return "";
          context.drawImage(canvas, 0, 0, 16, 16);
          if (isBlankPixelData(context.getImageData(0, 0, 16, 16).data)) return "";
          const dataUrl = canvas.toDataURL("image/png");
          return String(dataUrl || "").startsWith("data:image/") ? dataUrl : "";
        } catch (_error) {
          return "";
        }
      };
      // ── canva-canvas-photo:end

      const getScopedImageElements = (node) => {
        if (!node) return [];
        return Array.from(node.querySelectorAll("img, image")).filter(
          (element) => !isInsideForeignLayer(element, node)
        );
      };

      const scopedDescendantsCache = new WeakMap();
      const getScopedDescendants = (node) => {
        if (!node) return [];
        const cached = scopedDescendantsCache.get(node);
        if (cached) return cached;
        const descendants = Array.from(node.querySelectorAll("*")).filter(
          (candidate) => !isInsideForeignLayer(candidate, node)
        );
        scopedDescendantsCache.set(node, descendants);
        return descendants;
      };

      const getScopedTextPreview = (node) => {
        if (!node) return "";
        const parts = [];
        try {
          const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
          let current = walker.nextNode();
          while (current) {
            const parentElement = current.parentElement || null;
            if (!isInsideForeignLayer(parentElement, node)) {
              const value = String(current.textContent || "").trim();
              if (value) parts.push(value);
            }
            current = walker.nextNode();
          }
        } catch (_error) {
          return "";
        }
        return dedupeTextLines(parts.join("\n"));
      };

      const getNodeVisualAssetKey = (node) => {
        if (!node) return "";
        const images = getScopedImageElements(node);
        for (let index = 0; index < images.length; index += 1) {
          const source = getImageElementSource(images[index]);
          if (source) return source;
        }
        const cssSource = findCssImageUrl(node);
        if (cssSource) return cssSource;
        const descendants = getScopedDescendants(node);
        for (let index = 0; index < descendants.length; index += 1) {
          const source = findCssImageUrl(descendants[index]);
          if (source) return source;
        }
        return "";
      };

      const parseNumericPx = (value) => {
        const numeric = Number.parseFloat(String(value || "").replace(/[^\d.\-]/g, ""));
        return Number.isFinite(numeric) ? numeric : 0;
      };

      const isTransparentColor = (value) => {
        const color = String(value || "").trim().toLowerCase();
        return (
          !color ||
          color === "none" ||
          color === "transparent" ||
          color === "rgba(0, 0, 0, 0)"
        );
      };

      const resolveTextBackgroundStyle = (element, stopAtNode) => {
        const empty = { color: "", radius: 0 };
        if (!element) return empty;
        let node = element;
        let depth = 0;
        while (node && depth < 12) {
          const style = window.getComputedStyle(node);
          const backgroundColor = String(style.backgroundColor || "").trim();
          if (!isTransparentColor(backgroundColor)) {
            return {
              color: backgroundColor,
              radius: Math.max(0, parseNumericPx(style.borderRadius || "")),
            };
          }
          if (node === stopAtNode) break;
          node = node.parentElement;
          depth += 1;
        }
        if (!stopAtNode || !stopAtNode.querySelectorAll) return empty;

        const ownerRect = stopAtNode.getBoundingClientRect();
        const ownerArea = Math.max(1, rectArea(ownerRect));
        const textRect =
          element && typeof element.getBoundingClientRect === "function"
            ? element.getBoundingClientRect()
            : ownerRect;
        const textArea = Math.max(1, rectArea(textRect));
        const textCenterX = Number(textRect.left || 0) + Number(textRect.width || 0) / 2;
        const textCenterY = Number(textRect.top || 0) + Number(textRect.height || 0) / 2;

        const candidates = [stopAtNode, ...getScopedDescendants(stopAtNode)];
        let best = empty;
        let bestScore = -1;

        for (let index = 0; index < candidates.length; index += 1) {
          const candidate = candidates[index];
          let style = null;
          try {
            style = window.getComputedStyle(candidate);
          } catch (_error) {
            style = null;
          }
          if (!style) continue;
          const backgroundColor = String(style.backgroundColor || "").trim();
          if (isTransparentColor(backgroundColor)) continue;
          const candidateRect = candidate.getBoundingClientRect();
          const clipped = intersectRects(candidateRect, ownerRect);
          if (!clipped) continue;
          const candidateArea = Math.max(1, rectArea(clipped));
          const coverage = candidateArea / ownerArea;
          if (coverage < 0.01) continue;

          const centerInside =
            textCenterX >= clipped.left &&
            textCenterX <= clipped.right &&
            textCenterY >= clipped.top &&
            textCenterY <= clipped.bottom;
          const textOverlapRect = intersectRects(clipped, textRect);
          const textOverlap = textOverlapRect ? rectArea(textOverlapRect) / textArea : 0;
          if (!centerInside && textOverlap < 0.2) continue;

          const radius = Math.max(0, parseNumericPx(style.borderRadius || ""));
          const score =
            (centerInside ? 8 : 0) +
            Math.min(4, textOverlap * 6) +
            Math.max(0, 2 - coverage * 3) +
            (radius > 0 ? 1 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = { color: backgroundColor, radius };
          }
        }
        return best;
      };

      // A text box's paragraphs. Canva renders text styled as a title/heading in <h1>–<h6>, not <p>
      // ("عــادات صحية" came as an <h3>), and a scan for <p> alone found no paragraph at all: the
      // style fell to a wrapper div's defaults and the title imported as 10px black Times.
      const TEXT_BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6";
      const isTextBlockTag = (tagName) => /^(P|H[1-6])$/.test(String(tagName || ""));

      // ── canva-list-markers:start
      // Canva lays a list item out as <ul><li><p>: the marker is the browser's own (::marker), never
      // a glyph in the text, so it never reached the import (DAHP1vJ1HHw's six cards lost their
      // bullets). The editor and the app have no lists, so the marker becomes a character at the
      // START of the item's text; the paragraph-direction pass then moves it to the end it shows at
      // (an Arabic item in Canva's left-to-right list keeps its bullet on the left).
      const listMarkerText = (listStyleType, ordinal) => {
        const type = String(listStyleType || "").trim().toLowerCase();
        if (!type || type === "none") return "";
        if (type === "circle") return "\u25E6 ";
        if (type === "square") return "\u25AA ";
        if (type === "disc") return "\u2022 ";
        const index = Math.max(1, Math.round(Number(ordinal) || 1));
        if (/^decimal/.test(type)) return `${index}. `;
        if (/^(lower|upper)-alpha$|^(lower|upper)-latin$/.test(type)) {
          const letter = String.fromCharCode(96 + ((index - 1) % 26) + 1);
          return `${type.startsWith("upper") ? letter.toUpperCase() : letter}. `;
        }
        if (/^(lower|upper)-roman$/.test(type)) {
          const numerals = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
          let rest = index;
          let out = "";
          for (const [value, glyph] of numerals) while (rest >= value) { out += glyph; rest -= value; }
          return `${type.startsWith("upper") ? out.toUpperCase() : out}. `;
        }
        return "\u2022 ";
      };
      // ── canva-list-markers:end

      // A Canva line's SVG as an image covering everything it paints: the paths' bounds plus half
      // the widest stroke (an arrow chevron at the end sits partly outside the element box). The
      // svg has no viewBox, so its user units are the element's own CSS px; `x/y/w/h` are the
      // element's design-px box, and the result's box is grown by the same overflow.
      const serializeLineSvgToDataUrl = (svgElement, x, y, w, h) => {
        try {
          const paths = Array.from(svgElement.querySelectorAll("path")).filter(
            (path) => Number(window.getComputedStyle(path).opacity) > 0.01
          );
          if (!paths.length) return null;
          const cssWidth = Number.parseFloat(window.getComputedStyle(svgElement).width) || svgElement.getBoundingClientRect().width;
          const cssHeight = Number.parseFloat(window.getComputedStyle(svgElement).height) || svgElement.getBoundingClientRect().height;
          if (!(cssWidth > 0) || !(cssHeight > 0)) return null;
          let minX = 0;
          let minY = 0;
          let maxX = cssWidth;
          let maxY = cssHeight;
          let pad = 1;
          paths.forEach((path) => {
            const box = path.getBBox();
            const strokeWidth = parseNumericPx(window.getComputedStyle(path).strokeWidth || "");
            pad = Math.max(pad, strokeWidth / 2 + 1);
            minX = Math.min(minX, box.x);
            minY = Math.min(minY, box.y);
            maxX = Math.max(maxX, box.x + box.width);
            maxY = Math.max(maxY, box.y + box.height);
          });
          minX -= pad;
          minY -= pad;
          maxX += pad;
          maxY += pad;
          const unitX = w / cssWidth;
          const unitY = h / cssHeight;
          const clone = svgElement.cloneNode(true);
          copyComputedSvgStyles(svgElement, clone);
          const width = Math.max(1, Math.round((maxX - minX) * unitX));
          const height = Math.max(1, Math.round((maxY - minY) * unitY));
          clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
          clone.setAttribute("width", String(width));
          clone.setAttribute("height", String(height));
          clone.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
          clone.setAttribute("preserveAspectRatio", "none");
          clone.style.removeProperty("transform");
          const serialized = new XMLSerializer().serializeToString(clone);
          if (!serialized.includes("<svg")) return null;
          return {
            dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`,
            x: x + minX * unitX,
            y: y + minY * unitY,
            width,
            height,
          };
        } catch (_error) {
          return null;
        }
      };

      // ── canva-vector-line:start
      // A Canva `line` element the editable-rect path cannot express: dashed/dotted, carrying an
      // arrowhead (a second painted path), or bent (elbow/curve commands) — the dashed connectors
      // with arrowheads on DAHP1vJ1HHw's mind map imported as six solid purple blocks. Takes the
      // visible paths as `{ dashed, filled, d }` and says whether the line must stay a vector image.
      const lineNeedsVector = (paths) => {
        const visible = (Array.isArray(paths) ? paths : []).filter((path) => path && typeof path.d === "string" && path.d.trim());
        if (!visible.length) return false;
        if (visible.length > 1) return true;
        const [only] = visible;
        if (only.dashed) return true;
        if (/[CcQqSsTtAa]/.test(only.d)) return true;
        // A polyline that changes direction (an elbow) has both axes moving between its points.
        const points = (only.d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g) || []).map(Number);
        const xs = new Set();
        const ys = new Set();
        for (let index = 0; index + 1 < points.length; index += 2) {
          xs.add(Math.round(points[index]));
          ys.add(Math.round(points[index + 1]));
        }
        return xs.size > 1 && ys.size > 1 && points.length > 4;
      };
      // ── canva-vector-line:end

      // ── canva-text-stroke:start
      // Canva's outline text effects (Hollow, Splice, Outline) draw the paragraph TWICE: one copy
      // with a transparent fill and `-webkit-text-stroke`, one with the plain fill on top. The
      // import kept the fill copy only, so DAHP1vJ1HHw's purple-outlined white labels came in as
      // invisible white text. The stroke is kept as a fraction of the font size (both read from
      // the same computed style, so no unit conversion) and background.js turns it into the text
      // layer's 0–100 outline width (lib/editor/textStroke.ts: px = fontSize × width/100 × 0.22).
      const textStrokeFromCopies = (copies) => {
        for (const copy of Array.isArray(copies) ? copies : []) {
          const width = Number(copy?.strokeWidthPx) || 0;
          const fontSize = Number(copy?.fontSizePx) || 0;
          const color = String(copy?.strokeColor || "").trim();
          if (!(width > 0) || !(fontSize > 0) || !color) continue;
          return { color, widthRatio: Math.round((width / fontSize) * 1e4) / 1e4 };
        }
        return null;
      };
      // ── canva-text-stroke:end

      // ── canva-paragraph-styles:start
      // A text layer carries ONE font weight/size/colour, but Canva styles paragraphs on their own:
      // DAHP1gDecK4's title is "الفكــــرة" at 700 over "الرئيسيـــة" at 400, and the import made
      // both bold, so the second line grew past the box and folded. Given each paragraph's style key
      // (null when a paragraph mixes styles inside itself), says whether the paragraphs should
      // become one layer each. Only when every paragraph is uniform and at least two differ.
      const paragraphStylesDiffer = (keys) => {
        if (!Array.isArray(keys) || keys.length < 2) return false;
        if (keys.some((key) => typeof key !== "string" || !key)) return false;
        return new Set(keys).size > 1;
      };
      // ── canva-paragraph-styles:end

      // ── canva-paragraph-direction:start
      // Canva lays a paragraph out in its text box's direction, while the editor and the app lay any
      // text with Arabic in it out right-to-left. For an Arabic paragraph the letters come out the
      // same either way; the punctuation at its ends does not. Typed as "!مستوى الحماس في القمة" in a
      // left-to-right box, Canva shows the "!" on the LEFT — where an Arabic sentence ends — and ours
      // drew it on the right (DAHPQG4ffsM). Moving end punctuation to the end it shows at makes the
      // right-to-left layout put it in the same place, and leaves the text in natural Arabic order
      // for whoever edits it. Only an LTR paragraph whose letters are all right-to-left is touched:
      // mixed with Latin words, the two directions also order the words differently.
      const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
      const BIDI_MIRRORED_PAIRS = { "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "«": "»", "»": "«" };
      const matchCanvaParagraphDirection = (text, canvaDirection) => {
        const value = String(text ?? "");
        if (canvaDirection !== "ltr") return value;
        return value
          .split("\n")
          .map((line) => {
            const [, outerStart, inner, outerEnd] = line.match(/^(\s*)([\s\S]*?)(\s*)$/u);
            const letters = inner.match(/\p{L}/gu) || [];
            // Numbers with separators and no letters ("2024 .10.10" under "يوم السبت"): an Arabic
            // text box lays every line out right to left, which swaps the number runs round the
            // separators ("10.10. 2024"). A leading left-to-right mark makes the line a
            // left-to-right run in every renderer, as Canva shows it. A bare number is the same
            // either way and is left alone.
            if (letters.length === 0) {
              const needsMark = /\p{N}/u.test(inner) && /[^\p{N}\s]/u.test(inner) && !inner.startsWith("\u200E");
              return needsMark ? `${outerStart}\u200E${inner}${outerEnd}` : line;
            }
            if (!letters.every((letter) => RTL_LETTER.test(letter))) return line;
            // Marks (tashkeel, tanween) belong to their letter, never to the punctuation.
            const [, leading, body, trailing] = inner.match(/^([^\p{L}\p{N}\p{M}]*)([\s\S]*?)([^\p{L}\p{N}\p{M}]*)$/u);
            if (!leading && !trailing) return line;
            // A run that joins the right-to-left flow reads right to left: reverse it, and swap the
            // paired brackets the right-to-left layout mirrors back.
            const flip = (run) => [...run].reverse().map((char) => BIDI_MIRRORED_PAIRS[char] || char).join("");
            return `${outerStart}${flip(trailing)}${body}${flip(leading)}${outerEnd}`;
          })
          .join("\n");
      };
      // ── canva-paragraph-direction:end

      const findBestTextStyleElement = (node, ownerNode = node) => {
        const candidates = Array.from(node.querySelectorAll(`${TEXT_BLOCK_SELECTOR},span,div`)).filter(
          (candidate) =>
            !isInsideForeignLayer(candidate, ownerNode) &&
            String(candidate.innerText || "").trim()
        );
        let best = null;
        let bestScore = -1;
        for (let index = 0; index < candidates.length; index += 1) {
          const candidate = candidates[index];
          const style = window.getComputedStyle(candidate);
          const fontSize = Number.parseFloat(style.fontSize || "") || 0;
          const color = style.color;
          const hasVar = String(candidate.getAttribute("style") || "").includes("--H97cbQ");
          const score =
            (isTextBlockTag(candidate.tagName) ? 12 : 0) +
            (hasVar ? 8 : 0) +
            (!isTransparentColor(color) ? 5 : 0) +
            (fontSize >= 10 ? 3 : 0);
          if (score > bestScore) {
            bestScore = score;
            best = candidate;
          }
        }
        if (!best) return null;
        const style = window.getComputedStyle(best);
        return isTransparentColor(style.color) ? null : best;
      };

      // Canva sets the real (often bold) weight on the leaf glyph <span> while the
      // wrapper <p> that findBestTextStyleElement picks stays at 400. Read the weight
      // from the dominant leaf text element so imported text matches the rendered
      // weight (e.g. numbers shown in Poppins 900, not the inherited 400). Computed
      // style resolves inheritance, so a genuinely-400 leaf still reports 400.
      // Canva renders curved text as one span per letter, each carrying its own rotation. Read
      // the arc back off those rotations: how far the letters turn from first to last is the
      // sweep, and whether the ends sit lower than the middle says which way it bows. The result
      // is scale-free (degrees + a direction), so the importer can size it against the editor's
      // own curve model once the layer's design-space width is known.
      const detectTextCurve = (layerNode) => {
        if (!layerNode) return null;
        const paragraphs = Array.from(layerNode.querySelectorAll(TEXT_BLOCK_SELECTOR)).filter(
          (item) => !isInsideForeignLayer(item, layerNode)
        );
        // The same duplicated logical copy dedupeTextLines collapses: read the first copy only.
        const firstCopy = paragraphs.slice(0, Math.max(1, Math.ceil(paragraphs.length / 2)));
        const letters = [];
        firstCopy.forEach((paragraph) => {
          Array.from(paragraph.querySelectorAll("span")).forEach((span) => {
            if (span.children.length > 0 || !String(span.textContent || "").trim()) return;
            const transform = window.getComputedStyle(span).transform;
            const match = /matrix\(([^)]+)\)/.exec(transform || "");
            if (!match) return;
            const [a, b] = match[1].split(",").map((part) => Number(part));
            if (!Number.isFinite(a) || !Number.isFinite(b)) return;
            const rect = span.getBoundingClientRect();
            letters.push({
              deg: (Math.atan2(b, a) * 180) / Math.PI,
              cx: rect.left + rect.width / 2,
              cy: rect.top + rect.height / 2,
            });
          });
        });
        if (letters.length < 6) return null;
        const first = letters[0];
        const last = letters[letters.length - 1];
        const spread = last.deg - first.deg;
        if (Math.abs(spread) < 8) return null;
        // Monotonic rotation from letter to letter is the signature of one arc; anything else
        // (a wave, a scatter) is not a curve the editor can express.
        const direction = Math.sign(spread);
        for (let index = 1; index < letters.length; index += 1) {
          if ((letters[index].deg - letters[index - 1].deg) * direction < -1.5) return null;
        }
        // The rotations run between letter CENTRES; stretch by one step so the arc also covers
        // the half-glyph on each end.
        const sweepDeg = Math.abs(spread) * (letters.length / (letters.length - 1));
        const middle = letters[Math.floor(letters.length / 2)];
        const endsY = (first.cy + last.cy) / 2;
        // Screen y grows downward: ends below the middle means the text bows UP.
        const bowsUp = endsY > middle.cy;
        // Where the run actually sits inside the box, as fractions of the node's own rect, so the
        // importer can place the editor's curve THROUGH the letters rather than through the box:
        // the editor's path ends at the box's vertical middle and bulges out of it, while Canva's
        // letters end at the bottom of the box and peak near its top — a curve fitted to the box
        // instead of the letters sat ~120px too high. The median centre-to-centre step is the
        // advance (spaces make a few steps longer; the median ignores them).
        const box = layerNode.getBoundingClientRect();
        const steps = [];
        for (let index = 1; index < letters.length; index += 1) {
          steps.push(Math.hypot(letters[index].cx - letters[index - 1].cx, letters[index].cy - letters[index - 1].cy));
        }
        steps.sort((a, b) => a - b);
        const advance = steps[Math.floor(steps.length / 2)] || 0;
        const frac = (value, size) => (size > 0 ? Math.round((value / size) * 10000) / 10000 : 0);
        return {
          sweepDeg: Math.round(sweepDeg * 10) / 10,
          bowsUp,
          firstXFrac: frac(first.cx - box.left, box.width),
          lastXFrac: frac(last.cx - box.left, box.width),
          endsYFrac: frac(endsY - box.top, box.height),
          apexYFrac: frac(middle.cy - box.top, box.height),
          advanceFrac: frac(advance, box.width),
        };
      };

      // Canva's "Background" text effect is not a CSS background: it is an SVG <path> inside the
      // text element — rounded boxes behind each line, merged into one outline. The CSS read above
      // (resolveTextBackgroundStyle) never saw it, so these boxes were silently dropped. Read the
      // path instead: its fill and opacity, its corner radius (the first cubic of a rounded rect
      // turns through a quarter circle, so |dx| = |dy| = r), and how far it reaches past the text —
      // horizontally past the widest line's ink, vertically past the element's line box. All in
      // design px, via the element's own css→design scale.
      // The outline a text's stroke copy draws, from the paragraph copies' computed styles.
      const detectTextStrokeEffect = (layerNode) => {
        try {
          if (!layerNode) return null;
          const paragraphs = Array.from(layerNode.querySelectorAll(TEXT_BLOCK_SELECTOR)).filter(
            (item) => !isInsideForeignLayer(item, layerNode)
          );
          const copies = paragraphs.map((paragraph) => {
            const glyph = paragraph.querySelector("span") || paragraph;
            const style = window.getComputedStyle(glyph);
            const strokeColor = String(style.webkitTextStrokeColor || "").trim();
            return {
              strokeWidthPx: parseNumericPx(style.webkitTextStrokeWidth || ""),
              strokeColor: isTransparentColor(strokeColor) ? "" : strokeColor,
              fontSizePx: Number.parseFloat(style.fontSize || "") || 0,
            };
          });
          const stroke = textStrokeFromCopies(copies);
          if (!stroke) return null;
          const rgb = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(stroke.color);
          const color = rgb
            ? `#${[rgb[1], rgb[2], rgb[3]]
                .map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, "0"))
                .join("")}`
            : stroke.color;
          return { color, widthRatio: stroke.widthRatio };
        } catch (_error) {
          return null;
        }
      };

      const detectTextBackgroundEffect = (layerNode, designWidth) => {
        if (!layerNode || !(Number(designWidth) > 0)) return null;
        const nodeRect = layerNode.getBoundingClientRect();
        if (!(nodeRect.width > 0) || !(nodeRect.height > 0)) return null;
        const toDesign = Number(designWidth) / nodeRect.width;
        let best = null;
        Array.from(layerNode.querySelectorAll("svg path")).forEach((path) => {
          if (isInsideForeignLayer(path, layerNode)) return;
          const style = window.getComputedStyle(path);
          const fill = String(style.fill || "").trim();
          if (!fill || fill === "none" || isTransparentColor(fill) || fill.startsWith("url(")) return;
          const opacity = (Number(style.opacity) || 1) * (Number(style.fillOpacity) || 1);
          if (opacity <= 0.01) return;
          const rect = path.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) return;
          const area = rect.width * rect.height;
          if (!best || area > best.area) best = { path, fill, opacity, rect, area };
        });
        if (!best) return null;

        // Widest rendered line of ink (first logical copy only — Canva keeps two).
        const paragraphs = Array.from(layerNode.querySelectorAll(TEXT_BLOCK_SELECTOR)).filter(
          (item) => !isInsideForeignLayer(item, layerNode)
        );
        const firstCopy = paragraphs.slice(0, Math.max(1, Math.ceil(paragraphs.length / 2)));
        const lines = new Map();
        firstCopy.forEach((paragraph) => {
          Array.from(paragraph.querySelectorAll("span")).forEach((span) => {
            if (span.children.length > 0 || !String(span.textContent || "").trim()) return;
            const r = span.getBoundingClientRect();
            if (!(r.width > 0)) return;
            const key = Math.round(r.top / 4);
            const line = lines.get(key) || { left: Infinity, right: -Infinity };
            line.left = Math.min(line.left, r.left);
            line.right = Math.max(line.right, r.right);
            lines.set(key, line);
          });
        });
        let inkWidth = 0;
        lines.forEach((line) => {
          inkWidth = Math.max(inkWidth, line.right - line.left);
        });
        if (!(inkWidth > 0)) inkWidth = nodeRect.width;

        // Corner radius from the first cubic segment, in the path's own units → css → design.
        let radiusPx = 0;
        try {
          const tokens = String(best.path.getAttribute("d") || "").match(/[MLCZmlcz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
          let cx = 0;
          let cy = 0;
          let command = "";
          for (let index = 0; index < tokens.length; ) {
            const token = tokens[index];
            if (/^[MLCZmlcz]$/.test(token)) {
              command = token;
              index += 1;
              continue;
            }
            if (command === "M" || command === "L") {
              cx = Number(tokens[index]);
              cy = Number(tokens[index + 1]);
              index += 2;
            } else if (command === "C") {
              const ex = Number(tokens[index + 4]);
              const ey = Number(tokens[index + 5]);
              radiusPx = (Math.abs(ex - cx) + Math.abs(ey - cy)) / 2;
              break;
            } else {
              index += 1;
            }
          }
          const bbox = typeof best.path.getBBox === "function" ? best.path.getBBox() : null;
          const unitsToCss = bbox && bbox.width > 0 ? best.rect.width / bbox.width : 1;
          radiusPx = radiusPx * unitsToCss * toDesign;
        } catch (_error) {
          radiusPx = 0;
        }

        const rgb = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(best.fill);
        const color = rgb
          ? `#${[rgb[1], rgb[2], rgb[3]]
              .map((part) => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, "0"))
              .join("")}`
          : best.fill;
        const round1 = (value) => Math.round(value * 10) / 10;
        return {
          color,
          opacity: Math.round(best.opacity * 1000) / 1000,
          radiusPx: round1(Math.max(0, radiusPx)),
          padXPx: round1(Math.max(0, (best.rect.width - inkWidth) / 2) * toDesign),
          padYPx: round1(Math.max(0, (best.rect.height - nodeRect.height) / 2) * toDesign),
          // The ink the padding was measured against, so the layer's box can hug it (the
          // editor and the app draw the background around the BOX).
          inkWidthPx: round1(inkWidth * toDesign),
          lineCount: Math.max(1, lines.size),
        };
      };

      // ── canva-text-background-hug:start
      // Canva draws a text's Background effect around the ink of each line; the editor and the
      // app draw it around the text BOX. A one-line text in a wide box (a centred label in a
      // full-width box, as Canva lays most out) therefore needs its box hugged to the ink, shifted
      // by its alignment so the glyphs stay put — otherwise the pill spans the whole box (the
      // yellow "خصم خاص للأخوة" on DAHP0ZiJiNE came in as an 873 px bar). Multi-line texts keep
      // their box: it is the wrap width. Returns the box to use.
      const hugTextBoxToInk = ({ x, width, inkWidth, lineCount, align, slack = 2 }) => {
        const boxWidth = Number(width) || 0;
        const ink = Number(inkWidth) || 0;
        if (!(ink > 0) || Number(lineCount) !== 1 || boxWidth <= 0) return { x, width: boxWidth };
        const hugged = Math.min(boxWidth, Math.ceil(ink) + slack);
        if (boxWidth - hugged < 1) return { x, width: boxWidth };
        const normalizedAlign = String(align || "").toLowerCase();
        const shift = normalizedAlign === "center" ? (boxWidth - hugged) / 2 : normalizedAlign === "right" ? boxWidth - hugged : 0;
        return { x: (Number(x) || 0) + shift, width: hugged };
      };
      // ── canva-text-background-hug:end

      // Canva's shaped photo frames (arches, blobs, badges…) are a `shape` element whose image is
      // clipped by an SVG <clipPath> path — `clip-path: url(#id)` on a wrapper div. The importer
      // fetched the photo and dropped the clip, so an arch came in as a plain rectangle. Sample the
      // clip outline into a polygon in the frame's own 0..100 space (the editor's and the app's
      // frame-shape unit): userSpaceOnUse clip coordinates are the clipped element's CSS box, so
      // they normalise by its layout size; objectBoundingBox ones are already 0..1.
      // Canva also writes a clip INLINE as a CSS `clip-path: path("M …")` in the clipped element's
      // own px — that is how an image's "corner rounding" is drawn. Read its path data.
      const readCssClipPathData = (element) => {
        const clip = String(window.getComputedStyle(element).clipPath || "");
        const match = clip.match(/^path\(\s*(?:(?:nonzero|evenodd)\s*,\s*)?(["'])([\s\S]*)\1\s*\)$/);
        return match ? match[2] : "";
      };
      const detachedSvgPath = (d) => {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        return path;
      };

      // ── canva-rounded-rect-fit:start
      // The corner radius of the rounded rectangle that traces an outline sampled in px, as a
      // fraction of its shorter side (0..0.5) — or null when none fits within a hair: square
      // corners, an arch, an ellipse, any free shape. Pure, so it is tested on its own
      // (extensions/canva-importer/test/rounded-rect-clip.test.mjs).
      const fitRoundedRectCornerFraction = (points) => {
        if (!Array.isArray(points) || points.length < 8) return null;
        const xs = points.map(([x]) => x);
        const ys = points.map(([, y]) => y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const width = Math.max(...xs) - minX;
        const height = Math.max(...ys) - minY;
        const shorter = Math.min(width, height);
        if (!(shorter > 0)) return null;
        // Distance from a point to the outline of a width×height rectangle with corner radius r.
        const outlineDistance = ([px, py], radius) => {
          const x = px - minX;
          const y = py - minY;
          const cx = Math.min(Math.max(x, radius), width - radius);
          const cy = Math.min(Math.max(y, radius), height - radius);
          if (x >= radius && x <= width - radius) return Math.min(Math.abs(y), Math.abs(height - y));
          if (y >= radius && y <= height - radius) return Math.min(Math.abs(x), Math.abs(width - x));
          return Math.abs(Math.hypot(x - cx, y - cy) - radius);
        };
        let best = { radius: 0, error: Infinity };
        const STEPS = 200;
        for (let step = 0; step <= STEPS; step += 1) {
          const radius = (shorter / 2) * (step / STEPS);
          let worst = 0;
          for (const point of points) {
            worst = Math.max(worst, outlineDistance(point, radius));
            if (worst >= best.error) break;
          }
          if (worst < best.error) best = { radius, error: worst };
        }
        if (best.error > Math.max(0.6, shorter * 0.008) || best.radius < 0.5) return null;
        return Math.min(0.5, best.radius / shorter);
      };
      // ── canva-rounded-rect-fit:end

      // A CSS path() clip that traces a ROUNDED RECTANGLE over its whole element — Canva's image
      // corner rounding (a pill behind a URL imported with square corners: only url(#clipPath)
      // masks were read, and the radius lives under a minified model key). The radius comes back
      // as a fraction of the box's shorter side, which the editor and the app reproduce exactly
      // with the image's own corner radius. Anything else → null (the frame-mask path samples it).
      const detectRoundedRectClip = (layerNode) => {
        try {
          if (!layerNode) return null;
          const element = [layerNode, ...Array.from(layerNode.querySelectorAll("*"))].find(
            (candidate) =>
              (candidate === layerNode || !isInsideForeignLayer(candidate, layerNode)) && readCssClipPathData(candidate)
          );
          if (!element) return null;
          const path = detachedSvgPath(readCssClipPathData(element));
          const total = path.getTotalLength();
          if (!(total > 0)) return null;
          const SAMPLES = 360;
          const points = [];
          for (let index = 0; index < SAMPLES; index += 1) {
            const point = path.getPointAtLength((total * index) / SAMPLES);
            points.push([point.x, point.y]);
          }
          const xs = points.map(([x]) => x);
          const ys = points.map(([, y]) => y);
          const [minX, minY, maxX, maxY] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
          // The clip must cover the element's own box, or it is a shape inside it, not its corners.
          const boxWidth = element.offsetWidth;
          const boxHeight = element.offsetHeight;
          if (!(boxWidth > 0 && boxHeight > 0)) return null;
          if (Math.abs(minX) > 1.5 || Math.abs(minY) > 1.5 || Math.abs(maxX - boxWidth) > 1.5 || Math.abs(maxY - boxHeight) > 1.5) {
            return null;
          }
          const fraction = fitRoundedRectCornerFraction(points);
          return fraction === null ? null : { fraction };
        } catch (_error) {
          return null;
        }
      };

      // ── canva-clip-window:start
      // A clip whose outline sits well inside the clipped element's box is a WINDOW (a polaroid's
      // photo opening), not the element's silhouette: the frame then IS that window. Everything is
      // measured in the layer's own un-rotated layout px (see localBoxWithin), so a tilted polaroid
      // works like a straight one. Returns the window as fractions of the layer's frame, plus the
      // slice of the media that shows through it (window ∩ media, as fractions of the media), or
      // null when the outline fills the box, i.e. a plain shaped mask like an arch.
      const clipWindowGeometry = ({ bounds, boxWidth, boxHeight, clippedLocal, layerWidth, layerHeight, mediaLocal }) => {
        if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return null;
        if (!(boxWidth > 0) || !(boxHeight > 0)) return null;
        const inset =
          bounds.x > boxWidth * 0.02 ||
          bounds.y > boxHeight * 0.02 ||
          bounds.x + bounds.width < boxWidth * 0.98 ||
          bounds.y + bounds.height < boxHeight * 0.98;
        if (!inset) return null;
        if (!clippedLocal || !(clippedLocal.width > 0) || !(clippedLocal.height > 0)) return null;
        if (!(layerWidth > 0) || !(layerHeight > 0)) return null;
        const scaleX = clippedLocal.width / boxWidth;
        const scaleY = clippedLocal.height / boxHeight;
        const clamp01 = (value) => Math.max(0, Math.min(1, value));
        let crop = null;
        if (mediaLocal && mediaLocal.width > 0 && mediaLocal.height > 0) {
          const left = Math.max(bounds.x, mediaLocal.x);
          const top = Math.max(bounds.y, mediaLocal.y);
          const right = Math.min(bounds.x + bounds.width, mediaLocal.x + mediaLocal.width);
          const bottom = Math.min(bounds.y + bounds.height, mediaLocal.y + mediaLocal.height);
          if (right - left > 0 && bottom - top > 0) {
            crop = {
              x: clamp01((left - mediaLocal.x) / mediaLocal.width),
              y: clamp01((top - mediaLocal.y) / mediaLocal.height),
              width: clamp01((right - left) / mediaLocal.width),
              height: clamp01((bottom - top) / mediaLocal.height),
            };
          }
        }
        return {
          x: (clippedLocal.x + bounds.x * scaleX) / layerWidth,
          y: (clippedLocal.y + bounds.y * scaleY) / layerHeight,
          width: (bounds.width * scaleX) / layerWidth,
          height: (bounds.height * scaleY) / layerHeight,
          crop,
        };
      };

      // Where the window frame sits on the page: its box is the layer's un-rotated frame scaled by
      // the window's fractions; its centre is the layer's centre moved by the window's offset,
      // turned with the layer, since that offset runs along the layer's own axes.
      const placeClipWindow = ({ frameWidth, frameHeight, centerX, centerY, angle, opening }) => {
        const width = frameWidth * opening.width;
        const height = frameHeight * opening.height;
        const dx = (opening.x + opening.width / 2 - 0.5) * frameWidth;
        const dy = (opening.y + opening.height / 2 - 0.5) * frameHeight;
        const radians = ((Number(angle) || 0) * Math.PI) / 180;
        return {
          width,
          height,
          centerX: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
          centerY: centerY + dx * Math.sin(radians) + dy * Math.cos(radians),
        };
      };
      // ── canva-clip-window:end

      // An element's box in an ancestor's own (un-rotated) layout px: its layout offsets plus the
      // translate/scale transforms between the two. Null when a rotation, skew or flip sits in
      // between — the box is then not axis-aligned in that space and the window path stays off.
      const localBoxWithin = (element, ancestor) => {
        if (!element || !ancestor || !ancestor.contains(element) || element === ancestor) return null;
        let box = { x: 0, y: 0, width: element.offsetWidth, height: element.offsetHeight };
        for (let node = element; node && node !== ancestor; node = node.parentElement) {
          const style = window.getComputedStyle(node);
          const transformText = String(style.transform || "").trim();
          if (transformText && transformText !== "none") {
            let matrix = null;
            try {
              matrix = new DOMMatrixReadOnly(transformText);
            } catch (_error) {
              return null;
            }
            if (!matrix.is2D) return null;
            const { a, b, c, d, e, f } = matrix;
            if (Math.abs(b) > 0.001 || Math.abs(c) > 0.001 || !(a > 0) || !(d > 0)) return null;
            const origin = String(style.transformOrigin || "").split(/\s+/).map((value) => Number.parseFloat(value) || 0);
            const originX = origin[0] || 0;
            const originY = origin[1] || 0;
            box = {
              x: originX + (box.x - originX) * a + e,
              y: originY + (box.y - originY) * d + f,
              width: box.width * a,
              height: box.height * d,
            };
          }
          const parent = node.parentElement;
          if (!parent) return null;
          if (node.offsetParent === parent) {
            box = { ...box, x: box.x + node.offsetLeft, y: box.y + node.offsetTop };
          } else if (node.offsetLeft || node.offsetTop) {
            return null;
          }
        }
        return box;
      };

      const detectClipPathFrameMask = (layerNode, imageElement = null, options = {}) => {
        if (!layerNode) return null;
        const isClippedElement = (element) => {
          const clip = window.getComputedStyle(element).clipPath;
          return typeof clip === "string" && (clip.startsWith("url(") || clip.startsWith("path("));
        };
        // The clip that shapes the PHOTO is the one on its own wrapper. A Canva polaroid stacks a
        // card (clipped to its outline minus the photo window), the photo inside the window and
        // two trim rings; document order found the card first, so the polygon was that ring and
        // the photo showed only AROUND its window (DAHR4NoHFpw's three postcards).
        let clipped = null;
        for (let element = imageElement; element && layerNode.contains(element); element = element.parentElement) {
          if (isClippedElement(element)) {
            clipped = element;
            break;
          }
          if (element === layerNode) break;
        }
        if (!clipped) {
          clipped = [layerNode, ...Array.from(layerNode.querySelectorAll("*"))].find((element) => {
            if (element !== layerNode && isInsideForeignLayer(element, layerNode)) return false;
            return isClippedElement(element);
          });
        }
        if (!clipped) return null;
        const cssPathData = readCssClipPathData(clipped);
        let path = null;
        let boundingBoxUnits = false;
        if (cssPathData) {
          path = detachedSvgPath(cssPathData);
        } else {
          const id = /url\(["']?#([^"')]+)["']?\)/.exec(window.getComputedStyle(clipped).clipPath || "")?.[1];
          const clipElement = id ? document.getElementById(id) : null;
          const paths = clipElement ? Array.from(clipElement.querySelectorAll("path")) : [];
          if (paths.length !== 1 || typeof paths[0].getTotalLength !== "function") return null;
          path = paths[0];
          boundingBoxUnits = clipElement.getAttribute("clipPathUnits") === "objectBoundingBox";
        }
        const boxWidth = clipped.offsetWidth || clipped.getBoundingClientRect().width;
        const boxHeight = clipped.offsetHeight || clipped.getBoundingClientRect().height;
        if (!boundingBoxUnits && !(boxWidth > 0 && boxHeight > 0)) return null;
        let total = 0;
        try {
          total = path.getTotalLength();
        } catch (_error) {
          return null;
        }
        if (!(total > 0)) return null;
        // The outline's own bounds: a window frame normalises its polygon to them, so the frame
        // box is the window and the photo inside is clipped to its real opening.
        const fullWidth = boundingBoxUnits ? 1 : boxWidth;
        const fullHeight = boundingBoxUnits ? 1 : boxHeight;
        let bounds = { x: 0, y: 0, width: fullWidth, height: fullHeight };
        let opening = null;
        if (options.allowWindow && !cssPathData) {
          let bbox = null;
          try {
            bbox = path.getBBox();
          } catch (_error) {
            bbox = null;
          }
          if (bbox && bbox.width > 0 && bbox.height > 0) {
            // objectBoundingBox outlines are 0..1 of the clipped box; bring them to its px.
            const unitX = boundingBoxUnits ? boxWidth : 1;
            const unitY = boundingBoxUnits ? boxHeight : 1;
            opening = clipWindowGeometry({
              bounds: { x: bbox.x * unitX, y: bbox.y * unitY, width: bbox.width * unitX, height: bbox.height * unitY },
              boxWidth,
              boxHeight,
              clippedLocal: localBoxWithin(clipped, layerNode),
              layerWidth: layerNode.offsetWidth,
              layerHeight: layerNode.offsetHeight,
              mediaLocal: imageElement ? localBoxWithin(imageElement, clipped) : null,
            });
            if (opening) bounds = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
          }
        }
        // Sample about every 0.25% of the box's shorter side along the outline: 160 samples drew
        // DAHR4D4QJR4's torn-paper edge (a 1142-unit path round a 302x256 box) as 90 soft bumps
        // where Canva has hundreds of sharp ones. Straight runs still collapse to their ends below.
        const outlineLength = boundingBoxUnits
          ? total * 100
          : (total / Math.max(1, Math.min(boxWidth, boxHeight))) * 100;
        const SAMPLES = Math.max(160, Math.min(2000, Math.round(outlineLength / 0.25)));
        const raw = [];
        for (let index = 0; index < SAMPLES; index += 1) {
          const point = path.getPointAtLength((total * index) / SAMPLES);
          const x = ((point.x - bounds.x) / bounds.width) * 100;
          const y = ((point.y - bounds.y) / bounds.height) * 100;
          raw.push([Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y))]);
        }
        // Drop points a straight line already explains (Ramer–Douglas–Peucker, 0.12% of the box):
        // straight sides collapse to their ends, curves keep their samples.
        const simplify = (points, tolerance) => {
          if (points.length < 3) return points;
          const [ax, ay] = points[0];
          const [bx, by] = points[points.length - 1];
          const length = Math.hypot(bx - ax, by - ay) || 1;
          let worst = 0;
          let worstIndex = 0;
          for (let index = 1; index < points.length - 1; index += 1) {
            const [px, py] = points[index];
            const distance = Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / length;
            if (distance > worst) {
              worst = distance;
              worstIndex = index;
            }
          }
          if (worst <= tolerance) return [points[0], points[points.length - 1]];
          const left = simplify(points.slice(0, worstIndex + 1), tolerance);
          const right = simplify(points.slice(worstIndex), tolerance);
          return [...left.slice(0, -1), ...right];
        };
        // A closed ring has no baseline (its ends coincide), so split it at the point farthest
        // from the start and simplify the two open halves.
        let far = 0;
        let farDistance = -1;
        raw.forEach(([x, y], index) => {
          const distance = Math.hypot(x - raw[0][0], y - raw[0][1]);
          if (distance > farDistance) {
            farDistance = distance;
            far = index;
          }
        });
        const firstHalf = simplify(raw.slice(0, far + 1), 0.12);
        const secondHalf = simplify([...raw.slice(far), raw[0]], 0.12);
        const simplified = [...firstHalf.slice(0, -1), ...secondHalf.slice(0, -1)];
        if (simplified.length < 3) return null;
        // A clip that is just the box itself is not a shape worth a frame — unless it is a window,
        // where the frame is the point.
        const onEdge = (value) => value <= 0.5 || value >= 99.5;
        if (!opening && simplified.length <= 4 && simplified.every(([x, y]) => onEdge(x) && onEdge(y))) return null;
        return {
          points: simplified.flatMap(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]),
          window: opening,
        };
      };

      const resolveEffectiveFontWeight = (styleElement, ownerNode, fallbackStyle) => {
        const root = styleElement || ownerNode;
        const fallback = parseFontWeight(fallbackStyle?.fontWeight);
        if (!root || !root.querySelectorAll) return fallback;
        const leaves = Array.from(root.querySelectorAll("span,p,div,b,strong")).filter(
          (el) =>
            el.children.length === 0 &&
            !isInsideForeignLayer(el, ownerNode || root) &&
            String(el.textContent || "").trim()
        );
        let best = null;
        let bestScore = -1;
        for (let index = 0; index < leaves.length; index += 1) {
          const el = leaves[index];
          const style = window.getComputedStyle(el);
          const fontSize = Number.parseFloat(style.fontSize || "") || 0;
          const textLen = String(el.textContent || "").trim().length;
          // Favor the largest, longest glyph run (the layer's dominant text).
          const score = fontSize * 100 + textLen;
          if (score > bestScore) {
            bestScore = score;
            best = el;
          }
        }
        if (!best) return fallback;
        return parseFontWeight(window.getComputedStyle(best).fontWeight);
      };

      const findCustomFontSizeFromNode = (element, stopAtNode) => {
        let node = element;
        let depth = 0;
        while (node && node !== stopAtNode && depth < 10) {
          const style = node.style;
          const raw = style?.getPropertyValue?.("--H97cbQ") || "";
          const px = parseNumericPx(raw);
          if (px > 0) return px;
          node = node.parentElement;
          depth += 1;
        }
        return 0;
      };

      // A GENUINE mask = the frame actually clips the image: the image extends BEYOND its own
      // layer frame, OR a shape clip (clip-path / mask-image / rounded corners), OR an
      // object-fit crop. Plain `overflow:hidden` where the image == its frame is NOT a mask —
      // that's a bleed element whose frame merely extends past the canvas, and it must keep its
      // full asset + full geometry (the editor clips it for display, like Canva). Used for the
      // geometry/crop decision; the broader detectMaskedImageLayer still drives snapshot logic.
      const isGenuinelyMaskedImageLayer = (layerNode, imageElement) => {
        if (!layerNode || !imageElement) return false;
        const imageStyle = window.getComputedStyle(imageElement);
        if (imageStyle.objectFit === "cover" || imageStyle.objectFit === "contain") return true;
        let node = imageElement;
        let depth = 0;
        while (node && depth < 10) {
          const style = window.getComputedStyle(node);
          if (
            style.clipPath !== "none" ||
            style.maskImage !== "none" ||
            (style.webkitMaskImage && style.webkitMaskImage !== "none") ||
            parseNumericPx(style.borderRadius) > 2
          ) {
            return true;
          }
          if (node === layerNode) break;
          node = node.parentElement;
          depth += 1;
        }
        const imgRect = imageElement.getBoundingClientRect();
        const frameRect = layerNode.getBoundingClientRect();
        const margin = 2;
        return (
          imgRect.left < frameRect.left - margin ||
          imgRect.top < frameRect.top - margin ||
          imgRect.right > frameRect.right + margin ||
          imgRect.bottom > frameRect.bottom + margin
        );
      };

      const detectMaskedImageLayer = (layerNode, imageElement, viewportRect) => {
        if (!layerNode || !imageElement || !viewportRect) return false;
        const layerStyle = window.getComputedStyle(layerNode);
        const imageStyle = window.getComputedStyle(imageElement);
        const imageRect = imageElement.getBoundingClientRect();
        // Compare the image against the layer's FULL bounds, not the page-clipped
        // viewportRect. Otherwise an image that merely bleeds off the page edge
        // (common for decorative florals/borders) looks "clipped" relative to the
        // clipped rect and gets mis-flagged as masked — then cropped to only the
        // visible portion. A genuine frame/mask clips the image inside its own
        // layer box, which comparing against layerBounds still detects correctly.
        const layerBoundsRect = layerNode.getBoundingClientRect();
        const maskReferenceRect =
          layerBoundsRect && layerBoundsRect.width > 1 && layerBoundsRect.height > 1
            ? layerBoundsRect
            : viewportRect;
        const imageArea = Math.max(0, imageRect.width) * Math.max(0, imageRect.height);
        const layerArea = Math.max(0, maskReferenceRect.width) * Math.max(0, maskReferenceRect.height);
        const clippedByArea = imageArea > 1 && layerArea > 1 && imageArea > layerArea * 1.18;
        const ratioLayer = maskReferenceRect.width / Math.max(1, maskReferenceRect.height);
        const ratioImage = imageRect.width / Math.max(1, imageRect.height);
        const ratioDelta = Math.abs(ratioLayer - ratioImage);
        let hasMaskSignals = false;
        let node = imageElement;
        let depth = 0;
        while (node && node !== layerNode && depth < 10) {
          const style = window.getComputedStyle(node);
          if (
            style.overflow !== "visible" ||
            style.clipPath !== "none" ||
            style.maskImage !== "none" ||
            style.webkitMaskImage !== "none" ||
            parseNumericPx(style.borderRadius) > 0
          ) {
            hasMaskSignals = true;
            break;
          }
          node = node.parentElement;
          depth += 1;
        }
        return (
          hasMaskSignals ||
          layerStyle.overflow !== "visible" ||
          imageStyle.objectFit === "cover" ||
          imageStyle.objectFit === "contain" ||
          ratioDelta > 0.22 ||
          clippedByArea
        );
      };

      // Canva renders ONE logical image as several stacked <img> at IDENTICAL geometry
      // (responsive srcset variants: e.g. a 200px, 1600px and 2400px copy of the same art).
      // Those are NOT a composite — treating them as one forced every image layer down the
      // rendered-snapshot path, which crops any layer that bleeds off the canvas to its visible
      // slice. A genuine composite/overlay sits at a DIFFERENT rect than the main image.
      const occupiesSameRectAsMain = (candidate, mainRect) => {
        if (!candidate || !mainRect) return false;
        const r = candidate.getBoundingClientRect();
        return (
          Math.abs(r.left - mainRect.left) <= 2 &&
          Math.abs(r.top - mainRect.top) <= 2 &&
          Math.abs(r.width - mainRect.width) <= 2 &&
          Math.abs(r.height - mainRect.height) <= 2
        );
      };

      const shouldPreferRenderedImageSnapshot = (layerNode, imageElement) => {
        if (!layerNode || !imageElement) return false;
        // Only rotation / flip / reflection genuinely need the rendered snapshot. Canva sizes
        // EVERY image with a CSS transform:scale(...), and a pure scale is faithfully
        // reproduced by the fetched asset at the layer's geometry — using the scale-sensitive
        // hasMeaningfulTransformBetween here forced every image layer down the snapshot path,
        // which crops any layer that bleeds off the canvas to its on-screen slice.
        if (hasRotationOrFlipBetween(imageElement, layerNode)) return true;

        const mainRect = imageElement.getBoundingClientRect();
        const renderableDescendants = Array.from(
          layerNode.querySelectorAll("img, image, svg, canvas")
        ).filter(
          (candidate) =>
            !isInsideForeignLayer(candidate, layerNode) &&
            candidate !== imageElement &&
            !candidate.contains?.(imageElement) &&
            // ignore stacked responsive <img> duplicates of the same image
            !(candidate.tagName === "IMG" && occupiesSameRectAsMain(candidate, mainRect))
        );
        if (renderableDescendants.length > 0) return true;

        if (findCssImageUrl(layerNode)) return true;

        const primarySource = getImageElementSource(imageElement);
        const siblingSources = getScopedImageElements(layerNode)
          .filter(
            (candidate) =>
              candidate !== imageElement && !occupiesSameRectAsMain(candidate, mainRect)
          )
          .map((candidate) => getImageElementSource(candidate))
          .filter(Boolean);
        return siblingSources.some((candidate) => candidate !== primarySource);
      };

      // True when the layer's final look CANNOT be faithfully reproduced by cropping the
      // original fetched asset to its visible rectangle — i.e. the rendered snapshot is
      // genuinely required, not just a lossy fallback. Covers: shaped masks / clip-paths /
      // rounded corners, rotation / flip / reflection, multi-source compositing, and baked
      // pixel effects (CSS filter / backdrop-filter / blend mode) that the raw asset lacks.
      // A plain rectangular (possibly zoomed/panned) crop of an unmodified photo returns
      // false, so it can use the high-resolution asset crop instead of a low-res screenshot.
      //
      // modelBorder: the fiber model's { strokeColor, strokeWidth, cornerRadius, rectFrame }
      // for photo frames. When the model confirms a PLAIN RECT frame (rectFrame), the editor
      // reproduces frame + corner radius + stroke exactly from the fetched asset, so NO DOM
      // signal (SVG clipPath, border-radius, the outline <svg>, responsive <img> duplicates)
      // justifies the snapshot — critically, the isolation snapshot diffs out any overlapping
      // layer drawn above the photo (both captures show it → diff = transparent), punching a
      // hole through the stored pixels right where e.g. a button pill sits on the photo, and
      // bakes the frame stroke into the edge pixels.
      // ── canva-grid-cells:start
      // The cells of a Canva GRID element as the page lays them out: each cell is the nearest
      // clipping box (overflow ≠ visible) around a photo, and a real grid's cells sit side by side
      // inside the element without covering each other. Takes [{key, rect}] (screen rects, one per
      // photo, already grouped by cell) and the element's rect; returns the cells in reading order,
      // or [] when they do not look like a grid (fewer than two, overlapping, outside the element,
      // or covering too little of it). DAHQBtMqXd8's before/after post is one 2-cell grid: a
      // black-and-white photo and a colour one, which imported as ONE colour photo over both halves.
      const resolveGridCells = (cells, elementRect) => {
        const list = (Array.isArray(cells) ? cells : []).filter(
          (cell) => cell && cell.rect && cell.rect.width > 1 && cell.rect.height > 1
        );
        if (list.length < 2 || !elementRect || !(elementRect.width > 0) || !(elementRect.height > 0)) return [];
        const slack = 2;
        const inside = (r) =>
          r.left >= elementRect.left - slack &&
          r.top >= elementRect.top - slack &&
          r.left + r.width <= elementRect.left + elementRect.width + slack &&
          r.top + r.height <= elementRect.top + elementRect.height + slack;
        if (!list.every((cell) => inside(cell.rect))) return [];
        for (let i = 0; i < list.length; i += 1) {
          for (let j = i + 1; j < list.length; j += 1) {
            const a = list[i].rect;
            const b = list[j].rect;
            const overlapW = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
            const overlapH = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
            const overlap = overlapW > 0 && overlapH > 0 ? overlapW * overlapH : 0;
            const smaller = Math.min(a.width * a.height, b.width * b.height);
            if (overlap > smaller * 0.02) return [];
          }
        }
        const covered = list.reduce((sum, cell) => sum + cell.rect.width * cell.rect.height, 0);
        if (covered < elementRect.width * elementRect.height * 0.5) return [];
        return list
          .slice()
          .sort((a, b) => (Math.abs(a.rect.top - b.rect.top) > 2 ? a.rect.top - b.rect.top : a.rect.left - b.rect.left));
      };
      // ── canva-grid-cells:end

      // ── canva-whole-box-clip:start
      // Whether a clip outline is just the clipped element's own rectangle: Canva wraps every
      // cropped photo in a `clip-path: url(#…)` whose path is M0,0 L w,0 L w,h L 0,h Z on the
      // wrapper's own box — a no-op that the fetched asset, cropped to the frame, reproduces
      // exactly. Read as a mask it forced the isolation snapshot, which cannot recover a
      // translucent photo: DAHR9xcvsOU's 11%-opacity clock tower came back as a blue page capture
      // with the price card baked in. Straight segments only, every corner present, within 1%.
      const isWholeBoxRectPath = (d, boxWidth, boxHeight) => {
        const source = String(d || "").trim();
        const width = Number(boxWidth);
        const height = Number(boxHeight);
        if (!source || !(width > 0) || !(height > 0)) return false;
        if (/[^MmLlHhVvZz0-9eE.,+\-\s]/.test(source)) return false;
        const tokens = source.match(/[MmLlHhVvZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || [];
        if (!/^[Mm]$/.test(tokens[0] || "")) return false;
        const points = [];
        let command = "";
        let x = 0;
        let y = 0;
        let index = 0;
        const next = () => Number(tokens[index++]);
        while (index < tokens.length) {
          if (/^[A-Za-z]$/.test(tokens[index])) {
            command = tokens[index++];
            if (command === "Z" || command === "z") continue;
          }
          if (!command || command === "Z" || command === "z") return false;
          const relative = command === command.toLowerCase();
          const upper = command.toUpperCase();
          if (upper === "M" || upper === "L") {
            const nx = next();
            const ny = next();
            if (!Number.isFinite(nx) || !Number.isFinite(ny)) return false;
            x = relative ? x + nx : nx;
            y = relative ? y + ny : ny;
            if (upper === "M") command = relative ? "l" : "L";
          } else if (upper === "H") {
            const nx = next();
            if (!Number.isFinite(nx)) return false;
            x = relative ? x + nx : nx;
          } else if (upper === "V") {
            const ny = next();
            if (!Number.isFinite(ny)) return false;
            y = relative ? y + ny : ny;
          } else {
            return false;
          }
          points.push([x, y]);
          if (points.length > 12) return false;
        }
        const tolX = Math.max(1, width * 0.01);
        const tolY = Math.max(1, height * 0.01);
        const near = (value, target, tolerance) => Math.abs(value - target) <= tolerance;
        const onCorner = ([px, py]) =>
          (near(px, 0, tolX) || near(px, width, tolX)) && (near(py, 0, tolY) || near(py, height, tolY));
        if (points.length < 4 || !points.every(onCorner)) return false;
        const corners = [[0, 0], [width, 0], [width, height], [0, height]];
        return corners.every(([cx, cy]) => points.some(([px, py]) => near(px, cx, tolX) && near(py, cy, tolY)));
      };
      // ── canva-whole-box-clip:end

      // The DOM side: an element whose clip is a url(#id) to a single path, or an inline path(),
      // that only traces its own box.
      const clipIsElementsOwnBox = (element) => {
        try {
          const clip = String(window.getComputedStyle(element).clipPath || "");
          let d = readCssClipPathData(element);
          let unitsWidth = element.offsetWidth;
          let unitsHeight = element.offsetHeight;
          if (!d) {
            const id = /url\(["']?#([^"')]+)["']?\)/.exec(clip)?.[1];
            const clipElement = id ? document.getElementById(id) : null;
            const shapes = clipElement ? Array.from(clipElement.children) : [];
            if (shapes.length !== 1 || String(shapes[0].tagName).toLowerCase() !== "path") return false;
            if (shapes[0].getAttribute("transform")) return false;
            d = shapes[0].getAttribute("d") || "";
            if (clipElement.getAttribute("clipPathUnits") === "objectBoundingBox") {
              unitsWidth = 1;
              unitsHeight = 1;
            }
          }
          return isWholeBoxRectPath(d, unitsWidth, unitsHeight);
        } catch (_error) {
          return false;
        }
      };

      // ── canva-plain-model-image:start
      // A model-confirmed PLAIN picture: a `rect` element whose fill is one media drawn over its
      // whole frame (no in-frame crop). The fetched asset reproduces it exactly — the editor applies
      // the layer's own angle and flips — so nothing ELSE found inside its node (a second <img>,
      // a CSS image, a differing source) can be part of the design: it is Canva chrome. Such a
      // layer is never a "composite"; only a real mask, filter, blend or DOM rotation still needs
      // the snapshot. DAHYoZnBs9Y's three 800 px timeline dots were "composites" at import time
      // and came back as 33 px screen crops (the one whose isolation failed kept its asset).
      // A model crop that covers the element's whole frame is no crop (every photo carries one).
      const cropCoversFrame = (crop, width, height) =>
        !crop ||
        (Math.abs(Number(crop.left) || 0) < 1 &&
          Math.abs(Number(crop.top) || 0) < 1 &&
          Math.abs((Number(crop.width) || 0) - (Number(width) || 0)) < 2 &&
          Math.abs((Number(crop.height) || 0) - (Number(height) || 0)) < 2);
      const isPlainModelImage = (modelEntry) =>
        Boolean(modelEntry) &&
        String(modelEntry.elementType || "") === "rect" &&
        Boolean(modelEntry.image && modelEntry.image.mediaId) &&
        cropCoversFrame(modelEntry.image.crop, modelEntry.width, modelEntry.height);
      // ── canva-plain-model-image:end

      // Returns WHY the rendered snapshot is required for the layer ("" when the fetched asset,
      // cropped to the visible rectangle, reproduces it): "rotation", "clip", "mask", "radius",
      // "filter", "backdrop-filter", "blend", "composite", "css-image" or "sources". The reason
      // rides on the layer's fallbackReason so a bad pick is readable from the stored template.
      const snapshotRequiredForLayer = (layerNode, imageElement, modelBorder, options = {}) => {
        if (!layerNode || !imageElement) return "";
        if (hasRotationOrFlipBetween(imageElement, layerNode)) return "rotation";
        // A rect OR round frame is fully reproducible from the fetched asset — the editor applies
        // the frame itself (cornerRadius + stroke for a rect, an ellipse mask via `mediaShape` for
        // a round one, at any aspect) — so no DOM signal justifies the snapshot. That matters most
        // for the ROUND frames: the isolation snapshot has no alpha outside the mask, so a
        // circular photo came back as an opaque square with the page baked into its corners.
        if (modelBorder && (modelBorder.rectFrame || modelBorder.circleFrame)) return "";
        const modelHandlesRoundedCorners = Number(modelBorder?.cornerRadius) > 0;
        let node = imageElement;
        let depth = 0;
        while (node && depth < 12) {
          const style = window.getComputedStyle(node);
          if (style.clipPath !== "none" && !clipIsElementsOwnBox(node)) return "clip";
          if (style.maskImage !== "none" || style.webkitMaskImage !== "none") return "mask";
          if (!modelHandlesRoundedCorners && parseNumericPx(style.borderRadius) > 2) return "radius";
          if (style.filter && style.filter !== "none") return "filter";
          if (style.backdropFilter && style.backdropFilter !== "none") return "backdrop-filter";
          if (style.mixBlendMode && style.mixBlendMode !== "normal") return "blend";
          if (node === layerNode) break;
          node = node.parentElement;
          depth += 1;
        }
        // The model holds one media for a plain picture: whatever else sits in its node is chrome.
        if (options.plainModelImage) return "";
        const mainRect = imageElement.getBoundingClientRect();
        // Canva stacks a placeholder <img> and the real asset at IDENTICAL geometry; the pair is
        // one picture, not a composite (shouldPreferRenderedImageSnapshot skips it the same way).
        const isStackedCopy = (candidate) =>
          candidate.tagName === "IMG" && occupiesSameRectAsMain(candidate, mainRect);
        const renderableDescendants = Array.from(
          layerNode.querySelectorAll("img, image, svg, canvas")
        ).filter(
          (candidate) =>
            !isInsideForeignLayer(candidate, layerNode) &&
            candidate !== imageElement &&
            !candidate.contains?.(imageElement) &&
            !isStackedCopy(candidate)
        );
        if (renderableDescendants.length > 0) return "composite";
        if (findCssImageUrl(layerNode)) return "css-image";
        const primaryImageSource = getImageElementSource(imageElement);
        const otherImageSources = getScopedImageElements(layerNode)
          .filter((candidate) => candidate !== imageElement && !isStackedCopy(candidate))
          .map((candidate) => getImageElementSource(candidate))
          .filter(Boolean);
        return otherImageSources.some((candidate) => candidate !== primaryImageSource) ? "sources" : "";
      };

      const resolveThinVectorStrokeStyle = (layerNode) => {
        const svgCandidate = findBestSvgRenderCandidate(layerNode);
        if (!(svgCandidate instanceof SVGElement)) {
          return { color: "", strokeOnly: false };
        }
        const vectorNodes = Array.from(
          svgCandidate.querySelectorAll("path,line,polyline,polygon,rect,ellipse,circle")
        ).filter((candidate) => !candidate.closest("defs"));
        let bestColor = "";
        let bestStrokeOnly = false;
        let bestDashed = false;
        let bestScore = -1;

        for (let index = 0; index < vectorNodes.length; index += 1) {
          const candidate = vectorNodes[index];
          const style = window.getComputedStyle(candidate);
          const opacity = Number(style.opacity);
          if (Number.isFinite(opacity) && opacity <= 0.01) continue;
          const stroke = String(style.stroke || "").trim();
          const fill = String(style.fill || "").trim();
          const strokeWidth = parseNumericPx(style.strokeWidth || "");
          const rect = candidate.getBoundingClientRect();
          const score = Math.max(1, rectArea(rect)) + strokeWidth * 10;
          const strokeVisible = !isTransparentColor(stroke);
          const fillVisible = !isTransparentColor(fill);
          if (!strokeVisible && !fillVisible) continue;
          if (score <= bestScore) continue;
          bestScore = score;
          bestColor = strokeVisible ? stroke : fill;
          bestStrokeOnly = strokeVisible && !fillVisible;
          // A dotted/dashed rule (stroke-dasharray) is not a solid bar: it keeps its SVG image
          // instead of becoming a plain rect (DAHFEg4hhOk's dotted signature lines came in solid).
          const dashArray = String(style.strokeDasharray || "").trim().toLowerCase();
          bestDashed = strokeVisible && Boolean(dashArray) && dashArray !== "none" && dashArray !== "0" && dashArray !== "0px";
        }

        if (!bestColor) {
          const svgStyle = window.getComputedStyle(svgCandidate);
          const svgStroke = String(svgStyle.stroke || "").trim();
          const svgFill = String(svgStyle.fill || "").trim();
          const svgStrokeVisible = !isTransparentColor(svgStroke);
          const svgFillVisible = !isTransparentColor(svgFill);
          if (svgStrokeVisible || svgFillVisible) {
            bestColor = svgStrokeVisible ? svgStroke : svgFill;
            bestStrokeOnly = svgStrokeVisible && !svgFillVisible;
          }
        }

        return {
          color: bestColor,
          strokeOnly: bestStrokeOnly,
          dashed: bestDashed,
        };
      };

      const hasVisibleBackgroundPaint = (element) => {
        if (!element) return false;
        const bgImage = findCssImageUrl(element);
        if (bgImage) return true;
        const style = window.getComputedStyle(element);
        const bgColor = String(style.backgroundColor || "").trim().toLowerCase();
        return Boolean(bgColor && bgColor !== "transparent" && bgColor !== "rgba(0, 0, 0, 0)");
      };

      const renderElementToDataUrl = (element, targetWidth, targetHeight) => {
        if (!element) return "";
        try {
          const elementWidth = Number(element.naturalWidth || element.width?.baseVal?.value || element.width || 0);
          const elementHeight = Number(element.naturalHeight || element.height?.baseVal?.value || element.height || 0);
          const width = Math.max(1, Math.round(targetWidth || elementWidth || 1));
          const height = Math.max(1, Math.round(targetHeight || elementHeight || 1));
          const rasterCanvas = document.createElement("canvas");
          rasterCanvas.width = width;
          rasterCanvas.height = height;
          const rasterContext = rasterCanvas.getContext("2d");
          if (!rasterContext) return "";
          rasterContext.drawImage(element, 0, 0, width, height);
          return rasterCanvas.toDataURL("image/png");
        } catch (_error) {
          return "";
        }
      };

      const SVG_RENDER_STYLE_PROPERTIES = [
        "fill",
        "fill-rule",
        "fill-opacity",
        "stroke",
        "clip-rule",
        "stroke-opacity",
        "stroke-width",
        "stroke-linecap",
        "stroke-linejoin",
        "stroke-dasharray",
        "stroke-dashoffset",
        "opacity",
        "filter",
        "clip-path",
        "mask",
        "transform",
        "transform-origin",
        "mix-blend-mode",
      ];

      const copyComputedSvgStyles = (sourceNode, targetNode) => {
        if (!(sourceNode instanceof Element) || !(targetNode instanceof Element)) return;
        try {
          const computed = window.getComputedStyle(sourceNode);
          SVG_RENDER_STYLE_PROPERTIES.forEach((property) => {
            const value = computed.getPropertyValue(property);
            if (value) {
              targetNode.style.setProperty(property, value);
            }
          });
        } catch (_error) {
          // Ignore style copy failures and keep the inline SVG as-is.
        }

        const sourceChildren = Array.from(sourceNode.children || []);
        const targetChildren = Array.from(targetNode.children || []);
        const childCount = Math.min(sourceChildren.length, targetChildren.length);
        for (let index = 0; index < childCount; index += 1) {
          copyComputedSvgStyles(sourceChildren[index], targetChildren[index]);
        }
      };

      const extractUrlFragmentId = (value) => {
        const source = String(value || "");
        const match = source.match(/url\((['"]?)#([^'")]+)\1\)/i);
        return match?.[2] ? String(match[2]).trim() : "";
      };

      const createSvgBounds = (x, y, width, height) => {
        const left = Number(x);
        const top = Number(y);
        const boxWidth = Number(width);
        const boxHeight = Number(height);
        if (
          !Number.isFinite(left) ||
          !Number.isFinite(top) ||
          !Number.isFinite(boxWidth) ||
          !Number.isFinite(boxHeight) ||
          boxWidth <= 0 ||
          boxHeight <= 0
        ) {
          return null;
        }
        return {
          x: left,
          y: top,
          width: boxWidth,
          height: boxHeight,
          right: left + boxWidth,
          bottom: top + boxHeight,
        };
      };

      const mergeSvgBounds = (a, b) => {
        if (!a) return b || null;
        if (!b) return a || null;
        const left = Math.min(a.x, b.x);
        const top = Math.min(a.y, b.y);
        const right = Math.max(a.right ?? a.x + a.width, b.right ?? b.x + b.width);
        const bottom = Math.max(a.bottom ?? a.y + a.height, b.bottom ?? b.y + b.height);
        return createSvgBounds(left, top, right - left, bottom - top);
      };

      const addSvgPointToBounds = (bounds, x, y) => {
        const nextX = Number(x);
        const nextY = Number(y);
        if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return bounds || null;
        return mergeSvgBounds(bounds, createSvgBounds(nextX, nextY, 0.0001, 0.0001));
      };

      const parseSvgNumber = (value, fallback = 0) => {
        const numeric = Number.parseFloat(String(value || "").trim());
        return Number.isFinite(numeric) ? numeric : fallback;
      };

      const parseSvgNumberList = (value) =>
        (String(value || "").match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) || [])
          .map((item) => Number.parseFloat(item))
          .filter((item) => Number.isFinite(item));

      const hasSvgTransform = (element) => {
        if (!(element instanceof Element)) return false;
        const transformAttr = String(element.getAttribute("transform") || "").trim();
        const inlineTransform = String(element.style?.transform || "").trim();
        return Boolean(transformAttr || (inlineTransform && inlineTransform !== "none"));
      };

      const getPathDataBounds = (pathData) => {
        const tokens = String(pathData || "").match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/g) || [];
        if (tokens.length === 0) return null;

        let index = 0;
        let command = "";
        let x = 0;
        let y = 0;
        let startX = 0;
        let startY = 0;
        let bounds = null;
        const isCommandToken = (token) => /^[a-zA-Z]$/.test(String(token || ""));
        const readNumber = () => {
          if (index >= tokens.length || isCommandToken(tokens[index])) return null;
          const numeric = Number.parseFloat(tokens[index]);
          index += 1;
          return Number.isFinite(numeric) ? numeric : null;
        };
        const addPoint = (nextX, nextY) => {
          x = nextX;
          y = nextY;
          bounds = addSvgPointToBounds(bounds, x, y);
        };

        while (index < tokens.length) {
          if (isCommandToken(tokens[index])) {
            command = tokens[index];
            index += 1;
          }
          if (!command) break;

          const upper = command.toUpperCase();
          const relative = command === command.toLowerCase();

          if (upper === "Z") {
            addPoint(startX, startY);
            command = "";
            continue;
          }

          if (upper === "M" || upper === "L" || upper === "T") {
            let firstPair = true;
            while (index < tokens.length && !isCommandToken(tokens[index])) {
              const rawX = readNumber();
              const rawY = readNumber();
              if (rawX === null || rawY === null) break;
              const nextX = relative ? x + rawX : rawX;
              const nextY = relative ? y + rawY : rawY;
              addPoint(nextX, nextY);
              if (upper === "M" && firstPair) {
                startX = nextX;
                startY = nextY;
                command = relative ? "l" : "L";
              }
              firstPair = false;
            }
            continue;
          }

          if (upper === "H") {
            while (index < tokens.length && !isCommandToken(tokens[index])) {
              const rawX = readNumber();
              if (rawX === null) break;
              addPoint(relative ? x + rawX : rawX, y);
            }
            continue;
          }

          if (upper === "V") {
            while (index < tokens.length && !isCommandToken(tokens[index])) {
              const rawY = readNumber();
              if (rawY === null) break;
              addPoint(x, relative ? y + rawY : rawY);
            }
            continue;
          }

          if (upper === "C") {
            while (index < tokens.length && !isCommandToken(tokens[index])) {
              const values = Array.from({ length: 6 }, () => readNumber());
              if (values.some((value) => value === null)) break;
              for (let valueIndex = 0; valueIndex < values.length; valueIndex += 2) {
                const pointX = relative ? x + values[valueIndex] : values[valueIndex];
                const pointY = relative ? y + values[valueIndex + 1] : values[valueIndex + 1];
                bounds = addSvgPointToBounds(bounds, pointX, pointY);
              }
              x = relative ? x + values[4] : values[4];
              y = relative ? y + values[5] : values[5];
            }
            continue;
          }

          if (upper === "S" || upper === "Q") {
            while (index < tokens.length && !isCommandToken(tokens[index])) {
              const values = Array.from({ length: 4 }, () => readNumber());
              if (values.some((value) => value === null)) break;
              for (let valueIndex = 0; valueIndex < values.length; valueIndex += 2) {
                const pointX = relative ? x + values[valueIndex] : values[valueIndex];
                const pointY = relative ? y + values[valueIndex + 1] : values[valueIndex + 1];
                bounds = addSvgPointToBounds(bounds, pointX, pointY);
              }
              x = relative ? x + values[2] : values[2];
              y = relative ? y + values[3] : values[3];
            }
            continue;
          }

          if (upper === "A") {
            while (index < tokens.length && !isCommandToken(tokens[index])) {
              const values = Array.from({ length: 7 }, () => readNumber());
              if (values.some((value) => value === null)) break;
              const radiusX = Math.abs(Number(values[0] || 0));
              const radiusY = Math.abs(Number(values[1] || 0));
              const endX = relative ? x + values[5] : values[5];
              const endY = relative ? y + values[6] : values[6];
              bounds = addSvgPointToBounds(bounds, x - radiusX, y - radiusY);
              bounds = addSvgPointToBounds(bounds, x + radiusX, y + radiusY);
              bounds = addSvgPointToBounds(bounds, endX - radiusX, endY - radiusY);
              bounds = addSvgPointToBounds(bounds, endX + radiusX, endY + radiusY);
              x = endX;
              y = endY;
            }
            continue;
          }

          break;
        }

        return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
      };

      const getManualSvgShapeBounds = (shapeElement) => {
        if (!(shapeElement instanceof Element) || hasSvgTransform(shapeElement)) return null;
        const tagName = String(shapeElement.tagName || "").toLowerCase();

        if (tagName === "rect") {
          return createSvgBounds(
            parseSvgNumber(shapeElement.getAttribute("x")),
            parseSvgNumber(shapeElement.getAttribute("y")),
            parseSvgNumber(shapeElement.getAttribute("width")),
            parseSvgNumber(shapeElement.getAttribute("height"))
          );
        }

        if (tagName === "circle") {
          const radius = Math.max(0, parseSvgNumber(shapeElement.getAttribute("r")));
          const centerX = parseSvgNumber(shapeElement.getAttribute("cx"));
          const centerY = parseSvgNumber(shapeElement.getAttribute("cy"));
          return createSvgBounds(centerX - radius, centerY - radius, radius * 2, radius * 2);
        }

        if (tagName === "ellipse") {
          const radiusX = Math.max(0, parseSvgNumber(shapeElement.getAttribute("rx")));
          const radiusY = Math.max(0, parseSvgNumber(shapeElement.getAttribute("ry")));
          const centerX = parseSvgNumber(shapeElement.getAttribute("cx"));
          const centerY = parseSvgNumber(shapeElement.getAttribute("cy"));
          return createSvgBounds(centerX - radiusX, centerY - radiusY, radiusX * 2, radiusY * 2);
        }

        if (tagName === "line") {
          let bounds = null;
          bounds = addSvgPointToBounds(
            bounds,
            parseSvgNumber(shapeElement.getAttribute("x1")),
            parseSvgNumber(shapeElement.getAttribute("y1"))
          );
          bounds = addSvgPointToBounds(
            bounds,
            parseSvgNumber(shapeElement.getAttribute("x2")),
            parseSvgNumber(shapeElement.getAttribute("y2"))
          );
          return bounds;
        }

        if (tagName === "polygon" || tagName === "polyline") {
          const values = parseSvgNumberList(shapeElement.getAttribute("points"));
          let bounds = null;
          for (let pointIndex = 0; pointIndex < values.length - 1; pointIndex += 2) {
            bounds = addSvgPointToBounds(bounds, values[pointIndex], values[pointIndex + 1]);
          }
          return bounds;
        }

        if (tagName === "path") {
          return getPathDataBounds(shapeElement.getAttribute("d"));
        }

        return null;
      };

      const getSvgShapeElementsBounds = (shapeElements) => {
        let bounds = null;
        shapeElements.forEach((shapeElement) => {
          bounds = mergeSvgBounds(bounds, getManualSvgShapeBounds(shapeElement));
        });
        if (bounds && bounds.width > 0 && bounds.height > 0) return bounds;

        shapeElements.forEach((shapeElement) => {
          if (typeof shapeElement?.getBBox !== "function") return;
          try {
            const box = shapeElement.getBBox();
            bounds = mergeSvgBounds(bounds, createSvgBounds(box.x, box.y, box.width, box.height));
          } catch (_error) {
            // Ignore per-shape bbox failures and keep looking.
          }
        });
        return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
      };

      const hasRenderableSvgContent = (svgElement) => {
        if (!(svgElement instanceof SVGElement)) return false;
        const renderableTags = [
          "path",
          "rect",
          "circle",
          "ellipse",
          "line",
          "polyline",
          "polygon",
          "image",
          "text",
          "use",
        ];
        return renderableTags.some((tagName) =>
          Array.from(svgElement.querySelectorAll(tagName)).some(
            (candidate) => !candidate.closest("defs")
          )
        );
      };

      const findBestSvgRenderCandidate = (layerNode) => {
        if (!layerNode) return null;
        const candidates = [
          ...(String(layerNode.tagName || "").toLowerCase() === "svg" ? [layerNode] : []),
          ...Array.from(layerNode.querySelectorAll("svg")).filter(
            (candidate) => !isInsideForeignLayer(candidate, layerNode)
          ),
        ];
        let best = null;
        let bestArea = 0;
        candidates.forEach((candidate) => {
          if (!(candidate instanceof SVGElement)) return;
          if (!hasRenderableSvgContent(candidate)) return;
          const rect = candidate.getBoundingClientRect();
          if (!isVisibleSvg(candidate, rect)) return;
          const area = Math.max(1, rect.width * rect.height);
          if (area > bestArea) {
            best = candidate;
            bestArea = area;
          }
        });
        return best;
      };

      const hasRenderableVectorSignal = (layerNode) => {
        if (!layerNode) return false;
        if (findBestClipPathShapeCandidate(layerNode)) return true;
        if (findBestSvgRenderCandidate(layerNode)) return true;
        const canvasCandidates = [
          ...(String(layerNode.tagName || "").toLowerCase() === "canvas" ? [layerNode] : []),
          ...Array.from(layerNode.querySelectorAll("canvas")).filter(
            (candidate) => !isInsideForeignLayer(candidate, layerNode)
          ),
        ];
        return canvasCandidates.some((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return isVisible(candidate, rect);
        });
      };

      const stripTextNodesFromElement = (rootElement) => {
        if (!(rootElement instanceof Element)) return;
        Array.from(rootElement.querySelectorAll("text, tspan, foreignObject")).forEach((candidate) =>
          candidate.remove()
        );
      };

      const serializeSvgElementToDataUrl = (svgElement, targetWidth, targetHeight, options = {}) => {
        if (!(svgElement instanceof SVGElement)) return "";
        try {
          const clone = svgElement.cloneNode(true);
          copyComputedSvgStyles(svgElement, clone);
          if (options?.excludeTextNodes) {
            stripTextNodesFromElement(clone);
          }

          const rect = svgElement.getBoundingClientRect();
          const width = Math.max(
            1,
            Math.round(targetWidth || parseNumericPx(svgElement.getAttribute("width")) || rect.width || 1)
          );
          const height = Math.max(
            1,
            Math.round(targetHeight || parseNumericPx(svgElement.getAttribute("height")) || rect.height || 1)
          );

          clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
          clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
          clone.setAttribute("width", String(width));
          clone.setAttribute("height", String(height));
          if (!clone.getAttribute("viewBox")) {
            clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
          }
          clone.setAttribute("preserveAspectRatio", clone.getAttribute("preserveAspectRatio") || "none");

          const serialized = new XMLSerializer().serializeToString(clone);
          if (!serialized.includes("<svg")) return "";
          return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
        } catch (_error) {
          return "";
        }
      };

      // ── canva-stacked-svg:start
      // One SVG document that draws `items` (each a serialized <svg> with its box inside a
      // width×height frame) on top of each other, in order. Each item is nested as its own <svg>
      // so its viewBox keeps meaning; `none` aspect so it fills exactly the box it was measured at.
      const buildStackedSvgMarkup = (items, width, height) => {
        const safeWidth = Math.max(1, Math.round(Number(width) || 1));
        const safeHeight = Math.max(1, Math.round(Number(height) || 1));
        const parts = (Array.isArray(items) ? items : [])
          .filter((item) => item && typeof item.markup === "string" && /<svg\b/i.test(item.markup))
          .map((item) => {
            const x = Number(item.x) || 0;
            const y = Number(item.y) || 0;
            const w = Math.max(1, Number(item.width) || 1);
            const h = Math.max(1, Number(item.height) || 1);
            const inner = item.markup.replace(
              /<svg\b([^>]*)>/i,
              (_match, attrs) =>
                `<svg${String(attrs)
                  .replace(/\s(?:x|y|width|height|preserveAspectRatio)\s*=\s*(["']).*?\1/gi, "")} x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none">`
            );
            return inner;
          });
        if (!parts.length) return "";
        return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}">${parts.join("")}</svg>`;
      };
      // ── canva-stacked-svg:end

      const isCanvaTableLayer = (layerNode) =>
        Boolean(layerNode?.querySelector?.("table")) &&
        !Array.from(layerNode.querySelectorAll("table")).every((table) => isInsideForeignLayer(table, layerNode));

      // Every visible SVG the layer paints (fills, grid, decorations), stacked in DOM order onto
      // the layer's own box, scaled to the target size.
      const serializeStackedSvgsToDataUrl = (layerNode, targetWidth, targetHeight, options = {}) => {
        try {
          const layerRect = layerNode.getBoundingClientRect();
          if (!(layerRect.width > 0) || !(layerRect.height > 0)) return "";
          const width = Math.max(1, Math.round(targetWidth || layerRect.width));
          const height = Math.max(1, Math.round(targetHeight || layerRect.height));
          const scaleX = width / layerRect.width;
          const scaleY = height / layerRect.height;
          const items = Array.from(layerNode.querySelectorAll("svg"))
            .filter((candidate) => candidate instanceof SVGElement && !isInsideForeignLayer(candidate, layerNode))
            .filter((candidate) => !candidate.closest("table") && hasRenderableSvgContent(candidate))
            .map((candidate) => {
              const rect = candidate.getBoundingClientRect();
              if (!isVisibleSvg(candidate, rect)) return null;
              const clone = candidate.cloneNode(true);
              copyComputedSvgStyles(candidate, clone);
              if (options?.excludeTextNodes) stripTextNodesFromElement(clone);
              if (!clone.getAttribute("viewBox")) {
                clone.setAttribute("viewBox", `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
              }
              return {
                markup: new XMLSerializer().serializeToString(clone),
                x: (rect.left - layerRect.left) * scaleX,
                y: (rect.top - layerRect.top) * scaleY,
                width: rect.width * scaleX,
                height: rect.height * scaleY,
              };
            })
            .filter(Boolean);
          const markup = buildStackedSvgMarkup(items, width, height);
          return markup ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}` : "";
        } catch (_error) {
          return "";
        }
      };

      const rasterizeDataUrlWithCanvas = async (dataUrl, targetWidth, targetHeight) => {
        if (!String(dataUrl || "").startsWith("data:image/")) return "";
        try {
          const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("image-load-failed"));
            element.src = dataUrl;
          });
          const width = Math.max(
            1,
            Math.round(
              targetWidth || Number(image?.naturalWidth || image?.width || 0) || 1
            )
          );
          const height = Math.max(
            1,
            Math.round(
              targetHeight || Number(image?.naturalHeight || image?.height || 0) || 1
            )
          );
          const rasterCanvas = document.createElement("canvas");
          rasterCanvas.width = width;
          rasterCanvas.height = height;
          const rasterContext = rasterCanvas.getContext("2d");
          if (!rasterContext) return "";
          rasterContext.drawImage(image, 0, 0, width, height);
          return rasterCanvas.toDataURL("image/png");
        } catch (_error) {
          return "";
        }
      };

      const buildDisplayedImageCropRegion = (imageElement, visibleRect) => {
        if (!imageElement || !visibleRect) return null;
        const imageRect = imageElement.getBoundingClientRect();
        const intersection = intersectRects(
          {
            x: imageRect.left,
            y: imageRect.top,
            width: imageRect.width,
            height: imageRect.height,
          },
          visibleRect
        );
        if (!intersection || imageRect.width <= 0.01 || imageRect.height <= 0.01) return null;
        const x = (intersection.x - imageRect.left) / imageRect.width;
        const y = (intersection.y - imageRect.top) / imageRect.height;
        const width = intersection.width / imageRect.width;
        const height = intersection.height / imageRect.height;
        if (width <= 0 || height <= 0) return null;
        return {
          x: Math.max(0, Math.min(1, x)),
          y: Math.max(0, Math.min(1, y)),
          width: Math.max(0, Math.min(1, width)),
          height: Math.max(0, Math.min(1, height)),
        };
      };

      // Crop a fetched ORIGINAL asset to the region that is actually displayed while
      // preserving the source's native pixel density. The output is sized to the
      // cropped source resolution (capped, never upscaled) — NOT the small displayed
      // design box — so the imported image keeps Canva's real resolution. Fabric's
      // scaleX/scaleY downsamples it for on-canvas display while the full-resolution
      // pixels survive for export. targetWidth/targetHeight only define the crop
      // ASPECT, not the output size. Returns { dataUrl, width, height } or null.
      // Detect an asset that has the page background composited INTO it (e.g. a decoration
      // exported with its teal backdrop baked in). Such an asset renders wrong on any other
      // surface, so the caller should fall back to the isolation snapshot which subtracts the
      // page background. Heuristic: a large, opaque, MUTED, single flat-colour region — that's
      // a baked backdrop, not a clean cut-out decoration (which is mostly transparent) nor a
      // varied photo (no single dominant colour).
      // Mirror of isBackgroundBakedAsset: a fetched asset that is a REAL cut-out — a substantial
      // share of FULLY-transparent pixels. A shaped-mask photo's rectangular asset crop is ~0%
      // transparent so it never matches; a product cut-out (shoes, sticker) is 25%+ transparent.
      const isCleanCutoutAsset = async (dataUrl) => {
        if (!String(dataUrl || "").startsWith("data:image/png")) return false;
        try {
          const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("image-load-failed"));
            element.src = dataUrl;
          });
          const sw = Math.max(1, Number(image?.naturalWidth || image?.width || 0) || 1);
          const sh = Math.max(1, Number(image?.naturalHeight || image?.height || 0) || 1);
          const scale = Math.min(1, 160 / Math.max(sw, sh));
          const w = Math.max(1, Math.round(sw * scale));
          const h = Math.max(1, Math.round(sh * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const context = canvas.getContext("2d");
          if (!context) return false;
          context.drawImage(image, 0, 0, w, h);
          const data = context.getImageData(0, 0, w, h).data;
          let transparent = 0;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 20) transparent += 1;
          }
          return transparent >= w * h * 0.25;
        } catch (_error) {
          return false;
        }
      };

      const isBackgroundBakedAsset = async (dataUrl) => {
        if (!String(dataUrl || "").startsWith("data:image/")) return false;
        try {
          const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("image-load-failed"));
            element.src = dataUrl;
          });
          const sw = Math.max(1, Number(image?.naturalWidth || image?.width || 0) || 1);
          const sh = Math.max(1, Number(image?.naturalHeight || image?.height || 0) || 1);
          const scale = Math.min(1, 160 / Math.max(sw, sh));
          const w = Math.max(1, Math.round(sw * scale));
          const h = Math.max(1, Math.round(sh * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const context = canvas.getContext("2d");
          if (!context) return false;
          context.drawImage(image, 0, 0, w, h);
          const data = context.getImageData(0, 0, w, h).data;
          const total = w * h;
          let opaque = 0;
          const histogram = new Map();
          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < 200) continue;
            opaque += 1;
            const key =
              ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
            histogram.set(key, (histogram.get(key) || 0) + 1);
          }
          // A baked background is an OPAQUE rectangle: an asset with real transparency (≥ 5% clear
          // pixels) is a cut-out, whatever its colour — a flat grey disc used to read as "baked".
          if (opaque <= total * 0.95) return false;
          let dominantKey = 0;
          let dominantCount = 0;
          for (const [key, count] of histogram) {
            if (count > dominantCount) {
              dominantCount = count;
              dominantKey = key;
            }
          }
          const dominantFraction = dominantCount / opaque;
          const r = ((dominantKey >> 6) & 7) * 36;
          const g = ((dominantKey >> 3) & 7) * 36;
          const b = (dominantKey & 7) * 36;
          const maxChannel = Math.max(r, g, b);
          const minChannel = Math.min(r, g, b);
          const saturation = maxChannel > 0 ? (maxChannel - minChannel) / maxChannel : 0;
          return (
            dominantFraction > 0.28 &&
            saturation < 0.6 &&
            maxChannel > 25 &&
            maxChannel < 220
          );
        } catch (_error) {
          return false;
        }
      };

      // ── canva-model-text-size:start
      // The font size a model-rebuilt text draws at, in its own layout px (× width / layoutWidth on
      // the page). Canva's runs can name a stale size beside the paragraph's real one: DAHNlANrhmQ's
      // «عَمَّ الْفَرَح…» says 14.92 on all 39 letters and 156.65 on its paragraph mark, and Canva
      // draws 156.65 — the 144 px box holds one line of it. With several sizes the one whose line
      // fits the box best wins (lines from the text's own breaks; wrapping only shrinks the target,
      // and the candidates are far apart). One size, or no box: the first size, as before.
      const pickModelTextFontSize = ({ fontSize, fontSizes, boxHeight, scale, text }) => {
        const first = Number(fontSize) > 0 ? Number(fontSize) : 0;
        const sizes = (Array.isArray(fontSizes) ? fontSizes : []).map(Number).filter((size) => size > 0);
        const height = Number(boxHeight) || 0;
        const unit = Number(scale) > 0 ? Number(scale) : 1;
        if (sizes.length < 2 || !(height > 0)) return first;
        const lines = Math.max(
          1,
          String(text || "").split("\n").filter((line) => line.trim()).length
        );
        const target = height / (lines * 1.2);
        let best = first || sizes[0];
        let bestMiss = Infinity;
        for (const size of sizes) {
          const miss = Math.abs(Math.log((size * unit) / target));
          if (miss < bestMiss) {
            bestMiss = miss;
            best = size;
          }
        }
        return best;
      };
      // ── canva-model-text-size:end

      // ── canva-split-part:start
      // The element a PART layer stands in for: a text split per paragraph (`<id>__p1`…) or into
      // table/grid cells (`<id>__cell1`…) replaces its element, which then has no layer of its own.
      // "" for anything else (companions like `<id>__text` / `<id>__frame` sit beside their element).
      const splitPartBaseId = (id) => /^(.+)__(?:p|cell)\d+$/.exec(String(id || ""))?.[1] || "";
      // ── canva-split-part:end

      // ── canva-supplement-geometry:start
      // Whether a model-supplemented element takes its DOM rect (page space, but an axis-aligned
      // bounding box) or its model box (its own frame, but group-LOCAL for nested elements). A
      // TOP-LEVEL element's model box is page space already, so a turned one keeps its frame and
      // angle — its DOM box is the rotated footprint, and a ribbon turned 64.5° that the main walk
      // skipped (mostly off-page) was stretched into that footprint at 0° (DAHFEg4hhOk). Nested or
      // unrotated elements keep the DOM rect, exactly as before.
      const supplementUsesDomRect = ({ hasDomRect, nestedInGroup, rotation, modelWidth, modelHeight }) => {
        if (!hasDomRect) return false;
        const turned = Math.abs(Number(rotation) || 0) > 0.5;
        const modelBoxUsable = Number(modelWidth) > 0.5 && Number(modelHeight) > 0.5;
        return !(turned && !nestedInGroup && modelBoxUsable);
      };
      // A model element's frame on the PAGE. Its left/top are local to its group, so a grouped
      // element with no node on the page (it enters later on the timeline) is carried out through
      // every group: its centre turned by the group's rotation about the group's centre, its angle
      // plus the group's. DAHNZc5myOk's "محـمـد" (group-local 382,0) imported at the top of the page.
      const modelElementPageFrame = (el, modelById) => {
        const width = Number(el?.width) || 0;
        const height = Number(el?.height) || 0;
        let centerX = (Number(el?.left) || 0) + width / 2;
        let centerY = (Number(el?.top) || 0) + height / 2;
        let angle = Number(el?.rotation) || 0;
        let parent = el?.parentId && modelById ? modelById[String(el.parentId)] : null;
        for (let hops = 0; parent && hops < 8; hops += 1) {
          const parentWidth = Number(parent.width) || 0;
          const parentHeight = Number(parent.height) || 0;
          const turn = ((Number(parent.rotation) || 0) * Math.PI) / 180;
          const dx = centerX - parentWidth / 2;
          const dy = centerY - parentHeight / 2;
          centerX = (Number(parent.left) || 0) + parentWidth / 2 + dx * Math.cos(turn) - dy * Math.sin(turn);
          centerY = (Number(parent.top) || 0) + parentHeight / 2 + dx * Math.sin(turn) + dy * Math.cos(turn);
          angle += Number(parent.rotation) || 0;
          parent = parent.parentId ? modelById[String(parent.parentId)] : null;
        }
        return { x: centerX - width / 2, y: centerY - height / 2, width, height, angle };
      };
      // ── canva-supplement-geometry:end

      // ── canva-layer-frame-size:start
      // A layer's frame in design px: the un-rotated style box when it agrees with the measured
      // bounding box (both in design px), else the bounding box itself. The viewport rect is the
      // ROTATED footprint, while the style width/height describe the element's own un-rotated
      // frame. For a layer turned by ~90° the two are swapped, so compare against the swapped
      // rect or the styled geometry is wrongly rejected and the fit target becomes the portrait
      // footprint of a landscape asset — which centre-cropped a 1600x382 floral strip (in a
      // 1920x458 frame, rotated -90°) to a 91x382 sliver that fabric then stretched 21x. Anchor
      // placement is centre-based, so keeping the un-rotated frame does not move the layer; and
      // when the styled box is unusable, a quarter turn swaps the raw box back instead.
      // Given the layer's `angle`, the styled box is compared as the footprint it makes when
      // turned like the layer — any turn, not just a quarter: "عروسـ" (DAHNZVrSYZM) is a 298x120
      // text turned -8.3°, its footprint 312x162; compared unturned, the heights missed the window
      // and the text came in as a 312x162 box, its glyphs 21 px high.
      const resolveLayerFrameSize = ({ rawWidth, rawHeight, styledWidth, styledHeight, isQuarterTurned, angle }) => {
        const raw = { width: Math.max(1, Number(rawWidth) || 1), height: Math.max(1, Number(rawHeight) || 1) };
        const radians = (Number(angle) * Math.PI) / 180;
        const turned = Number.isFinite(radians) && angle !== null && angle !== undefined;
        const cos = Math.abs(Math.cos(radians));
        const sin = Math.abs(Math.sin(radians));
        const comparableWidth = turned ? raw.width : isQuarterTurned ? raw.height : raw.width;
        const comparableHeight = turned ? raw.height : isQuarterTurned ? raw.width : raw.height;
        const footprintWidth = turned ? styledWidth * cos + styledHeight * sin : styledWidth;
        const footprintHeight = turned ? styledWidth * sin + styledHeight * cos : styledHeight;
        const widthRatio = styledWidth > 0 ? footprintWidth / comparableWidth : 0;
        const heightRatio = styledHeight > 0 ? footprintHeight / comparableHeight : 0;
        const styledMatches =
          styledWidth > 0 && styledHeight > 0 && widthRatio >= 0.8 && widthRatio <= 1.25 && heightRatio >= 0.8 && heightRatio <= 1.25;
        if (styledMatches) return { width: styledWidth, height: styledHeight };
        if (isQuarterTurned) return { width: raw.height, height: raw.width };
        return raw;
      };
      // ── canva-layer-frame-size:end

      // ── canva-page-fill-quarter-turn:start
      // A page-fill photo placed TURNED by a quarter (`__pageFill.image.box.rotation` ±90: a
      // portrait photo laid sideways to fill a landscape page). modelCropRegionForFrame refuses
      // rotated boxes, so the page took a centre slice of the UN-turned photo (DAHFEzrP4PM: the
      // floral certificate frame came in sideways and cropped). The box turns about its centre,
      // so its on-page footprint is the box with its sides swapped; the part of the page it covers
      // maps back into the un-turned photo (the same axis swap the layer crop uses) and the slice
      // is then turned by `quarterTurns` (+1 clockwise, -1 counter-clockwise) to lie as Canva
      // shows it. Null for anything that is not a quarter turn — the other paths stay as they are.
      const quarterTurnedPageFillCrop = (box, pageWidth, pageHeight) => {
        if (!box || !(box.width > 0) || !(box.height > 0) || !(pageWidth > 0) || !(pageHeight > 0)) return null;
        const turn = ((Math.round(Number(box.rotation) || 0) % 360) + 360) % 360;
        const quarterTurns = Math.abs(turn - 90) <= 1 ? 1 : Math.abs(turn - 270) <= 1 ? -1 : 0;
        if (!quarterTurns) return null;
        const centerX = box.left + box.width / 2;
        const centerY = box.top + box.height / 2;
        const footprint = { x: centerX - box.height / 2, y: centerY - box.width / 2, width: box.height, height: box.width };
        const visX = Math.max(0, footprint.x);
        const visY = Math.max(0, footprint.y);
        const visRight = Math.min(pageWidth, footprint.x + footprint.width);
        const visBottom = Math.min(pageHeight, footprint.y + footprint.height);
        if (visRight - visX < 1 || visBottom - visY < 1) return null;
        // The visible part as fractions of the turned footprint…
        const turned = {
          x: (visX - footprint.x) / footprint.width,
          y: (visY - footprint.y) / footprint.height,
          width: (visRight - visX) / footprint.width,
          height: (visBottom - visY) / footprint.height,
        };
        // …then in the un-turned photo: a clockwise turn sends the photo's top edge to the right
        // (x′ = y, y′ = 1 − x − w), a counter-clockwise one sends it to the left (x′ = 1 − y − h, y′ = x).
        const region =
          quarterTurns === 1
            ? { x: turned.y, y: 1 - turned.x - turned.width, width: turned.height, height: turned.width }
            : { x: 1 - turned.y - turned.height, y: turned.x, width: turned.height, height: turned.width };
        const clamp01 = (value) => Math.max(0, Math.min(1, value));
        return {
          quarterTurns,
          region: { x: clamp01(region.x), y: clamp01(region.y), width: clamp01(region.width), height: clamp01(region.height) },
        };
      };
      // ── canva-page-fill-quarter-turn:end

      // ── canva-model-crop-region:start
      /**
       * Turns the fiber model's in-frame crop (`fill.sb` — the media's draw rect in the element's
       * OWN frame coordinates, design px) into the normalized source region fitDataUrlToDisplayedBox
       * wants. Returns null when there is nothing to crop.
       *
       * Why prefer this over measuring the DOM: `sb` is exact and pre-rotation, so it needs no
       * orientation remap, no zoom/DPR correction, and it is unaffected by the element being
       * clipped at the page edge. The DOM path can only see what is on screen.
       */
      const modelCropRegionForFrame = (crop, frameWidth, frameHeight) => {
        if (!crop || !(crop.width > 0) || !(crop.height > 0)) return null;
        // A rotated fill would need the region rotated too; keeping the full media is the safe miss.
        if (Math.abs(Number(crop.rotation) || 0) > 0.5) return null;
        const frameW = Number(frameWidth) || 0;
        const frameH = Number(frameHeight) || 0;
        if (frameW < 1 || frameH < 1) return null;
        // Media exactly fills its frame: no crop, and saying so lets callers skip the whole path.
        const matchesFrame =
          Math.abs(crop.left) < 1 &&
          Math.abs(crop.top) < 1 &&
          Math.abs(crop.width - frameW) < 2 &&
          Math.abs(crop.height - frameH) < 2;
        if (matchesFrame) return null;
        // Visible region = media rect ∩ frame rect, as fractions of the MEDIA rect.
        const visX = Math.max(0, crop.left);
        const visY = Math.max(0, crop.top);
        const visRight = Math.min(frameW, crop.left + crop.width);
        const visBottom = Math.min(frameH, crop.top + crop.height);
        if (visRight - visX < 1 || visBottom - visY < 1) return null;
        return {
          x: (visX - crop.left) / crop.width,
          y: (visY - crop.top) / crop.height,
          width: (visRight - visX) / crop.width,
          height: (visBottom - visY) / crop.height,
        };
      };

      // Whether a layer's model crop stands in for measuring the DOM. A masked layer is laid out on
      // its page-clipped box, and its crop must describe that same rectangle — which the model's
      // full-frame crop does as long as the page clips nothing. A flipped fill stays on the DOM
      // path, whose remap knows how a mirror moves the slice. Everything else takes the model: it
      // is exact and pre-rotation, while the DOM measures axis-aligned screen boxes — the -74.8°
      // coffee cup on DAHPQG4ffsM came in as a 715x1114 portrait slice squeezed into its square
      // frame.
      // A layer that `takesModelFrame` ends up on its model's FULL frame whatever box it is measured
      // on (see takesRotatedModelFrame), so only the model's full-frame crop matches it — page
      // clipping and fill flips included: Canva mirrors a flipped fill about the FRAME's centre (a
      // frame-sized scaleX(-1) wrapper around the cropped media), which is what the layer's own flip
      // does in the editor.
      const modelCropAppliesToLayer = ({ usesVisibleGeometry, pageClipped, fillFlipX, fillFlipY, takesModelFrame }) =>
        Boolean(takesModelFrame) || !usesVisibleGeometry || (!pageClipped && !fillFlipX && !fillFlipY);
      // Whether the model-authoritative pass after capture puts this image on its model's whole
      // frame: a turned element (> 0.5°) with a usable box and no turned group above it — the same
      // test that pass makes. Its crop has to be cut for that frame, not for the box measured on
      // screen. DAHNlJePGh0's two irises (-161.3° flipped, 6.8°) bleed off the page: each was cut to
      // its on-page footprint, then stretched over the full frame — a zoomed slice of stems.
      const takesRotatedModelFrame = (model, modelById) => {
        if (!model || !(Math.abs(Number(model.rotation) || 0) > 0.5)) return false;
        if (!(Number(model.width) >= 2) || !(Number(model.height) >= 2)) return false;
        let parent = model.parentId && modelById ? modelById[String(model.parentId)] : null;
        for (let hops = 0; parent && hops < 8; hops += 1) {
          if (Math.abs(Number(parent.rotation) || 0) > 0.5) return false;
          parent = parent.parentId ? modelById[String(parent.parentId)] : null;
        }
        return true;
      };
      // ── canva-model-crop-region:end

      // `quarterTurns` (+1 clockwise, -1 counter-clockwise) turns the cropped slice — a page fill
      // laid sideways is cut from the un-turned photo, then turned to lie as Canva shows it.
      const fitDataUrlToDisplayedBox = async (dataUrl, targetWidth, targetHeight, cropRegion = null, quarterTurns = 0) => {
        if (!String(dataUrl || "").startsWith("data:image/")) return null;
        const MAX_FITTED_IMAGE_SIDE = 1920;
        // A JPEG source is opaque, so re-encode the (now full-resolution) crop as JPEG to
        // keep the payload small; anything else may carry alpha, so stay lossless PNG.
        const sourceMimeType = (String(dataUrl).match(/^data:(image\/[^;,]+)/i)?.[1] || "").toLowerCase();
        const encodeAsJpeg = sourceMimeType === "image/jpeg";
        try {
          const image = await new Promise((resolve, reject) => {
            const element = new Image();
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error("image-load-failed"));
            element.src = dataUrl;
          });
          const sourceWidth = Math.max(1, Number(image?.naturalWidth || image?.width || 0) || 1);
          const sourceHeight = Math.max(1, Number(image?.naturalHeight || image?.height || 0) || 1);
          const boxWidth = Math.max(1, Math.round(targetWidth || sourceWidth));
          const boxHeight = Math.max(1, Math.round(targetHeight || sourceHeight));
          let sx = 0;
          let sy = 0;
          let sw = sourceWidth;
          let sh = sourceHeight;
          if (
            cropRegion &&
            Number.isFinite(cropRegion.x) &&
            Number.isFinite(cropRegion.y) &&
            Number.isFinite(cropRegion.width) &&
            Number.isFinite(cropRegion.height)
          ) {
            sx = Math.max(0, Math.min(sourceWidth - 1, cropRegion.x * sourceWidth));
            sy = Math.max(0, Math.min(sourceHeight - 1, cropRegion.y * sourceHeight));
            sw = Math.max(1, Math.min(sourceWidth - sx, cropRegion.width * sourceWidth));
            sh = Math.max(1, Math.min(sourceHeight - sy, cropRegion.height * sourceHeight));
          } else {
            const targetRatio = boxWidth / Math.max(1, boxHeight);
            const sourceRatio = sourceWidth / Math.max(1, sourceHeight);
            if (sourceRatio > targetRatio) {
              sw = sourceHeight * targetRatio;
              sx = (sourceWidth - sw) / 2;
            } else if (sourceRatio < targetRatio) {
              sh = sourceWidth / targetRatio;
              sy = (sourceHeight - sh) / 2;
            }
          }
          // Output at the cropped source resolution, capped to bound payload size.
          // outScale is clamped to <= 1 so we never upscale beyond the real pixels — except for a
          // VECTOR source, which has no pixels of its own: its "natural" size is whatever its
          // width/height say (DAHNlANrhmQ's calendar and pin icons: 4×5 for a 432×480 viewBox),
          // so it is drawn at twice the box it fills instead — they came in as 4 px smudges.
          const nativeWidth = Math.max(1, Math.round(sw));
          const nativeHeight = Math.max(1, Math.round(sh));
          const isVectorSource = sourceMimeType === "image/svg+xml";
          const vectorBoost = isVectorSource
            ? Math.max(1, (2 * Math.max(boxWidth, boxHeight)) / Math.max(nativeWidth, nativeHeight, 1))
            : 1;
          const outScale = Math.min(vectorBoost, MAX_FITTED_IMAGE_SIDE / Math.max(nativeWidth, nativeHeight, 1));
          const width = Math.max(1, Math.round(nativeWidth * outScale));
          const height = Math.max(1, Math.round(nativeHeight * outScale));
          const turned = quarterTurns === 1 || quarterTurns === -1;
          const canvas = document.createElement("canvas");
          canvas.width = turned ? height : width;
          canvas.height = turned ? width : height;
          const context = canvas.getContext("2d");
          if (!context) return null;
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          if (turned) {
            context.translate(canvas.width / 2, canvas.height / 2);
            context.rotate((quarterTurns * Math.PI) / 2);
            context.drawImage(image, sx, sy, sw, sh, -width / 2, -height / 2, width, height);
          } else {
            context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
          }
          const outDataUrl = encodeAsJpeg
            ? canvas.toDataURL("image/jpeg", 0.92)
            : canvas.toDataURL("image/png");
          return { dataUrl: outDataUrl, width: canvas.width, height: canvas.height };
        } catch (_error) {
          return null;
        }
      };

      const findBestClipPathShapeCandidate = (layerNode) => {
        if (!layerNode) return null;
        const layerRect = layerNode.getBoundingClientRect();
        const candidates = [layerNode, ...getScopedDescendants(layerNode)];
        let best = null;
        let bestArea = 0;
        candidates.forEach((candidate) => {
          if (!(candidate instanceof Element)) return;
          let style = null;
          try {
            style = window.getComputedStyle(candidate);
          } catch (_error) {
            style = null;
          }
          if (!style) return;
          const clipPathId =
            extractUrlFragmentId(style.clipPath) ||
            extractUrlFragmentId(style.webkitClipPath) ||
            extractUrlFragmentId(candidate.getAttribute("style"));
          if (!clipPathId) return;
          const backgroundColor = String(style.backgroundColor || "").trim();
          if (isTransparentColor(backgroundColor)) return;
          const candidateRect = candidate.getBoundingClientRect();
          if (!isVisible(candidate, candidateRect)) return;
          const clippedRect = intersectRects(candidateRect, layerRect);
          const area = Math.max(1, rectArea(clippedRect || candidateRect));
          if (area > bestArea) {
            best = {
              candidate,
              rect: candidateRect,
              clipPathId,
              backgroundColor,
              opacity: Math.max(0, Math.min(1, Number.parseFloat(style.opacity || "1") || 1)),
            };
            bestArea = area;
          }
        });
        return best;
      };

      // One clipped, filled element as an SVG group in the layer's design-px box — the piece both
      // serializers below are built from.
      const clipPathShapeGroupMarkup = (layerNode, clipPathShapeCandidate, width, height) => {
        if (!layerNode || !clipPathShapeCandidate?.clipPathId) return "";
        try {
          const clipPathElement = Array.from(layerNode.querySelectorAll("clipPath")).find(
            (candidate) => String(candidate.id || "").trim() === clipPathShapeCandidate.clipPathId
          );
          if (!(clipPathElement instanceof Element)) return "";
          const shapeElements = Array.from(
            clipPathElement.querySelectorAll(
              "path,rect,circle,ellipse,line,polyline,polygon"
            )
          );
          if (shapeElements.length === 0) return "";

          const clipBounds =
            getSvgShapeElementsBounds(shapeElements) ||
            (typeof clipPathElement.getBBox === "function"
              ? clipPathElement.getBBox()
              : shapeElements[0].getBBox?.());
          if (!clipBounds || clipBounds.width <= 0 || clipBounds.height <= 0) return "";

          const layerRect = layerNode.getBoundingClientRect();
          const candidateRect = clipPathShapeCandidate.rect;
          // The rects are measured on screen (editor zoom applied) but the SVG is
          // drawn in DESIGN px (targetWidth × targetHeight). Without converting,
          // the shape filled only `zoom` of its own box — at 60% zoom a rounded
          // panel came out 40% smaller, pinned to the top-left corner.
          // A TURNED layer's screen rects are rotated footprints, so its pieces come with their
          // boxes in the layer's own layout px instead (localBox + layerLocalSize).
          const localBox = clipPathShapeCandidate.localBox || null;
          const layerLocalSize = clipPathShapeCandidate.layerLocalSize || null;
          const designPerScreenX = localBox
            ? width / Math.max(1, layerLocalSize.width)
            : layerRect.width > 0 ? width / layerRect.width : 1;
          const designPerScreenY = localBox
            ? height / Math.max(1, layerLocalSize.height)
            : layerRect.height > 0 ? height / layerRect.height : 1;
          const pieceWidth = localBox ? localBox.width : candidateRect.width;
          const pieceHeight = localBox ? localBox.height : candidateRect.height;
          const pieceLeft = localBox ? localBox.x : candidateRect.left - layerRect.left;
          const pieceTop = localBox ? localBox.y : candidateRect.top - layerRect.top;
          const scaleX = (pieceWidth * designPerScreenX) / Math.max(1, clipBounds.width);
          const scaleY = (pieceHeight * designPerScreenY) / Math.max(1, clipBounds.height);
          const translateX = pieceLeft * designPerScreenX - clipBounds.x * scaleX;
          const translateY = pieceTop * designPerScreenY - clipBounds.y * scaleY;
          const serializer = new XMLSerializer();
          const serializedShapes = shapeElements
            .map((shapeElement) => {
              const clone = shapeElement.cloneNode(true);
              copyComputedSvgStyles(shapeElement, clone);
              if (clone instanceof Element) {
                clone.removeAttribute("clip-path");
                clone.removeAttribute("fill");
                clone.style.removeProperty("clip-path");
                clone.style.removeProperty("fill");
                clone.style.removeProperty("fill-opacity");
                clone.removeAttribute("stroke");
                clone.style.removeProperty("stroke");
                clone.style.removeProperty("stroke-opacity");
                clone.style.removeProperty("stroke-width");
                clone.removeAttribute("opacity");
                clone.style.removeProperty("opacity");
              }
              return serializer.serializeToString(clone);
            })
            .join("");
          if (!serializedShapes) return "";
          return [
            `<g fill="${clipPathShapeCandidate.backgroundColor}" opacity="${clipPathShapeCandidate.opacity}" transform="translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})">`,
            serializedShapes,
            "</g>",
          ].join("");
        } catch (_error) {
          return "";
        }
      };

      const wrapSvgGroupsAsDataUrl = (groups, width, height) => {
        if (!groups.length) return "";
        const svgMarkup = [
          `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`,
          ...groups,
          "</svg>",
        ].join("");
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
      };

      const serializeClipPathShapeToDataUrl = (
        layerNode,
        clipPathShapeCandidate,
        targetWidth,
        targetHeight
      ) => {
        if (!layerNode || !clipPathShapeCandidate?.clipPathId) return "";
        const layerRect = layerNode.getBoundingClientRect();
        const candidateRect = clipPathShapeCandidate.rect || layerRect;
        const width = Math.max(1, Math.round(targetWidth || layerRect.width || candidateRect.width || 1));
        const height = Math.max(1, Math.round(targetHeight || layerRect.height || candidateRect.height || 1));
        const group = clipPathShapeGroupMarkup(layerNode, clipPathShapeCandidate, width, height);
        return group ? wrapSvgGroupsAsDataUrl([group], width, height) : "";
      };

      // A window frame's artwork: every clipped, filled element of the layer that does not hold
      // the photo (a polaroid's card and its trim rings), stacked in document order.
      const serializeClipPathArtworkToDataUrl = (layerNode, imageElement, targetWidth, targetHeight, options = {}) => {
        if (!layerNode) return "";
        const width = Math.max(1, Math.round(targetWidth || 1));
        const height = Math.max(1, Math.round(targetHeight || 1));
        const layerLocalSize = { width: layerNode.offsetWidth, height: layerNode.offsetHeight };
        const groups = [];
        [layerNode, ...getScopedDescendants(layerNode)].forEach((candidate) => {
          if (!(candidate instanceof Element)) return;
          if (imageElement && candidate.contains(imageElement)) return;
          let style = null;
          try {
            style = window.getComputedStyle(candidate);
          } catch (_error) {
            style = null;
          }
          if (!style) return;
          const clipPathId =
            extractUrlFragmentId(style.clipPath) ||
            extractUrlFragmentId(style.webkitClipPath) ||
            extractUrlFragmentId(candidate.getAttribute("style"));
          if (!clipPathId) return;
          const backgroundColor = String(style.backgroundColor || "").trim();
          if (isTransparentColor(backgroundColor)) return;
          const candidateRect = candidate.getBoundingClientRect();
          if (!isVisibleSvg(candidate, candidateRect)) return;
          // A turned layer's pieces are placed by their layout boxes; one that cannot be read
          // (a rotation inside the layer) is left out rather than drawn at its rotated footprint.
          const localBox = options.rotated ? localBoxWithin(candidate, layerNode) : null;
          if (options.rotated && !localBox) return;
          const group = clipPathShapeGroupMarkup(
            layerNode,
            {
              candidate,
              rect: candidateRect,
              clipPathId,
              backgroundColor,
              opacity: Math.max(0, Math.min(1, Number.parseFloat(style.opacity || "1") || 1)),
              ...(localBox ? { localBox, layerLocalSize } : {}),
            },
            width,
            height
          );
          if (group) groups.push(group);
        });
        return wrapSvgGroupsAsDataUrl(groups, width, height);
      };

      const extractShapeImageDataUrl = (layerNode, targetWidth, targetHeight, options = {}) => {
        if (!layerNode) return "";

        const clipPathShapeCandidate = findBestClipPathShapeCandidate(layerNode);
        if (clipPathShapeCandidate) {
          const clipPathDataUrl = serializeClipPathShapeToDataUrl(
            layerNode,
            clipPathShapeCandidate,
            targetWidth,
            targetHeight
          );
          if (clipPathDataUrl.startsWith("data:image/")) {
            return clipPathDataUrl;
          }
        }

        // A Canva TABLE paints its cell fills and its grid lines as SEPARATE page-sized SVGs
        // (plus a 2px-per-cell <table> skeleton that only positions the texts). Taking the one
        // biggest SVG kept the fills and lost every line on DAHP0JQMv10 — stack them all instead.
        if (isCanvaTableLayer(layerNode)) {
          const stackedDataUrl = serializeStackedSvgsToDataUrl(layerNode, targetWidth, targetHeight, options);
          if (stackedDataUrl.startsWith("data:image/")) {
            return stackedDataUrl;
          }
        }

        const svgCandidate = findBestSvgRenderCandidate(layerNode);
        if (svgCandidate) {
          const svgDataUrl = serializeSvgElementToDataUrl(svgCandidate, targetWidth, targetHeight, options);
          if (svgDataUrl.startsWith("data:image/")) {
            return svgDataUrl;
          }
        }

        const canvasCandidates = [
          ...(String(layerNode.tagName || "").toLowerCase() === "canvas" ? [layerNode] : []),
          ...Array.from(layerNode.querySelectorAll("canvas")).filter(
            (candidate) => !isInsideForeignLayer(candidate, layerNode)
          ),
        ];
        let bestCanvas = null;
        let bestCanvasArea = 0;
        canvasCandidates.forEach((candidate) => {
          const rect = candidate.getBoundingClientRect();
          if (!isVisible(candidate, rect)) return;
          const area = Math.max(1, rect.width * rect.height);
          if (area > bestCanvasArea) {
            bestCanvas = candidate;
            bestCanvasArea = area;
          }
        });

        if (bestCanvas && typeof bestCanvas.toDataURL === "function") {
          try {
            const canvasDataUrl = bestCanvas.toDataURL("image/png");
            if (String(canvasDataUrl).startsWith("data:image/")) {
              return canvasDataUrl;
            }
          } catch (_error) {
            return "";
          }
        }

        return "";
      };

      const blobUrlToDataUrl = async (blobUrl, maxBytes = 8_000_000) => {
        if (!String(blobUrl || "").startsWith("blob:")) return "";
        try {
          const response = await fetch(blobUrl);
          if (!response.ok) return "";
          const blob = await response.blob();
          if (!blob || blob.size <= 0 || blob.size > maxBytes) return "";
          return await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              resolve(typeof reader.result === "string" ? reader.result : "");
            };
            reader.onerror = () => resolve("");
            reader.readAsDataURL(blob);
          });
        } catch (_error) {
          return "";
        }
      };

      let bestPage = null;
      // Multi-page import: the orchestrator scrapes one page at a time, pinning each pass to a
      // specific [data-page-id] instead of the viewport-center score heuristic. In virtualized
      // single-page view the attribute is just the viewport slot (always "0"), so the node is
      // ALSO accepted when it CONTAINS the target page's expected LB element ids.
      const targetPageId = String((runtimeOptions && runtimeOptions.targetPageId) || "").trim();
      const expectedLbIds = Array.isArray(runtimeOptions && runtimeOptions.expectedLbIds)
        ? runtimeOptions.expectedLbIds.map((id) => String(id || "")).filter(Boolean)
        : [];
      const nodeContainsExpectedId = (page) =>
        expectedLbIds.some((id) => {
          try {
            return Boolean(page.querySelector("#" + CSS.escape(id)));
          } catch (_e) {
            return false;
          }
        });
      const allPageNodes = Array.from(document.querySelectorAll("[data-page-id]"));
      const pageNodes = targetPageId
        ? allPageNodes.filter((page) => {
            if (String(page.getAttribute("data-page-id") || "") === targetPageId) return true;
            return expectedLbIds.length > 0 && nodeContainsExpectedId(page);
          })
        : allPageNodes;
      pageNodes.forEach((page) => {
        const rect = page.getBoundingClientRect();
        if (!isVisible(page, rect)) return;

        let designWidth = 0;
        let designHeight = 0;

        const scaleRoot = page.querySelector('div[style*="transform: scale"]');
        if (scaleRoot) {
          const styleText = scaleRoot.getAttribute("style") || "";
          designWidth = parseStyleDimension(styleText, "width");
          designHeight = parseStyleDimension(styleText, "height");
        }

        if (!designWidth || !designHeight) {
          const pageStyleText = page.getAttribute("style") || "";
          designWidth = parseStyleDimension(pageStyleText, "width") || parsePx(page.style.width) || rect.width;
          designHeight = parseStyleDimension(pageStyleText, "height") || parsePx(page.style.height) || rect.height;
        }

        const score = scoreRect(rect);
        if (!bestPage || score > bestPage.score) {
          bestPage = {
            node: page,
            score,
            rect: {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            },
            designWidth: Math.max(1, Math.round(designWidth)),
            designHeight: Math.max(1, Math.round(designHeight)),
          };
        }
      });

      let bestCanvas = null;
      const canvases = Array.from(document.querySelectorAll("canvas"));
      canvases.forEach((canvas) => {
        const rect = canvas.getBoundingClientRect();
        if (!isVisible(canvas, rect)) return;
        if (rect.width < 220 || rect.height < 220) return;

        const score = scoreRect(rect);
        if (!bestCanvas || score > bestCanvas.score) {
          bestCanvas = {
            score,
            node: canvas,
            rect: {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            },
          };
        }
      });

      // Pinned-page pass with no matching node on screen: refuse rather than silently capturing
      // whichever canvas scores best (that imports the WRONG page).
      if (targetPageId && !bestPage) {
        return {
          ok: false,
          error: `Target page (${targetPageId}) is not on screen.`,
        };
      }

      const selectedCanvas = bestPage ? null : bestCanvas;

      let directDataUrl = "";
      let designWidth = 0;
      let designHeight = 0;
      let rect = null;

      if (selectedCanvas) {
        rect = selectedCanvas.rect;
        designWidth = Number(selectedCanvas.node.width || 0);
        designHeight = Number(selectedCanvas.node.height || 0);
        try {
          directDataUrl = selectedCanvas.node.toDataURL("image/png");
        } catch (_error) {
          directDataUrl = "";
        }
      } else if (bestPage) {
        rect = bestPage.rect;
        designWidth = bestPage.designWidth;
        designHeight = bestPage.designHeight;
      } else if (bestCanvas) {
        rect = bestCanvas.rect;
        designWidth = Math.round(bestCanvas.rect.width);
        designHeight = Math.round(bestCanvas.rect.height);
      }

      if (!rect) {
        return {
          ok: false,
          error: "No visible Canva page frame was detected. Zoom/page view may be collapsed.",
        };
      }

      const layers = [];
      // Filled by the timeline-supplement pass; surfaced in the result so background.js can warn
      // when off-screen elements were skipped (their media had no rendered instance to capture).
      let timelineSupplementSummary = null;
      const documentFontAssets = collectDocumentFontAssets();
      const isDuplicateLayerEntry = (candidate) => {
        const tolerance = 1.5;
        return layers.some((existing) => {
          if (existing.kind !== candidate.kind) return false;
          const samePosition =
            Math.abs(Number(existing.x || 0) - Number(candidate.x || 0)) <= tolerance &&
            Math.abs(Number(existing.y || 0) - Number(candidate.y || 0)) <= tolerance &&
            Math.abs(Number(existing.width || 0) - Number(candidate.width || 0)) <= tolerance &&
            Math.abs(Number(existing.height || 0) - Number(candidate.height || 0)) <= tolerance &&
            Math.abs(Number(existing.angle || 0) - Number(candidate.angle || 0)) <= 0.8 &&
            Boolean(existing.flipX) === Boolean(candidate.flipX) &&
            Boolean(existing.flipY) === Boolean(candidate.flipY);
          if (!samePosition) return false;
          if (candidate.kind === "text") {
            return String(existing.text || "").trim() === String(candidate.text || "").trim();
          }
          if (candidate.kind === "image") {
            const a = String(existing.imageSrc || existing.imageDataUrl || "").trim();
            const b = String(candidate.imageSrc || candidate.imageDataUrl || "").trim();
            return Boolean(a && b && a === b);
          }
          return true;
        });
      };

      if (bestPage?.node) {
        const designScaleX = Math.max(0.0001, Number(designWidth || rect.width) / Math.max(Number(rect.width || 1), 1));
        const designScaleY = Math.max(0.0001, Number(designHeight || rect.height) / Math.max(Number(rect.height || 1), 1));

        let backgroundLayerNodes = [];
        const backgroundLayerMeta = new Map();
        const pageArea = Math.max(1, rect.width * rect.height);
        const backgroundCandidatePool = [
          ...Array.from(bestPage.node.querySelectorAll('[style*="touch-action"]')),
          ...Array.from(bestPage.node.querySelectorAll("div")),
        ];
        const backgroundLayerCandidates = backgroundCandidatePool.filter((node, index, list) => {
          if (!node || list.indexOf(node) !== index) return false;
          if (node === bestPage.node) return false;
          if (String(node?.id || "").startsWith("LB")) return false;
          if (node.closest('[id^="LB"]')) return false;
          const nodeRect = node.getBoundingClientRect();
          const bgStyle = window.getComputedStyle(node);
          if (
            bgStyle.display === "none" ||
            Number(bgStyle.opacity || 1) <= 0.01 ||
            nodeRect.width < 80 ||
            nodeRect.height < 80
          ) {
            return false;
          }
          // Canva paints its design from a `visibility:hidden` logical tree (the LB-layer path
          // reads those regardless of visibility). Allow a hidden NON-LB element too WHEN it
          // carries a real image — e.g. a full-page pattern overlay at reduced opacity, which
          // otherwise gets dropped entirely. Paint-only (no-image) hidden elements stay rejected.
          if (bgStyle.visibility === "hidden" && !getNodeVisualAssetKey(node)) {
            return false;
          }
          const intersection = intersectRects(nodeRect, {
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          });
          if (!intersection) return false;
          const visibleArea = rectArea(intersection);
          const pageCoverage = visibleArea / pageArea;
          const assetKey = getNodeVisualAssetKey(node);
          const hasImageElement = Boolean(assetKey);
          const hasBackgroundPaint = hasVisibleBackgroundPaint(node);
          const hasLayerDescendants = Boolean(node.querySelector('[id^="LB"]'));
          if (hasLayerDescendants && !hasImageElement && !hasBackgroundPaint) return false;
          if (!hasImageElement && !hasBackgroundPaint) return false;
          return pageCoverage >= 0.18;
        });
        const scoredBackgroundCandidates = [];
        backgroundLayerCandidates.forEach((candidate) => {
          const candidateRect = candidate.getBoundingClientRect();
          const intersection = intersectRects(candidateRect, {
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          });
          const visibleArea = rectArea(intersection || candidateRect);
          const coverage = visibleArea / pageArea;
          const assetKey = getNodeVisualAssetKey(candidate);
          const hasImageElement = Boolean(assetKey);
          const hasBackgroundPaint = hasVisibleBackgroundPaint(candidate);
          const score =
            coverage * 100 +
            visibleArea / pageArea +
            (hasImageElement ? 0.5 : 0) +
            (hasBackgroundPaint ? 0.5 : 0);
          scoredBackgroundCandidates.push({
            node: candidate,
            score,
            coverage,
            assetKey,
          });
        });
        scoredBackgroundCandidates.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          const assetDelta = Number(Boolean(b.assetKey)) - Number(Boolean(a.assetKey));
          if (assetDelta !== 0) return assetDelta;
          return 0;
        });
        const selectedBackgroundCandidates = [];
        for (let index = 0; index < scoredBackgroundCandidates.length; index += 1) {
          const candidate = scoredBackgroundCandidates[index];
          const candidateRect = candidate.node.getBoundingClientRect();
          const overlapsExisting = selectedBackgroundCandidates.some(
            (existing) => {
              const overlaps =
                existing.node === candidate.node ||
                existing.node.contains(candidate.node) ||
                candidate.node.contains(existing.node);
              if (!overlaps) return false;
              // Canva stacks responsive-resolution copies of ONE layer, nested at the SAME rect
              // with different image URLs. Merge those (same logical layer) so a single overlay
              // isn't imported 2-3×. Distinct stacked backgrounds (paper vs pattern) differ in
              // rect, so they fall through to the asset-based rule and both survive.
              const er = existing.node.getBoundingClientRect();
              const sameRect =
                Math.abs(er.width - candidateRect.width) < 4 &&
                Math.abs(er.height - candidateRect.height) < 4 &&
                Math.abs(er.left - candidateRect.left) < 4 &&
                Math.abs(er.top - candidateRect.top) < 4;
              if (sameRect) return true;
              const sameAsset =
                Boolean(existing.assetKey && candidate.assetKey) &&
                existing.assetKey === candidate.assetKey;
              const uncertainAsset = !existing.assetKey && !candidate.assetKey;
              return sameAsset || uncertainAsset;
            }
          );
          if (overlapsExisting) continue;
          selectedBackgroundCandidates.push(candidate);
          if (selectedBackgroundCandidates.length >= 3) break;
        }
        selectedBackgroundCandidates.forEach((candidate) => {
          backgroundLayerMeta.set(candidate.node, candidate);
        });
        backgroundLayerNodes = selectedBackgroundCandidates.map((candidate) => candidate.node);

        const matchesCanvaLayerId = (node) =>
          Boolean(String(node?.id || "").match(/^LB[A-Za-z0-9_-]+$/));
        const scopedLayerNodes = Array.from(bestPage.node.querySelectorAll('[id^="LB"]'));
        const fallbackLayerNodes =
          scopedLayerNodes.length > 0
            ? []
            : Array.from(document.querySelectorAll("*")).filter(matchesCanvaLayerId);
        const uniqueLayerNodes = [...scopedLayerNodes, ...fallbackLayerNodes].filter(
          (node, index, all) =>
            node?.id &&
            all.findIndex((candidate) => candidate.id === node.id) === index &&
            !backgroundLayerMeta.has(node)
        );
        const layerNodes = [
          ...backgroundLayerNodes,
          ...uniqueLayerNodes,
        ];

        const imageMetadataCandidates = [];
        // Full design-model element map: id → { geometry, text, image ref, animation }. Superset of
        // the DOM; the loop below captures the current frame, then an additive supplement appends the
        // model's off-screen elements (timeline/video designs). Canva's React fiber is ONLY reachable
        // from the MAIN world, so background.js extracts the model there and passes it in via
        // runtimeOptions.fiberModel — content scripts run in an ISOLATED world where DOM nodes don't
        // expose __reactFiber$, so the in-page buildFiberElementModel() only works as a MAIN-world
        // fallback (returns {} here). Raw animation is mapped to the editor's model in background.js.
        const passedModel =
          runtimeOptions && runtimeOptions.fiberModel && typeof runtimeOptions.fiberModel === "object"
            ? runtimeOptions.fiberModel
            : null;
        const fiberModelById =
          passedModel && Object.keys(passedModel).length ? passedModel : buildFiberElementModel();
        // The page's own fill (canva-fiber-main readPageFill): a full-page photo is not an LB
        // element, so its mirror flags and placement box only exist here.
        const pageFill =
          fiberModelById.__pageFill && typeof fiberModelById.__pageFill === "object"
            ? fiberModelById.__pageFill
            : null;
        const pageFillImageBox =
          pageFill?.image?.box && Number(pageFill.image.box.width) > 0 && Number(pageFill.image.box.height) > 0
            ? pageFill.image.box
            : null;

        // ── canva-await-model-images:start
        // A photo-filled element whose <img> is not on the page yet. The model says it shows a
        // photo; with no <img> in its node the scan takes the shape path and paints the node's
        // own background colour — an import right after opening the design came in as one blank
        // white page (DAHYjeZFTxw: a 1152×2048 photo, stored as a 104-byte white
        // shape). Only a model `image` fill counts; a node that has a decoded <img> is ready.
        const nodeAwaitsModelImage = (modelEntry, images) => {
          if (!modelEntry || !modelEntry.image || !modelEntry.image.mediaId) return false;
          const list = Array.isArray(images) ? images : [];
          // A canvas Canva painted the photo into is ready too (it has a size, no naturalWidth).
          return !list.some((image) =>
            String(image?.tagName || "").toUpperCase() === "CANVAS"
              ? Number(image.width) > 0 && Number(image.height) > 0
              : Number(image && image.naturalWidth) > 0
          );
        };
        // ── canva-await-model-images:end
        try {
          const MODEL_IMAGE_WAIT_MS = 4000;
          const startedWaiting = Date.now();
          const pendingNodes = () =>
            layerNodes.filter((candidate) =>
              nodeAwaitsModelImage(fiberModelById[String(candidate.id || "")] || null, [
                ...getScopedImageElements(candidate),
                ...Array.from(candidate.querySelectorAll("canvas")).filter(
                  (canvas) => !isInsideForeignLayer(canvas, candidate)
                ),
              ])
            );
          let pending = pendingNodes();
          while (pending.length > 0 && Date.now() - startedWaiting < MODEL_IMAGE_WAIT_MS) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            pending = pendingNodes();
          }
          if (pending.length > 0) {
            console.warn(
              "[canva-scraper] photo elements still without a loaded <img>:",
              pending.map((candidate) => candidate.id)
            );
          }
        } catch (_waitError) {
          // Waiting is best-effort; the scan below still runs.
        }

        for (let layerIndex = 0; layerIndex < layerNodes.length; layerIndex += 1) {
          const node = layerNodes[layerIndex];
          const styleText = node.getAttribute("style") || "";
          const styleTransform = parseStyleTransform(styleText);
          const computedNodeStyle = window.getComputedStyle(node);
          const transform = parseComputedTransform(computedNodeStyle.transform || styleText);
          const backgroundMeta = backgroundLayerMeta.get(node) || null;
          const isBackgroundNode = Boolean(backgroundMeta);
          const isFullPageBackground = Boolean(backgroundMeta && backgroundMeta.coverage >= 0.9);
          // An animation-player copy (canva-player-copy): its own px are screen px, so everything
          // measured inside it (font size, letter spacing, the glyph nudge) is scaled by
          // `layerUnits` into design px, and its box/opacity come from the resting design.
          const playerCopy = (() => {
            if (isBackgroundNode || !matchesCanvaLayerId(node)) return null;
            if (node.parentElement?.closest?.('[id^="LB"]')) return null;
            const parentScreen = getScreenScale(node.parentElement);
            const units = {
              x: layerUnitsToDesign(parentScreen.x, designScaleX),
              y: layerUnitsToDesign(parentScreen.y, designScaleY),
            };
            if (units.y === 1) return null;
            // Signature: the layer's own CSS width is its design width in SCREEN px (the model has
            // the design width), or — with no model — the zoom wrapper sits inside it. A text with
            // its own inner scale shares that wrapper with the zoom (0.78 × 0.27 on "حفل خطوبة"),
            // so the wrapper alone does not always show it.
            const modelWidth = Number(fiberModelById[String(node.id || "")]?.width) || 0;
            const layoutWidth = Number(node.offsetWidth) || 0;
            const sizedInScreenPx =
              modelWidth > 4 && layoutWidth > 0 && Math.abs(layoutWidth * units.x - modelWidth) <= modelWidth * 0.03;
            if (!sizedInScreenPx && !zoomSitsInsideLayer(node, 1 / units.y)) return null;
            return { units };
          })();
          // A layer inside a SCALED group: Canva lays the group's contents out in the group's own
          // inner space and shrinks them with one transform above the layer, so the layer's px are
          // group px. Its parent's screen scale against the page zoom says how many design px one
          // is (snapped to 1 for an unscaled group). DAHNlFf3ad4's "ل"/"م" monogram — a 304.7 px
          // group laid out 1225.6 px wide inside — came in at a 1471 px font instead of 366.
          const groupedLayerUnits = (() => {
            if (playerCopy || isBackgroundNode || !node.parentElement?.closest?.('[id^="LB"]')) return { x: 1, y: 1 };
            const parentScreen = getScreenScale(node.parentElement);
            return {
              x: layerUnitsToDesign(parentScreen.x, designScaleX),
              y: layerUnitsToDesign(parentScreen.y, designScaleY),
            };
          })();
          const layerUnits = playerCopy ? playerCopy.units : groupedLayerUnits;
          const viewportInfo = isFullPageBackground
            ? {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                rawRect: {
                  left: rect.x,
                  top: rect.y,
                  width: rect.width,
                  height: rect.height,
                  right: rect.x + rect.width,
                  bottom: rect.y + rect.height,
                },
                rawArea: rect.width * rect.height,
                visibleArea: rect.width * rect.height,
                coverage: 1,
              }
            : getTransformedViewportRect(node, rect);
          if (!viewportInfo) continue;

          const viewportRect = {
            x: viewportInfo.x,
            y: viewportInfo.y,
            width: viewportInfo.width,
            height: viewportInfo.height,
          };
          const minLayerSide = Math.max(14, Math.min(rect.width, rect.height) * 0.012);
          const minLayerArea = Math.max(320, rect.width * rect.height * 0.00035);
          const textPreview = getScopedTextPreview(node);
          const hasTextPreview = textPreview.length >= 2;
          const hasVectorSignal = hasRenderableVectorSignal(node);
          const minTextLayerSide = Math.max(4, Math.min(rect.width, rect.height) * 0.004);
          const minTextLayerArea = Math.max(16, rect.width * rect.height * 0.00001);
          const minVectorLayerSide = Math.max(1, Math.min(rect.width, rect.height) * 0.0012);
          const minVectorLayerArea = Math.max(4, rect.width * rect.height * 0.000003);
          const viewportArea = viewportRect.width * viewportRect.height;
          const isLargeEnough = viewportRect.width >= minLayerSide && viewportRect.height >= minLayerSide;
          const hasEnoughArea = viewportArea >= minLayerArea;
          const isTextLayerLargeEnough =
            viewportRect.width >= minTextLayerSide && viewportRect.height >= minTextLayerSide;
          const hasEnoughTextArea = viewportArea >= minTextLayerArea;
          const isVectorLayerLargeEnough =
            viewportRect.width >= minVectorLayerSide && viewportRect.height >= 1.5;
          const hasEnoughVectorArea = viewportArea >= minVectorLayerArea;
          const isInsidePageFrame = layerShowsOnPage({
            coverage: viewportInfo.coverage,
            visibleArea: viewportArea,
            pageArea: rect.width * rect.height,
          });
          const passesDefaultSizeGate = isLargeEnough && hasEnoughArea;
          const passesSmallTextGate =
            hasTextPreview && isTextLayerLargeEnough && hasEnoughTextArea;
          const passesThinVectorGate =
            hasVectorSignal && isVectorLayerLargeEnough && hasEnoughVectorArea;
          // Small image/icon gate: a layer holding a real resolvable image
          // (blob/url/data) should still import even when it falls under the default
          // area threshold — otherwise tiny icons (e.g. a location pin) get dropped.
          const scopedImageElements = getScopedImageElements(node);
          const hasResolvableImage = scopedImageElements.some((element) => {
            const src = String(
              element.currentSrc ||
                element.src ||
                element.getAttribute?.("href") ||
                element.getAttribute?.("xlink:href") ||
                ""
            );
            return /^(blob:|https?:|file:|data:)/i.test(src);
          });
          const minImageLayerSide = Math.max(8, Math.min(rect.width, rect.height) * 0.006);
          const minImageLayerArea = Math.max(64, rect.width * rect.height * 0.00008);
          const passesSmallImageGate =
            hasResolvableImage &&
            viewportRect.width >= minImageLayerSide &&
            viewportRect.height >= minImageLayerSide &&
            viewportArea >= minImageLayerArea;
          // Design-space image gate. The screen-px gate above measures the layer AT IMPORT ZOOM and
          // so drops long thin images: a 952×13 design-px divider line is 272×4 px at 28% and fell
          // under `minImageLayerSide` (8 px); the model supplement then could not resolve its media
          // either (its only rendered instance was the node just rejected) and the line vanished
          // behind a "not visible at the current frame" warning. A layer whose pixels come from a
          // real image source is captured from that source, not from the screen, so what matters is
          // its DESIGN size: keep it when it spans a few px on each axis and a 16×16 area, at any zoom.
          const designImageWidth = viewportRect.width * designScaleX;
          const designImageHeight = viewportRect.height * designScaleY;
          const passesDesignImageGate =
            hasResolvableImage &&
            designImageWidth >= 4 &&
            designImageHeight >= 4 &&
            designImageWidth * designImageHeight >= 256;
          // Model-shape gate: a node the design MODEL classifies as a simple circle/rect is
          // emitted as an editable vector shape — nothing is captured off the screen — so the
          // area thresholds above, which exist to skip layers too small to rasterize usefully,
          // don't apply to it. Without this the bullet DOTS of a list (23×23 in design px, ~110px²
          // on screen at import zoom) fell under `minLayerArea` (320px²) and vanished.
          const modelShapeForNode = (fiberModelById[String(node.id || "")] || {}).shape || null;
          const passesModelShapeGate =
            Boolean(modelShapeForNode) && viewportRect.width >= 1 && viewportRect.height >= 1;
          if (
            !isBackgroundNode &&
            (!isInsidePageFrame ||
              (!passesDefaultSizeGate &&
                !passesSmallTextGate &&
                !passesThinVectorGate &&
                !passesSmallImageGate &&
                !passesDesignImageGate &&
                !passesModelShapeGate))
          ) {
            continue;
          }

          const styleWidth = parseStyleDimension(styleText, "width");
          const styleHeight = parseStyleDimension(styleText, "height");
          const hasStyleGeometry = styleWidth >= 2 && styleHeight >= 2;
          const imageElements = scopedImageElements;
          // Canva stacks a low-res placeholder <img> and the full asset at IDENTICAL geometry
          // (586×800 under 1757×2400 on DAHOnpYP5LI), so a tie on rendered area must go to the
          // copy with the real pixels — document order picked the placeholder and the 3D "8"
          // imported soft.
          const naturalPixels = (element) =>
            (Number(element?.naturalWidth) || 0) * (Number(element?.naturalHeight) || 0);
          const imageElement =
            imageElements
              .map((element) => ({ element, rect: element.getBoundingClientRect() }))
              .sort((a, b) => {
                const areaDelta = rectArea(b.rect) - rectArea(a.rect);
                return Math.abs(areaDelta) > 1 ? areaDelta : naturalPixels(b.element) - naturalPixels(a.element);
              })[0]?.element || null;
          // Canva's animated stickers are looping GIFs (video-public.canva.com/…/v/….gif). Such a
          // layer takes the plain fetch path at the model frame — no fit, no snapshot, no crop —
          // so the animation survives (see keepAnimated / readRemoteAnimatedImageAsset); a GIF that
          // is really a still image is handled like any other picture by the reader's fallback.
          const isAnimatedImageCandidate = Boolean(
            imageElement && /\.gif(?:[?#]|$)/i.test(getImageElementSource(imageElement))
          );
          const imageTitleHint = getImageElementTitleHint(imageElement);
          // Only a genuinely MASKED image (clipped by a frame / clip-path) uses the
          // page-clipped visible rect + a crop. A non-masked image that merely bleeds past
          // the canvas edge (e.g. a full-bleed photo) keeps its FULL asset and FULL geometry
          // — the editor clips the off-canvas part for display, exactly like Canva — so it
          // stays repositionable instead of being permanently cropped to the canvas.
          const isMaskedImage =
            !isBackgroundNode &&
            Boolean(imageElement) &&
            isGenuinelyMaskedImageLayer(node, imageElement);
          // A model-confirmed photo FRAME (plain rect, or round via `mediaShape`) is redrawn by
          // the editor from the fetched asset, so it does NOT need the page-clipped geometry that
          // a snapshot-backed mask needs — a snapshot can only ever hold on-canvas pixels, which
          // is the whole reason masked layers are clipped here. Keeping the FULL frame box (and
          // cropping the asset to that same full box, below) lets a frame that bleeds off the
          // canvas keep its off-canvas part, exactly like Canva: an ellipse frame running past
          // the page's left edge imported inset at (0,0) instead of hanging off the edge.
          // The editor clips the overflow for display, so the layer stays repositionable.
          // Canva's image "corner rounding" is no model frame at all — it is a rounded-rect CSS
          // path() clip on the element — yet the editor reproduces it just as exactly, with the
          // image's own corner radius. Treat it as a plain rect frame.
          const modelOnlyFrameBorder = (fiberModelById[String(node.id || "")] || {}).border || null;
          const domRoundedClip = imageElement && !modelOnlyFrameBorder ? detectRoundedRectClip(node) : null;
          const modelFrameBorder =
            modelOnlyFrameBorder ||
            (domRoundedClip
              ? { rectFrame: true, circleFrame: false, strokeColor: null, strokeWidth: 0, cornerRadius: 1 }
              : null);
          const isReproducibleModelFrame = Boolean(
            imageElement &&
              modelFrameBorder &&
              (modelFrameBorder.rectFrame || modelFrameBorder.circleFrame)
          );
          const layerIsPageClipped = Boolean(
            viewportInfo.rawRect &&
              (Math.abs(Number(viewportInfo.rawRect.width) - Number(viewportRect.width)) > 2 ||
                Math.abs(Number(viewportInfo.rawRect.height) - Number(viewportRect.height)) > 2)
          );
          // A clip-path frame is imported as a real frame (polygon shape + the photo inside). One
          // that is cut off by the page edge keeps its FULL box the way a model frame does — its
          // polygon is normalised to that box and the editor clips the overflow — with the fetched
          // asset, cropped to the full box, as its content: a snapshot can only hold on-canvas
          // pixels. Before, such a frame fell to the snapshot path, which failed, and the torn-paper
          // photo on DAHR4D4QJR4 (19px past both page edges) came in as a plain rectangle. A frame
          // wholly on the page keeps its proven snapshot path (the polygon is read later).
          const clipPathFrame =
            isMaskedImage && !isReproducibleModelFrame
              ? detectClipPathFrameMask(node, imageElement, {
                  // A mirrored layer would need the window's offset mirrored too; left to the old path.
                  allowWindow: !isBackgroundNode && !transform.flipX && !transform.flipY && !transform.hasReflection,
                })
              : null;
          // A WINDOW clip (a polaroid's photo opening, well inside the layer's box): the frame is
          // the window itself — its box, its outline, the fetched photo cropped to it — and the
          // card + trim rings around it become a companion shape above (see frameArtworkRecord).
          // Measured in the layer's own axes, so the tilted polaroids of DAHR4MPh4ls get it too.
          const clipWindow = clipPathFrame?.window || null;
          // An element whose fill is a VIDEO (the model's videoId, or a poster served from
          // video-public.canva.com/<id>/p/) is scraped as that poster; keep its clip outline so the
          // background can swap in the captured clip as a video FRAME (DAHR94gu0m0's arched Kaaba
          // video came in as a plain poster rectangle with no arch).
          const elementVideoId =
            String((fiberModelById[String(node.id || "")] || {}).videoId || "") ||
            (imageElement
              ? /video-public\.canva\.com\/([A-Za-z0-9_-]+)\/p\//.exec(getImageElementSource(imageElement) || "")?.[1] || ""
              : "");
          const videoClipFrame =
            elementVideoId && !clipPathFrame ? detectClipPathFrameMask(node, imageElement, { allowWindow: false }) : null;
          const pageClippedClipPathFrame =
            clipPathFrame && layerIsPageClipped && !clipWindow ? clipPathFrame : null;
          const keepsFullFrameBox =
            isReproducibleModelFrame || Boolean(pageClippedClipPathFrame) || Boolean(clipWindow);
          const shouldUseVisibleGeometry = isMaskedImage && !keepsFullFrameBox;
          // A turned image is moved onto its model's whole frame after capture, whatever box it is
          // measured on here — so its asset must be fitted and cropped for that frame.
          const layerTakesModelFrame =
            Boolean(imageElement) && takesRotatedModelFrame(fiberModelById[String(node.id || "")], fiberModelById);
          // A non-masked image whose FULL frame extends past the canvas edge can NEVER be
          // faithfully captured by a rendered snapshot (the snapshot/isolation pass only sees
          // on-canvas pixels), so it must keep the full fetched asset — otherwise the bleeding
          // part is permanently cropped (this sliced the full-bleed pattern bands to ~57%).
          // Decided HERE, before preferSnapshot, so BOTH the snapshot preference AND the
          // preserve-pixels/fit path skip it. Genuine masks still snapshot (they need the clip).
          const nodeFrameRect = viewportInfo.rawRect || null;
          const frameBleedsOffCanvas =
            !isBackgroundNode &&
            Boolean(nodeFrameRect) &&
            ((nodeFrameRect.left ?? nodeFrameRect.x ?? 0) < rect.x - 1 ||
              (nodeFrameRect.top ?? nodeFrameRect.y ?? 0) < rect.y - 1 ||
              (nodeFrameRect.left ?? nodeFrameRect.x ?? 0) + nodeFrameRect.width >
                rect.x + rect.width + 1 ||
              (nodeFrameRect.top ?? nodeFrameRect.y ?? 0) + nodeFrameRect.height >
                rect.y + rect.height + 1);
          const forceFullAssetOverSnapshot = frameBleedsOffCanvas && !isMaskedImage;
          const rawRect = shouldUseVisibleGeometry
            ? viewportRect
            : viewportInfo.rawRect || viewportRect;
          // The same full-frame rect the geometry above uses, normalized to {x,y,w,h} for the
          // crop call. (getBoundingClientRect gives x/y; the synthetic full-page-background
          // rawRect only has left/top.)
          const frameRectForCrop =
            keepsFullFrameBox && viewportInfo.rawRect
              ? {
                  x: viewportInfo.rawRect.x ?? viewportInfo.rawRect.left ?? viewportRect.x,
                  y: viewportInfo.rawRect.y ?? viewportInfo.rawRect.top ?? viewportRect.y,
                  width: viewportInfo.rawRect.width,
                  height: viewportInfo.rawRect.height,
                }
              : viewportRect;
          const nodeScale = getCompositeScaleToAncestor(node, bestPage.node);
          const layerScaleX = Math.max(0.01, Number(transform.scaleX || 1));
          const layerScaleY = Math.max(0.01, Number(transform.scaleY || 1));
          const rawDesignWidth = Math.max(1, rawRect.width * designScaleX);
          const rawDesignHeight = Math.max(1, rawRect.height * designScaleY);
          const centerDesignX =
            (rawRect.x - rect.x + rawRect.width / 2) * designScaleX;
          const centerDesignY =
            (rawRect.y - rect.y + rawRect.height / 2) * designScaleY;
          // The style width/height are the element's own un-rotated frame in the page's CSS px;
          // nodeScale carries the page zoom (Canva scales the whole page with one transform), so
          // multiplying by the design scale brings them to DESIGN px like rawDesignWidth. They
          // used to stay in SCREEN px: at a zoom inside the 0.8–1.25 match window (81% is the
          // fit zoom of an A4 landscape) they "matched" the raw box and became the layer's size,
          // shrinking every unrotated layer on DAHFE4GgR2Q to 81% around its centre.
          // A masked image the PAGE clips is captured as its on-page window (the asset is cropped
          // to it and the box centred on it), so the frame's own styled size is not its size:
          // DAHNZYC32A0's 5% grunge texture runs 112 px past the right edge, its 968 px window was
          // stretched to the 1080 px frame and slid 56 px left.
          const geometryIsPageWindow = shouldUseVisibleGeometry && Number(viewportInfo.coverage ?? 1) < 0.995;
          const styledWidth = hasStyleGeometry && !geometryIsPageWindow
            ? Math.max(1, styleWidth * nodeScale.x * layerScaleX * designScaleX)
            : 0;
          const styledHeight = hasStyleGeometry && !geometryIsPageWindow
            ? Math.max(1, styleHeight * nodeScale.y * layerScaleY * designScaleY)
            : 0;
          const rotationSourceAngle = styleTransform.hasAngle ? styleTransform.angle : transform.angle;
          const normalizedRotation = ((Number(rotationSourceAngle || 0) % 180) + 180) % 180;
          const isQuarterTurned = Math.abs(normalizedRotation - 90) <= 1.5;
          const layerFrameSize = resolveLayerFrameSize({
            rawWidth: rawDesignWidth,
            rawHeight: rawDesignHeight,
            styledWidth,
            styledHeight,
            isQuarterTurned,
            angle: rotationSourceAngle,
          });
          // A window frame is the window's share of that frame, turned with the layer.
          const windowPlacement = clipWindow
            ? placeClipWindow({
                frameWidth: layerFrameSize.width,
                frameHeight: layerFrameSize.height,
                centerX: centerDesignX,
                centerY: centerDesignY,
                angle: rotationSourceAngle,
                opening: clipWindow,
              })
            : null;
          const frameSize = windowPlacement
            ? { width: windowPlacement.width, height: windowPlacement.height }
            : layerFrameSize;
          // A player copy rests where the design puts it, not where the animation frame has it.
          const playerRestBox = playerCopy
            ? playerCopyRestBox({
                model: fiberModelById[String(node.id || "")] || null,
                modelById: fiberModelById,
                captured: {
                  x: centerDesignX - rawDesignWidth / 2,
                  y: centerDesignY - rawDesignHeight / 2,
                  width: rawDesignWidth,
                  height: rawDesignHeight,
                },
                frameScaleX: transform.scaleX,
                frameScaleY: transform.scaleY,
              })
            : null;
          const width = isFullPageBackground
            ? Math.max(1, Number(designWidth || rect.width))
            : playerRestBox
              ? Math.max(1, playerRestBox.width)
              : frameSize.width;
          const height = isFullPageBackground
            ? Math.max(1, Number(designHeight || rect.height))
            : playerRestBox
              ? Math.max(1, playerRestBox.height)
              : frameSize.height;
          const x = isFullPageBackground
            ? 0
            : playerRestBox
              ? playerRestBox.x
              : (windowPlacement ? windowPlacement.centerX : centerDesignX) - width / 2;
          const y = isFullPageBackground
            ? 0
            : playerRestBox
              ? playerRestBox.y
              : (windowPlacement ? windowPlacement.centerY : centerDesignY) - height / 2;
          const layerAngle = isFullPageBackground
            ? 0
            : transform.hasReflection
              ? transform.angle
              : styleTransform.hasAngle
                ? styleTransform.angle
                : transform.angle;
          // A page-fill photo is mirrored at the FILL level (page.Vb.ctx.bxf[0].flipX), which the
          // DOM transform never shows — the DOM flag stays ignored for the background node and the
          // model's flag is applied instead (a mosque photo imported with the minaret on the wrong side).
          const layerFlipX = isFullPageBackground ? Boolean(pageFill?.flipX) : Boolean(transform.flipX);
          const layerFlipY = isFullPageBackground ? Boolean(pageFill?.flipY) : Boolean(transform.flipY);
          if (width < 2 || height < 2) continue;

          const listMarkerFor = (item) => {
            const listItem = item.closest("li");
            if (!listItem || isInsideForeignLayer(listItem, node)) return "";
            const siblings = Array.from(listItem.parentElement?.children || []).filter((child) => child.tagName === "LI");
            return listMarkerText(window.getComputedStyle(listItem).listStyleType, siblings.indexOf(listItem) + 1);
          };
          const ownParagraphs = Array.from(node.querySelectorAll(TEXT_BLOCK_SELECTOR)).filter(
            (item) => !isInsideForeignLayer(item, node)
          );
          const paragraphRowsDistinct = paragraphsAreDistinctRows(
            ownParagraphs
              .filter((item) => String(item.innerText || "").trim())
              .map((item) => {
                const box = item.getBoundingClientRect();
                return { top: box.top, left: box.left, height: box.height };
              })
          );
          const textFromParagraphs = ownParagraphs
            .map((item) =>
              matchCanvaParagraphDirection(
                `${listMarkerFor(item)}${item.innerText || ""}`,
                window.getComputedStyle(item).direction
              )
            )
            .filter(Boolean)
            .join("\n");
          const text = dedupeTextLines(textFromParagraphs || textPreview, {
            keepRepeats: Boolean(textFromParagraphs) && paragraphRowsDistinct,
          });

          const textStyleElement = findBestTextStyleElement(node, node);

          let shapeFill = "";
          let shapeImageDataUrl = "";
          let thinVectorStrokeStyle = { color: "", strokeOnly: false };
          // A PHOTO (the model's image fill) that Canva is painting into a <canvas> instead of an
          // <img>: DAHYjTZd758's full-page jewel frame was a 900×1600 canvas at import time, the
          // shape path below painted the node's white background and the design came in blank.
          // Take the canvas's own pixels; when they cannot be read (tainted, or a WebGL buffer
          // already cleared) leave the layer imageless so the screenshot crop stands in. Never a
          // shape: the model says it shows a photo.
          const canvasPhoto = (() => {
            if (imageElement) return null;
            const modelEntry = fiberModelById[String(node.id || "")] || null;
            if (!modelEntry || !modelEntry.image || !modelEntry.image.mediaId) return null;
            const canvases = Array.from(node.querySelectorAll("canvas")).filter(
              (candidate) => !isInsideForeignLayer(candidate, node) && candidate.width > 0 && candidate.height > 0
            );
            const largest = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0] || null;
            return { dataUrl: largest ? readCanvasPhotoDataUrl(largest) : "", width: largest?.width || 0, height: largest?.height || 0 };
          })();
          if (!imageElement && !canvasPhoto) {
            const shapeCandidates = [node, ...getScopedDescendants(node)];
            for (let index = 0; index < shapeCandidates.length; index += 1) {
              const candidate = shapeCandidates[index];
              const style = window.getComputedStyle(candidate);
              const backgroundColor = style.backgroundColor;
              if (
                backgroundColor &&
                backgroundColor !== "rgba(0, 0, 0, 0)" &&
                backgroundColor !== "transparent"
              ) {
                shapeFill = backgroundColor;
                break;
              }
            }
            thinVectorStrokeStyle = resolveThinVectorStrokeStyle(node);
            // A vector shape whose every path is transparent or at opacity 0 paints NOTHING in
            // Canva. The background-colour read above still found a colour on some inner wrapper,
            // so two such rects imported as solid black blocks over a silhouette. resolveThin…
            // already skips invisible paths and comes back empty-handed for them; when the node
            // is an SVG-rendered shape with no text and no image, that empty answer is the answer.
            if (
              !text &&
              shapeFill &&
              !thinVectorStrokeStyle.color &&
              findBestSvgRenderCandidate(node) instanceof SVGElement &&
              getScopedImageElements(node).length === 0
            ) {
              continue;
            }
            shapeImageDataUrl = extractShapeImageDataUrl(node, width, height, {
              excludeTextNodes: Boolean(text),
            });
            const shouldRasterizeThinVectorShape =
              shapeImageDataUrl.startsWith("data:image/svg+xml") &&
              hasVectorSignal &&
              (Math.max(1, Math.round(width)) <= 24 ||
                Math.max(1, Math.round(height)) <= 16 ||
                viewportRect.height <= 8);
            if (shouldRasterizeThinVectorShape) {
              const rasterizedShapeImageDataUrl = await rasterizeDataUrlWithCanvas(
                shapeImageDataUrl,
                Math.max(1, Math.round(width)),
                Math.max(1, Math.round(height))
              );
              if (rasterizedShapeImageDataUrl.startsWith("data:image/")) {
                shapeImageDataUrl = rasterizedShapeImageDataUrl;
              }
            }
          }

          // Measure opacity from the IMAGE element (deepest rendered node) up to the page, not
          // just the layer node. Canva applies a layer's transparency (الشفافية) at whatever
          // level holds the artwork — for regular LB layers that's the layer DIV (caught either
          // way), but for a background IMAGE the opacity sits on an inner element the outer
          // background-candidate node doesn't include, so node-only measurement wrongly returned
          // 1 and imported a semi-transparent paper background as fully opaque.
          // A player copy's opacity is the animation frame's (a fade in progress); the model has
          // the layer's own transparency.
          const playerModel = playerCopy ? fiberModelById[String(node.id || "")] || null : null;
          const effectiveOpacity =
            playerModel && Number.isFinite(Number(playerModel.transparency))
              ? Math.max(0, Math.min(1, 1 - (Number(playerModel.transparency) > 1 ? Number(playerModel.transparency) / 100 : Number(playerModel.transparency))))
              : getEffectiveOpacity(imageElement || node, bestPage.node);
          const zIndex = getNumericZIndex(node, bestPage.node);
          let imageSrc = "";
          let imageDataUrl = "";
          let imageProvenance = "";
          let preferSnapshot = false;
          const backgroundImageSignals = [];

          if (shapeImageDataUrl.startsWith("data:image/")) {
            imageSrc = shapeImageDataUrl;
            imageDataUrl = shapeImageDataUrl;
            imageProvenance = "shape-svg";
          }
          if (canvasPhoto && canvasPhoto.dataUrl) {
            imageSrc = canvasPhoto.dataUrl;
            imageDataUrl = canvasPhoto.dataUrl;
            imageProvenance = "canvas";
          } else if (canvasPhoto) {
            // Unreadable canvas: the on-screen pixels are the only copy of the photo.
            preferSnapshot = true;
          }

          let imageAcquisitionJob = null;
          if (imageElement && !imageDataUrl) {
            imageSrc = getImageElementSource(imageElement);
            if (String(imageSrc).startsWith("data:image/")) {
              imageDataUrl = imageSrc;
              imageProvenance = "data";
            } else {
              // Defer acquisition; resolve all jobs in parallel after the loop.
              // The fit target must be the box the asset is finally DRAWN into. For a ROTATED
              // element `width`/`height` here are the DOM's rotated AABB, while the model block
              // further down swaps the frame for the model's un-rotated box — so the fit cropped
              // the asset to the AABB's aspect (0.79 for a 599×817 frame at -7.8°) and the frame
              // then stretched that crop 8% taller (the 3D "8" on DAHOnpYP5LI). Fit to the model
              // frame instead, which is exactly what that block will hand the editor.
              const modelFrameForFit = fiberModelById[String(node.id || "")] || null;
              const fitToModelFrame =
                (!shouldUseVisibleGeometry || layerTakesModelFrame) &&
                modelFrameForFit &&
                Math.abs(Number(modelFrameForFit.rotation) || 0) > 0.5 &&
                Number(modelFrameForFit.width) > 1 &&
                Number(modelFrameForFit.height) > 1;
              // The other responsive copies of this image (same rect): the full-res one often
              // finishes loading AFTER the placeholder, so the pick is settled when the job runs.
              const imageRectForCopies = imageElement.getBoundingClientRect();
              const sameRectCopies = imageElements.filter(
                (candidate) =>
                  candidate !== imageElement &&
                  candidate.tagName === "IMG" &&
                  occupiesSameRectAsMain(candidate, imageRectForCopies)
              );
              imageAcquisitionJob = {
                kind: "element",
                element: imageElement,
                alternates: sameRectCopies,
                keepAnimated: isAnimatedImageCandidate,
                width: fitToModelFrame ? Number(modelFrameForFit.width) : width,
                height: fitToModelFrame ? Number(modelFrameForFit.height) : height,
              };
            }
          }

          if (!imageSrc) {
            const backgroundCandidates = [node, ...getScopedDescendants(node)];
            for (let index = 0; index < backgroundCandidates.length; index += 1) {
              const candidate = backgroundCandidates[index];
              // The glyphs' own paint (gradient text), not an image behind the layer.
              if (isTextClippedBackground(window.getComputedStyle(candidate))) continue;
              const inlineStyle = candidate.getAttribute("style") || "";
              const inlineBackgroundImage = parseBackgroundImageUrl(inlineStyle);
              if (inlineBackgroundImage) {
                backgroundImageSignals.push(inlineBackgroundImage);
                imageSrc = inlineBackgroundImage;
                break;
              }
              const computedBackgroundImage = findCssImageUrl(candidate);
              if (computedBackgroundImage) {
                backgroundImageSignals.push(computedBackgroundImage);
                imageSrc = computedBackgroundImage;
                break;
              }
            }
            if (!imageDataUrl && /^https?:\/\//i.test(String(imageSrc || ""))) {
              imageAcquisitionJob = { kind: "url", url: imageSrc, provenance: "css-bg" };
            }
          }

          if (imageElement && (imageSrc || imageDataUrl)) {
            preferSnapshot =
              !forceFullAssetOverSnapshot &&
              !isAnimatedImageCandidate &&
              (shouldUseVisibleGeometry || shouldPreferRenderedImageSnapshot(node, imageElement));
          }
          if (
            !preferSnapshot &&
            shapeImageDataUrl.startsWith("data:image/") &&
            hasVectorSignal &&
            (Math.max(1, Math.round(width)) <= 8 || Math.max(1, Math.round(height)) <= 8)
          ) {
            preferSnapshot = true;
          }

          const textStyle = textStyleElement ? window.getComputedStyle(textStyleElement) : null;
          const textFontSize = Number.parseFloat(textStyle?.fontSize || "") || 0;
          const textScale = textStyleElement ? getCompositeScaleToAncestor(textStyleElement, node) : { x: 1, y: 1 };
          const customFontSize = textStyleElement ? findCustomFontSizeFromNode(textStyleElement, node) : 0;
          const resolvedFontFamily = normalizeFontFamilyName(textStyle?.fontFamily || "Arial") || "Arial";
          const resolvedFontSize = Math.max(
            8,
            (customFontSize > 0 ? customFontSize : textFontSize > 0 ? textFontSize : 28) * textScale.y * layerUnits.y
          );
          const textLineHeightRaw = Number.parseFloat(textStyle?.lineHeight || "");
          const textLineHeight =
            textLineHeightRaw && textFontSize > 0 ? textLineHeightRaw / textFontSize : 1.2;
          // letter-spacing is a px length in the same unscaled CSS box as font-size, so it needs
          // the same composite scale to reach design px. It was left raw while the font size was
          // scaled, which shrank the em-based charSpacing by the node's own scale factor (a title
          // at scale(1.414) imported with 0.007 em gaps instead of Canva's 0.01 em).
          const textLetterSpacing =
            parseNumericPx(textStyle?.letterSpacing || "") * Math.max(0.01, textScale.x) * layerUnits.x;
          const textDecoration = String(
            textStyle?.textDecorationLine || textStyle?.textDecoration || ""
          ).toLowerCase();
          const textBackgroundStyle = textStyleElement
            ? resolveTextBackgroundStyle(textStyleElement, node)
            : { color: "", radius: 0 };
          const textBackgroundColor = textBackgroundStyle.color;
          const textBackgroundRadius = textBackgroundStyle.radius;
          // Multi-style text: every run of the FIRST paragraph copy (outline and gradient effects
          // paint a second copy) with its own style, in reading order. background.js matches them
          // back onto the layer's final text as its textSpans (canva-text-spans) — DAHQBJ7cipQ's
          // "طلّب أونلاين وخليك مرتاح…" alternates white and yellow inside one paragraph, and the
          // import used to keep one colour for the whole box. Null when the box is one style.
          const readCanvaTextRuns = () => {
            const paragraphs = Array.from(node.querySelectorAll(TEXT_BLOCK_SELECTOR)).filter(
              (item) => !isInsideForeignLayer(item, node)
            );
            const firstCopy = paragraphs.filter((item) => item.parentElement === paragraphs[0]?.parentElement);
            const runs = [];
            const styleKeys = new Set();
            firstCopy.forEach((paragraph, index) => {
              if (index > 0) runs.push({ text: "\n", style: null });
              const marker = listMarkerFor(paragraph);
              if (marker) runs.push({ text: marker, style: null });
              const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
              let textNode;
              while ((textNode = walker.nextNode())) {
                const data = String(textNode.data || "");
                if (!data) continue;
                const owner = textNode.parentElement || paragraph;
                const style = window.getComputedStyle(owner);
                const scale = getCompositeScaleToAncestor(owner, node);
                const runStyle = {
                  fontFamily: normalizeFontFamilyName(style.fontFamily || "") || "",
                  fontWeight: parseFontWeight(style.fontWeight),
                  fontStyle: normalizeFontStyle(style.fontStyle),
                  fontSize: Math.round((Number.parseFloat(style.fontSize || "") || 0) * scale.y * layerUnits.y * 1000) / 1000,
                  color: String(style.color || ""),
                  letterSpacing:
                    Math.round(parseNumericPx(style.letterSpacing || "") * Math.max(0.01, scale.x) * layerUnits.x * 1000) / 1000,
                  textDecoration: String(style.textDecorationLine || style.textDecoration || "").toLowerCase(),
                };
                if (data.trim()) styleKeys.add(JSON.stringify(runStyle));
                runs.push({ text: data, style: runStyle });
              }
            });
            return styleKeys.size > 1 ? runs : null;
          };

          const mediaWidth = Number(imageElement?.naturalWidth || imageElement?.width?.baseVal?.value || 0);
          const mediaHeight = Number(imageElement?.naturalHeight || imageElement?.height?.baseVal?.value || 0);
          const hasMediaDimensions = mediaWidth >= 12 && mediaHeight >= 12;
          const hasImageSignal = Boolean(imageElement || imageSrc || imageDataUrl || backgroundImageSignals.length);
          const zIndexSignal = zIndex === null || zIndex >= -10;
          // Above 1%, not 3%: a full-width calligraphy watermark at 2% is faint by design and
          // plainly visible in Canva's render, and 3% dropped it entirely. 1% is also what the
          // background-candidate and thin-vector passes already use as "invisible".
          const opacitySignal = effectiveOpacity > 0.01;
          let imageConfidence = 0;
          if (imageElement) imageConfidence += 3;
          if (shapeImageDataUrl) imageConfidence += 4;
          if (imageSrc) imageConfidence += 2;
          if (imageDataUrl) imageConfidence += 2;
          if (hasMediaDimensions) imageConfidence += 1;
          if (isLargeEnough && hasEnoughArea) imageConfidence += 1;
          if (isInsidePageFrame) imageConfidence += 1;
          if (opacitySignal) imageConfidence += 1;
          if (zIndexSignal) imageConfidence += 1;

          const isLikelyImageLayer =
            hasImageSignal &&
            isInsidePageFrame &&
            opacitySignal &&
            imageConfidence >= 5 &&
            ((isLargeEnough && hasEnoughArea) || passesSmallImageGate || passesDesignImageGate);
          const roundedWidth = Math.max(1, Math.round(width));
          const roundedHeight = Math.max(1, Math.round(height));
          const vectorAspectRatio =
            Math.max(roundedWidth, roundedHeight) / Math.max(1, Math.min(roundedWidth, roundedHeight));
          const isThinVectorDividerLayer =
            !imageElement &&
            !text &&
            hasVectorSignal &&
            thinVectorStrokeStyle.strokeOnly &&
            !thinVectorStrokeStyle.dashed &&
            Boolean(thinVectorStrokeStyle.color) &&
            vectorAspectRatio >= 12 &&
            (roundedWidth <= 8 ||
              roundedHeight <= 8 ||
              viewportRect.width <= 8 ||
              viewportRect.height <= 8);

          const kind = isThinVectorDividerLayer
            ? "shape"
            : shapeImageDataUrl
            ? "image"
            : isLikelyImageLayer
              ? "image"
              : text
                ? "text"
                : shapeFill
                  ? "shape"
                  : "unknown";
          if (kind === "unknown") continue;
          const parentLayerNode = node.parentElement?.closest?.('[id^="LB"]');
          const parentId =
            parentLayerNode && parentLayerNode !== node
              ? String(parentLayerNode.id || "").trim()
              : "";
          const fallbackReason =
            kind === "image" && preferSnapshot
              ? "masked-or-clipped"
              : kind === "image" && !imageSrc && !imageDataUrl
                ? "unresolved-image-source"
                : "";

          const normalizedLayerAngle = isThinVectorDividerLayer ? 0 : layerAngle;
          // Canva applies mirroring at the FILL level (inner media element), invisible to the LB
          // node's transform matrix — merge the model's fill flips in or mirrored decorations
          // import un-mirrored (e.g. paired corner flowers, one flipX + rot180).
          const modelEntryForFlip = fiberModelById[String(node.id || "")] || {};
          const modelFillImage = modelEntryForFlip.image || null;
          // A video fill (animated sticker) has no `image` entry; its mirroring rides on fillFlip.
          const modelFillFlip = modelFillImage || modelEntryForFlip.fillFlip || null;
          const normalizedLayerFlipX =
            (isThinVectorDividerLayer ? false : layerFlipX) || Boolean(modelFillFlip?.flipX);
          const normalizedLayerFlipY =
            (isThinVectorDividerLayer ? false : layerFlipY) || Boolean(modelFillFlip?.flipY);
          const imageRect = imageElement?.getBoundingClientRect?.() || null;
          // Compare the image against its FULL (unclipped) layer frame, NOT the page-clipped
          // viewportRect. Otherwise any image that merely bleeds past the CANVAS edge (a
          // full-bleed decorative pattern/photo) looks like it "overflows its container" and
          // has a mismatched aspect versus the clipped slice — a false positive that forces the
          // lossy snapshot/fit-to-visible path and permanently crops off the bleeding part.
          // A genuine mask (image larger than its frame) still overflows the full frame → true.
          const rawFrame = viewportInfo.rawRect || null;
          const frameRect = rawFrame
            ? {
                x: rawFrame.left ?? rawFrame.x ?? viewportRect.x,
                y: rawFrame.top ?? rawFrame.y ?? viewportRect.y,
                width: rawFrame.width,
                height: rawFrame.height,
              }
            : viewportRect;
          const overflowsContainer =
            imageRect &&
            (imageRect.left < frameRect.x - 0.5 ||
              imageRect.top < frameRect.y - 0.5 ||
              imageRect.right > frameRect.x + frameRect.width + 0.5 ||
              imageRect.bottom > frameRect.y + frameRect.height + 0.5);
          const aspectMismatch =
            imageRect &&
            imageRect.width > 0.01 &&
            imageRect.height > 0.01 &&
            Math.abs(
              imageRect.width / imageRect.height -
                frameRect.width / Math.max(0.01, frameRect.height)
            ) > 0.01;
          const hasCompanionText =
            kind === "image" &&
            Boolean(text && textStyleElement);
          const prefersRenderedImageSnapshot =
            Boolean(imageElement) &&
            kind === "image" &&
            shouldPreferRenderedImageSnapshot(node, imageElement);
          const shouldPreserveRenderedImagePixels =
            imageElement &&
            kind === "image" &&
            !forceFullAssetOverSnapshot &&
            !isAnimatedImageCandidate &&
            (
              shouldUseVisibleGeometry ||
              prefersRenderedImageSnapshot ||
              overflowsContainer ||
              aspectMismatch
            );
          // The rendered snapshot is only genuinely needed for shaped masks / rotation /
          // flip / compositing / baked pixel effects (see snapshotRequiredForLayer). A
          // plain rectangular crop — even one zoomed/panned inside its frame — is faithfully
          // reproduced by the fetched original cropped to the visible region, at far higher
          // resolution and without the screenshot's overlap artifacts, so for those layers
          // the snapshot is only a lossy fallback.
          const snapshotReason = shouldPreserveRenderedImagePixels
            ? snapshotRequiredForLayer(node, imageElement, modelFrameBorder, {
                plainModelImage: isPlainModelImage(fiberModelById[String(node.id || "")] || null),
              })
            : "";
          const hasGenuineMaskOrComposite = Boolean(snapshotReason);
          const snapshotIsLossyFallback =
            Boolean(shouldPreserveRenderedImagePixels) && !hasGenuineMaskOrComposite;
          // The stored template says why a layer took the snapshot ("masked-or-clipped:filter").
          const fallbackReasonWithCause =
            snapshotReason && fallbackReason === "masked-or-clipped"
              ? `masked-or-clipped:${snapshotReason}`
              : fallbackReason;

          // The model states outright whether the media is cropped inside its frame, so this no
          // longer depends on the DOM heuristic guessing "masked". Only valid while the layer keeps
          // its FULL frame geometry — when shouldUseVisibleGeometry clips the box to the on-canvas
          // part, the crop has to describe that same clipped rectangle, which only the DOM
          // measurement does.
          const modelElementForCrop = fiberModelById[String(node.id || "")] || null;
          // The page fill's photo placement (`__pageFill.image.box`, page px, may exceed the page)
          // is the same contract as an element's media crop, so it feeds the same region math —
          // the slice the page shows, in the media's own space. Before, the photo was blindly
          // cover-fitted, which only matches Canva when the placement happens to be centred.
          // (The model's crop is laid out on the whole element; a window frame measures the DOM.)
          const modelCropRegion = clipWindow || !modelCropAppliesToLayer({
            usesVisibleGeometry: shouldUseVisibleGeometry,
            pageClipped: layerIsPageClipped,
            fillFlipX: Boolean(modelFillImage?.flipX),
            fillFlipY: Boolean(modelFillImage?.flipY),
            takesModelFrame: layerTakesModelFrame,
          })
            ? null
            : isFullPageBackground && pageFillImageBox
              ? modelCropRegionForFrame(pageFillImageBox, designWidth, designHeight) ||
                quarterTurnedPageFillCrop(pageFillImageBox, designWidth, designHeight)?.region ||
                null
              : modelCropRegionForFrame(
                  modelFillImage?.crop,
                  modelElementForCrop?.width,
                  modelElementForCrop?.height
                );
          // The slice of a quarter-turned page fill is cut from the un-turned photo and turned to
          // lie as Canva shows it (the background layer itself stays unrotated, full page).
          const pageFillQuarterTurns =
            isFullPageBackground && pageFillImageBox && modelCropRegion
              ? quarterTurnedPageFillCrop(pageFillImageBox, designWidth, designHeight)?.quarterTurns || 0
              : 0;

          // A model-reported crop means the element shows a SLICE of its media. Without the fit
          // path the fetched asset is drawn whole into the frame; with it but no region, the
          // centre-crop-to-aspect fallback slices the middle — which is how a square floral
          // vignette masked to a tall strip came in as a 91x382 sliver stretched 5x.
          if (modelCropRegion && imageAcquisitionJob?.kind === "element" && !isAnimatedImageCandidate) {
            imageAcquisitionJob = {
              ...imageAcquisitionJob,
              fitFetchedToTarget: true,
              ...(pageFillQuarterTurns ? { quarterTurns: pageFillQuarterTurns } : {}),
            };
          }

          if ((shouldPreserveRenderedImagePixels || modelCropRegion) && imageAcquisitionJob?.kind === "element") {
            // buildDisplayedImageCropRegion maps the visible region in SCREEN space; for a layer
            // rendered rotated ~180° (and/or fill-mirrored) that region must be remapped into the
            // UN-rotated source's coordinate space or the crop picks the OPPOSITE corner of the
            // media (symptom: corner bouquets sliced mid-flower). rot180 mirrors both axes; a fill
            // flip mirrors X once more; the editor re-applies angle+flip at render, so the slice
            // must be cut from the pre-image location.
            const remapRegionForOrientation = (region) => {
              if (!region) return region;
              // A quarter turn swaps the axes: the source's width runs down the screen at +90° and
              // up it at -90°. Measured on screen, a landscape slice of a turned photo reads as a
              // portrait one — the vegetable strip on DAHPQABmz_M came in as a narrow column of
              // the photo stretched 2.4x. Undo the turn first, then the fill mirroring.
              const quarter = ((Math.round(normalizedLayerAngle) % 360) + 360) % 360;
              if (Math.abs(quarter - 90) <= 1 || Math.abs(quarter - 270) <= 1) {
                const turned =
                  Math.abs(quarter - 90) <= 1
                    ? { x: region.y, y: 1 - region.x - region.width, width: region.height, height: region.width }
                    : { x: 1 - region.y - region.height, y: region.x, width: region.height, height: region.width };
                if (normalizedLayerFlipX) turned.x = 1 - turned.x - turned.width;
                if (normalizedLayerFlipY) turned.y = 1 - turned.y - turned.height;
                return {
                  x: Math.max(0, Math.min(1, turned.x)),
                  y: Math.max(0, Math.min(1, turned.y)),
                  width: Math.max(0, Math.min(1, turned.width)),
                  height: Math.max(0, Math.min(1, turned.height)),
                };
              }
              const near180 = Math.abs(Math.abs(normalizedLayerAngle) - 180) <= 1;
              const mirrorX = near180 !== Boolean(normalizedLayerFlipX);
              const mirrorY = near180 !== Boolean(normalizedLayerFlipY);
              const next = { ...region };
              if (mirrorX) next.x = Math.max(0, Math.min(1, 1 - region.x - region.width));
              if (mirrorY) next.y = Math.max(0, Math.min(1, 1 - region.y - region.height));
              return next;
            };
            imageAcquisitionJob = {
              ...imageAcquisitionJob,
              fitFetchedToTarget: true,
              // Crop the asset to the visible region ONLY for masked images (a frame clips
              // them). A non-masked bleed image keeps its full asset (no crop) so its
              // off-canvas part survives; fitDataUrlToDisplayedBox then only matches aspect.
              // A reproducible frame crops to its FULL box, not the page-clipped one — its
              // geometry is the full box too (see shouldUseVisibleGeometry), and the two must
              // describe the same rectangle or the photo slides inside its frame.
              // A layer bound for its model's whole frame never takes the on-screen slice: with no
              // model crop its asset is fitted to that frame (fitToModelFrame) instead.
              cropRegion:
                (clipWindow && clipWindow.crop) ||
                modelCropRegion ||
                (isMaskedImage && !layerTakesModelFrame
                  ? remapRegionForOrientation(
                      buildDisplayedImageCropRegion(imageElement, frameRectForCrop)
                    )
                  : null),
            };
          }
          if (shouldPreserveRenderedImagePixels && !hasCompanionText) {
            preferSnapshot = true;
          }

          // A model-confirmed photo FRAME (rect or circle) is reproduced by the editor straight
          // from the fetched asset — corner radius + stroke — so the rendered snapshot is never
          // needed, whichever heuristic asked for it. This override is what makes that stick:
          // `preferSnapshot` is ALSO set by the earlier visible-geometry / rendered-snapshot
          // check, and that path leaves `snapshotIsLossyFallback` false, so background.js never
          // reaches `directAssetPreferredOverSnapshot` and force-takes the snapshot. Observed on
          // a circular photo whose isolation snapshot had the frame's white ring baked into the
          // pixels — the editor's own stroke then drew a SECOND ring around it. Its twin on the
          // same page imported clean, so this is decided per layer by DOM heuristics that the
          // model can settle outright.
          // (isReproducibleModelFrame is computed with the geometry above — it decides both.)
          if (keepsFullFrameBox) {
            preferSnapshot = false;
          }

          const layerAnimation = (fiberModelById[String(node.id || "")] || {}).animation || null;
          const textBackgroundEffect = kind === "text" ? detectTextBackgroundEffect(node, width) : null;
          const textBox = textBackgroundEffect
            ? hugTextBoxToInk({
                x,
                width: roundedWidth,
                inkWidth: textBackgroundEffect.inkWidthPx,
                lineCount: textBackgroundEffect.lineCount,
                align: textStyle?.textAlign,
              })
            : { x, width: roundedWidth };
          const layerRecord = {
            id: String(node.id || `layer-${layerIndex + 1}`),
            parentId: parentId || null,
            name:
              String(node.getAttribute?.("aria-label") || "").trim() ||
              String(node.getAttribute?.("data-element-name") || "").trim() ||
              imageTitleHint ||
              `${kind === "text" ? "Text" : shapeImageDataUrl ? "Shape" : kind === "shape" ? "Shape" : "Image"} ${layerIndex + 1}`,
            kind,
            ...(layerAnimation ? { animation: layerAnimation } : {}),
            x: textBox.x,
            y,
            width: textBox.width,
            height: roundedHeight,
            angle: normalizedLayerAngle,
            flipX: normalizedLayerFlipX,
            flipY: normalizedLayerFlipY,
            viewportRect: {
              x: viewportRect.x,
              y: viewportRect.y,
              width: viewportRect.width,
              height: viewportRect.height,
            },
            pageRelativeRect: {
              x: textBox.x,
              y,
              width: textBox.width,
              height: roundedHeight,
            },
            imageSrc,
            imageDataUrl,
            imageProvenance,
            imageAcquisitionJob,
            preferSnapshot,
            // Same override: a reproducible frame always prefers its fetched asset, so mark the
            // snapshot as a lossy fallback even when the preserve-pixels branch didn't.
            snapshotIsLossyFallback: keepsFullFrameBox ? true : snapshotIsLossyFallback,
            // The corner radius of a rounded-rect clip, in design px on this layer's own box (the
            // timeline pass only attaches MODEL borders, so a DOM-read one rides here).
            ...(domRoundedClip
              ? {
                  modelBorder: {
                    rectFrame: true,
                    circleFrame: false,
                    strokeColor: null,
                    strokeWidth: 0,
                    cornerRadius: domRoundedClip.fraction * Math.min(roundedWidth, roundedHeight),
                  },
                }
              : {}),
            sourceWidth:
              shouldPreserveRenderedImagePixels
                ? roundedWidth
                : mediaWidth > 0
                  ? mediaWidth
                  : shapeImageDataUrl
                    ? Math.max(1, Math.round(width))
                    : undefined,
            sourceHeight:
              shouldPreserveRenderedImagePixels
                ? roundedHeight
                : mediaHeight > 0
                  ? mediaHeight
                  : shapeImageDataUrl
                    ? Math.max(1, Math.round(height))
                    : undefined,
            text: kind === "text" ? text : "",
            textAlign: textStyle?.textAlign || "left",
            color: textStyle?.color || "#111827",
            fontFamily: resolvedFontFamily,
            fontLacksArabic:
              kind === "text" && ARABIC_LETTER_PATTERN.test(String(text || ""))
                ? fontLacksArabicGlyphs(textStyle?.fontFamily, textStyle?.fontWeight, textStyle?.fontStyle)
                : false,
            fontLacksLatin:
              kind === "text" && !ARABIC_LETTER_PATTERN.test(String(text || ""))
                ? textFallsBackToCanvaLatin(
                    textStyle?.fontFamily,
                    resolveEffectiveFontWeight(textStyleElement, node, textStyle),
                    textStyle?.fontStyle,
                    text
                  )
                : false,
            // An Arabic text whose digits / Latin letters the font lacks: Canva draws just those
            // with `_fb_` (Noto Sans) — "15 ريال" in an Arabic-only face. The whole-layer swap
            // above would lose the Arabic face, so background.js turns those runs into ranges.
            latinFallsBackInMixedText:
              kind === "text" &&
              ARABIC_LETTER_PATTERN.test(String(text || "")) &&
              /[A-Za-z0-9]/.test(String(text || ""))
                ? textFallsBackToCanvaLatin(
                    textStyle?.fontFamily,
                    resolveEffectiveFontWeight(textStyleElement, node, textStyle),
                    textStyle?.fontStyle,
                    text
                  )
                : false,
            fontSize: resolvedFontSize,
            fontStyle: textStyle?.fontStyle || "normal",
            fontWeight: resolveEffectiveFontWeight(textStyleElement, node, textStyle),
            lineHeight: Math.max(0.8, textLineHeight || 1.2),
            letterSpacing: textLetterSpacing,
            textDecoration,
            textBackgroundColor,
            textBackgroundRadius,
            textStroke: kind === "text" ? detectTextStrokeEffect(node) : null,
            textCurve: kind === "text" ? detectTextCurve(node) : null,
            textShiftY:
              kind === "text" && textStyleElement ? getInnerTextShiftY(textStyleElement, node) * layerUnits.y : 0,
            textWrapRange:
              kind === "text" && textStyleElement
                ? measureTextWrapRange(
                    node,
                    text,
                    ARABIC_LETTER_PATTERN.test(String(text || "")) &&
                      fontLacksArabicGlyphs(textStyle?.fontFamily, textStyle?.fontWeight, textStyle?.fontStyle)
                  )
                : null,
            textFill: kind === "text" ? readTextGradientFill(node) : null,
            textRuns: kind === "text" ? readCanvaTextRuns() : null,
            textBackgroundEffect,
            frameMask:
              kind === "image" && (clipPathFrame || videoClipFrame)
                ? { points: (clipPathFrame || videoClipFrame).points }
                : null,
            elementVideoId: kind === "image" ? elementVideoId : "",
            fill: isThinVectorDividerLayer ? thinVectorStrokeStyle.color : shapeFill || "",
            zIndex: zIndex ?? layerIndex,
            opacity: effectiveOpacity,
            titleEn: kind === "image" ? imageTitleHint : "",
            tagsEn:
              kind === "image" && imageTitleHint
                ? uniqueMetadataStrings(tokenizeMetadataLabel(imageTitleHint))
                : [],
            labelsEn:
              kind === "image" && imageTitleHint
                ? uniqueMetadataStrings([imageTitleHint, ...tokenizeMetadataLabel(imageTitleHint)])
                : [],
            isBackgroundNode,
            isFullPageBackground,
            fallback: Boolean(fallbackReason),
            fallbackReason: fallbackReasonWithCause,
            hasCompanionText,
          };
          // One text record per table-cell paragraph, in the paragraph's own box and style (the
          // same fields the companion record carries, read per cell instead of once for the node).
          function buildTableCellTextRecords(options = {}) {
            const idSuffix = String(options.idSuffix || "cell");
            const allParagraphs = Array.from(node.querySelectorAll(TEXT_BLOCK_SELECTOR)).filter(
              (paragraph) => !isInsideForeignLayer(paragraph, node) && String(paragraph.innerText || "").trim()
            );
            // One copy of the paragraphs (an outlined/gradient text is laid out twice).
            const paragraphs = options.firstCopyOnly
              ? allParagraphs.filter((paragraph) => paragraph.parentElement === allParagraphs[0]?.parentElement)
              : allParagraphs;
            if (paragraphs.length < 2) return [];
            const records = [];
            paragraphs.forEach((paragraph, cellIndex) => {
              const cellText = String(paragraph.innerText || "").replace(/[\r\n]+$/, "");
              const styleElement = paragraph.querySelector("span") || paragraph;
              const cellStyle = window.getComputedStyle(styleElement);
              const cellViewport = getTransformedViewportRect(paragraph, rect);
              if (!cellViewport) return;
              const cellScale = getCompositeScaleToAncestor(styleElement, node);
              const cellCustomSize = findCustomFontSizeFromNode(styleElement, node);
              const cellCssSize = Number.parseFloat(cellStyle.fontSize || "") || 0;
              // In design px like the whole layer's own font: × layerUnits (an animation-player copy's or a
              // scaled group's px are not design px).
              const cellFontSize = Math.max(
                8,
                (cellCustomSize > 0 ? cellCustomSize : cellCssSize > 0 ? cellCssSize : 28) * cellScale.y * layerUnits.y
              );
              const cellLineHeightRaw = Number.parseFloat(cellStyle.lineHeight || "");
              const cellWidth = Math.max(1, Math.round(cellViewport.width * designScaleX));
              const cellHeight = Math.max(1, Math.round(cellViewport.height * designScaleY));
              const cellX = (cellViewport.x - rect.x) * designScaleX;
              const cellY = (cellViewport.y - rect.y) * designScaleY;
              const cellWeight = resolveEffectiveFontWeight(styleElement, node, cellStyle);
              records.push({
                id: `${String(node.id || `layer-${layerIndex + 1}`)}__${idSuffix}${cellIndex + 1}`,
                parentId: options.topLevel ? null : String(node.id || "").trim() || null,
                name: `${String(layerRecord.name || `Layer ${layerIndex + 1}`)} ${cellIndex + 1}`,
                kind: "text",
                x: cellX,
                y: cellY,
                width: cellWidth,
                height: cellHeight,
                angle: 0,
                flipX: false,
                flipY: false,
                viewportRect: { x: cellViewport.x, y: cellViewport.y, width: cellViewport.width, height: cellViewport.height },
                pageRelativeRect: { x: cellX, y: cellY, width: cellWidth, height: cellHeight },
                imageSrc: "",
                imageDataUrl: "",
                preferSnapshot: false,
                sourceWidth: undefined,
                sourceHeight: undefined,
                text: matchCanvaParagraphDirection(cellText, cellStyle.direction),
                textAlign: cellStyle.textAlign || "center",
                color: cellStyle.color || "#111827",
                fontFamily: normalizeFontFamilyName(cellStyle.fontFamily || "Arial") || "Arial",
                fontLacksArabic: ARABIC_LETTER_PATTERN.test(cellText)
                  ? fontLacksArabicGlyphs(cellStyle.fontFamily, cellWeight, cellStyle.fontStyle)
                  : false,
                fontLacksLatin: !ARABIC_LETTER_PATTERN.test(cellText)
                  ? textFallsBackToCanvaLatin(cellStyle.fontFamily, cellWeight, cellStyle.fontStyle, cellText)
                  : false,
                fontSize: cellFontSize,
                fontStyle: cellStyle.fontStyle || "normal",
                fontWeight: cellWeight,
                lineHeight: Math.max(0.8, cellLineHeightRaw && cellCssSize > 0 ? cellLineHeightRaw / cellCssSize : 1.2),
                letterSpacing: parseNumericPx(cellStyle.letterSpacing || "") * Math.max(0.01, cellScale.x) * layerUnits.x,
                textDecoration: String(cellStyle.textDecorationLine || cellStyle.textDecoration || "").toLowerCase(),
                textBackgroundColor: "",
                textBackgroundRadius: 0,
                fill: "",
                zIndex: (zIndex ?? layerIndex) + 0.25 + cellIndex * 0.001,
                opacity: effectiveOpacity,
                titleEn: "",
                tagsEn: [],
                labelsEn: [],
                fallback: false,
                fallbackReason: "",
              });
            });
            return records;
          }

          // A TEXT layer whose paragraphs carry different styles becomes one layer per paragraph
          // (each uniform inside). Kept whole when it curves, has a background or an outline — those
          // effects belong to the whole box — or when a paragraph mixes styles within itself.
          const paragraphStyleKey = (paragraph) => {
            const keys = new Set();
            const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
            let textNode;
            while ((textNode = walker.nextNode())) {
              if (!String(textNode.data || "").trim()) continue;
              const style = window.getComputedStyle(textNode.parentElement);
              keys.add(`${style.fontWeight}|${style.fontSize}|${style.fontFamily}|${style.color}|${style.fontStyle}`);
            }
            return keys.size === 1 ? [...keys][0] : null;
          };
          const splitParagraphRecords = (() => {
            if (kind !== "text" || layerRecord.textCurve || textBackgroundEffect || layerRecord.textStroke) return [];
            const allParagraphs = Array.from(node.querySelectorAll(TEXT_BLOCK_SELECTOR)).filter(
              (paragraph) => !isInsideForeignLayer(paragraph, node) && String(paragraph.innerText || "").trim()
            );
            const firstCopy = allParagraphs.filter((paragraph) => paragraph.parentElement === allParagraphs[0]?.parentElement);
            if (!paragraphStylesDiffer(firstCopy.map(paragraphStyleKey))) return [];
            return buildTableCellTextRecords({ idSuffix: "p", topLevel: true, firstCopyOnly: true });
          })();

          // A Canva GRID: one image record per cell, each its own photo cropped to the cell, in place
          // of one picture stretched over the whole element (see resolveGridCells). Unrotated grids
          // only; anything else keeps the old single-record path.
          const gridCellRecords = (() => {
            if (kind !== "image") return [];
            if (String((fiberModelById[String(node.id || "")] || {}).elementType || "") !== "grid") return [];
            if (Math.abs(Number(normalizedLayerAngle) || 0) >= 0.5) return [];
            const byCell = new Map();
            getScopedImageElements(node).forEach((image) => {
              if (String(image.tagName).toLowerCase() !== "img") return;
              let cell = image.parentElement;
              while (cell && cell !== node && window.getComputedStyle(cell).overflow === "visible") cell = cell.parentElement;
              if (!cell || cell === node) return;
              const entry = byCell.get(cell) || { cell, images: [] };
              entry.images.push(image);
              byCell.set(cell, entry);
            });
            const candidates = Array.from(byCell.values()).map((entry) => {
              const r = entry.cell.getBoundingClientRect();
              const image = entry.images
                .slice()
                .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
              return { key: entry.cell, image, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
            });
            const nodeRect = node.getBoundingClientRect();
            const cells = resolveGridCells(candidates, {
              left: nodeRect.left,
              top: nodeRect.top,
              width: nodeRect.width,
              height: nodeRect.height,
            });
            return cells
              .map((cell, cellIndex) => {
                const visible = intersectRects(
                  { x: cell.rect.left, y: cell.rect.top, width: cell.rect.width, height: cell.rect.height },
                  rect
                );
                if (!visible || !(visible.width > 1) || !(visible.height > 1)) return null;
                const cellX = (visible.x - rect.x) * designScaleX;
                const cellY = (visible.y - rect.y) * designScaleY;
                const cellWidth = Math.max(1, visible.width * designScaleX);
                const cellHeight = Math.max(1, visible.height * designScaleY);
                const cellTitle = getImageElementTitleHint(cell.image) || imageTitleHint;
                return {
                  ...layerRecord,
                  id: `${String(node.id || `layer-${layerIndex + 1}`)}__cell${cellIndex + 1}`,
                  name: cellTitle || `${String(layerRecord.name || "Grid")} ${cellIndex + 1}`,
                  x: cellX,
                  y: cellY,
                  width: cellWidth,
                  height: cellHeight,
                  angle: 0,
                  flipX: false,
                  flipY: false,
                  viewportRect: { x: visible.x, y: visible.y, width: visible.width, height: visible.height },
                  pageRelativeRect: { x: cellX, y: cellY, width: cellWidth, height: cellHeight },
                  imageSrc: getImageElementSource(cell.image),
                  imageDataUrl: "",
                  imageProvenance: "",
                  imageAcquisitionJob: {
                    kind: "element",
                    element: cell.image,
                    alternates: [],
                    keepAnimated: false,
                    width: cellWidth,
                    height: cellHeight,
                    fitFetchedToTarget: true,
                    cropRegion: buildDisplayedImageCropRegion(cell.image, visible),
                  },
                  preferSnapshot: false,
                  snapshotIsLossyFallback: true,
                  sourceWidth: undefined,
                  sourceHeight: undefined,
                  frameMask: null,
                  modelBorder: undefined,
                  elementVideoId: "",
                  zIndex: (zIndex ?? layerIndex) + cellIndex * 0.001,
                  titleEn: cellTitle,
                  tagsEn: cellTitle ? uniqueMetadataStrings(tokenizeMetadataLabel(cellTitle)) : [],
                  labelsEn: cellTitle ? uniqueMetadataStrings([cellTitle, ...tokenizeMetadataLabel(cellTitle)]) : [],
                  fallback: false,
                  fallbackReason: "",
                  hasCompanionText: false,
                };
              })
              .filter(Boolean);
          })();

          let companionTextRecord = null;
          // A Canva table's labels are one paragraph per cell, laid out by the table: splitting
          // them keeps each where Canva drew it (the single companion stacked all twelve of
          // DAHP0JQMv10's headers into its first cell's box, one per line).
          const tableCellTextRecords = hasCompanionText && isCanvaTableLayer(node) ? buildTableCellTextRecords() : [];
          if (hasCompanionText && tableCellTextRecords.length === 0) {
            const textViewportInfo = getTransformedViewportRect(textStyleElement, rect);
            if (textViewportInfo) {
              const textViewportRect = {
                x: textViewportInfo.x,
                y: textViewportInfo.y,
                width: textViewportInfo.width,
                height: textViewportInfo.height,
              };
              const textWidth = Math.max(1, Math.round(textViewportRect.width * designScaleX));
              const textHeight = Math.max(1, Math.round(textViewportRect.height * designScaleY));
              const textX = (textViewportRect.x - rect.x) * designScaleX;
              const textY = (textViewportRect.y - rect.y) * designScaleY;
              companionTextRecord = {
                id: `${String(node.id || `layer-${layerIndex + 1}`)}__text`,
                parentId: String(node.id || "").trim() || null,
                name: `${String(layerRecord.name || `Layer ${layerIndex + 1}`)} Text`,
                kind: "text",
                x: textX,
                y: textY,
                width: textWidth,
                height: textHeight,
                angle: 0,
                flipX: false,
                flipY: false,
                viewportRect: textViewportRect,
                pageRelativeRect: {
                  x: textX,
                  y: textY,
                  width: textWidth,
                  height: textHeight,
                },
                imageSrc: "",
                imageDataUrl: "",
                preferSnapshot: false,
                sourceWidth: undefined,
                sourceHeight: undefined,
                text,
                textAlign: textStyle?.textAlign || "left",
                color: textStyle?.color || "#111827",
                fontFamily: resolvedFontFamily,
                fontLacksArabic:
                  ARABIC_LETTER_PATTERN.test(String(text || ""))
                    ? fontLacksArabicGlyphs(textStyle?.fontFamily, textStyle?.fontWeight, textStyle?.fontStyle)
                    : false,
                fontLacksLatin: !ARABIC_LETTER_PATTERN.test(String(text || ""))
                  ? textFallsBackToCanvaLatin(
                      textStyle?.fontFamily,
                      resolveEffectiveFontWeight(textStyleElement, node, textStyle),
                      textStyle?.fontStyle,
                      text
                    )
                  : false,
                fontSize: resolvedFontSize,
                fontStyle: textStyle?.fontStyle || "normal",
                fontWeight: resolveEffectiveFontWeight(textStyleElement, node, textStyle),
                lineHeight: Math.max(0.8, textLineHeight || 1.2),
                letterSpacing: textLetterSpacing,
                textDecoration,
                textBackgroundColor: "",
                textBackgroundRadius: 0,
                fill: "",
                zIndex: (zIndex ?? layerIndex) + 0.25,
                opacity: effectiveOpacity,
                titleEn: "",
                tagsEn: [],
                labelsEn: [],
                fallback: false,
                fallbackReason: "",
              };
            }
          }
          // The card and trim rings a window frame was cut out of: every clipped, filled element
          // of the layer that does not hold the photo, drawn over the layer's WHOLE box as one
          // shape above the frame (the rings overlap the window's edge, the card has it cut out).
          let frameArtworkRecord = null;
          if (kind === "image" && clipWindow && viewportInfo.rawRect) {
            const fullRect = viewportInfo.rawRect;
            const fullWidth = Math.max(1, Math.round(layerFrameSize.width));
            const fullHeight = Math.max(1, Math.round(layerFrameSize.height));
            const fullX = centerDesignX - fullWidth / 2;
            const fullY = centerDesignY - fullHeight / 2;
            const artworkDataUrl = serializeClipPathArtworkToDataUrl(node, imageElement, fullWidth, fullHeight, {
              rotated: Math.abs(Number(normalizedLayerAngle) || 0) >= 0.5,
            });
            if (artworkDataUrl.startsWith("data:image/")) {
              frameArtworkRecord = {
                id: `${String(node.id || `layer-${layerIndex + 1}`)}__frame`,
                parentId: parentId || null,
                name: `${String(layerRecord.name || `Layer ${layerIndex + 1}`)} Frame`,
                kind: "image",
                x: fullX,
                y: fullY,
                width: fullWidth,
                height: fullHeight,
                angle: normalizedLayerAngle,
                flipX: false,
                flipY: false,
                viewportRect: {
                  x: fullRect.left ?? fullRect.x ?? 0,
                  y: fullRect.top ?? fullRect.y ?? 0,
                  width: fullRect.width,
                  height: fullRect.height,
                },
                pageRelativeRect: { x: fullX, y: fullY, width: fullWidth, height: fullHeight },
                imageSrc: "",
                imageDataUrl: artworkDataUrl,
                imageProvenance: "shape-svg",
                imageAcquisitionJob: null,
                preferSnapshot: false,
                snapshotIsLossyFallback: false,
                sourceWidth: fullWidth,
                sourceHeight: fullHeight,
                text: "",
                fill: "",
                zIndex: (zIndex ?? layerIndex) + 0.5,
                opacity: effectiveOpacity,
                titleEn: "",
                tagsEn: [],
                labelsEn: [],
                isBackgroundNode: false,
                isFullPageBackground: false,
                fallback: false,
                fallbackReason: "",
                hasCompanionText: false,
              };
            }
          }
          if (kind === "image") {
            imageMetadataCandidates.push({
              id: layerRecord.id,
              node,
              kind,
              name: layerRecord.name,
              width: layerRecord.width,
              height: layerRecord.height,
              fallback: layerRecord.fallback,
              isBackgroundNode,
              isFullPageBackground,
            });
          }
          if (gridCellRecords.length > 0) {
            gridCellRecords.forEach((record) => {
              if (!isDuplicateLayerEntry(record)) layers.push(record);
            });
          } else if (splitParagraphRecords.length > 0) {
            splitParagraphRecords.forEach((record) => {
              if (!isDuplicateLayerEntry(record)) layers.push(record);
            });
          } else if (!isDuplicateLayerEntry(layerRecord)) {
            layers.push(layerRecord);
          }
          if (companionTextRecord && !isDuplicateLayerEntry(companionTextRecord)) {
            layers.push(companionTextRecord);
          }
          if (frameArtworkRecord && !isDuplicateLayerEntry(frameArtworkRecord)) {
            layers.push(frameArtworkRecord);
          }
          tableCellTextRecords.forEach((record) => {
            if (!isDuplicateLayerEntry(record)) layers.push(record);
          });
        }

        // Canva stacks responsive copies of one image at identical geometry, and the full-res copy
        // often finishes loading after the placeholder (DAHOnpYP5LI: 586×800 was already decoded,
        // 1757×2400 still loading, so the 3D "8" imported soft). Give every copy a moment to load,
        // then acquire the one with the most real pixels.
        const waitForImageLoad = (element, timeoutMs = 2500) =>
          new Promise((resolve) => {
            if (!element || element.tagName !== "IMG") return resolve();
            if (element.complete && element.naturalWidth > 0) return resolve();
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              element.removeEventListener("load", finish);
              element.removeEventListener("error", finish);
              resolve();
            };
            element.addEventListener("load", finish);
            element.addEventListener("error", finish);
            setTimeout(finish, timeoutMs);
          });
        const pickLargestImageCopy = async (job) => {
          const candidates = [job.element, ...(Array.isArray(job.alternates) ? job.alternates : [])].filter(Boolean);
          if (candidates.length < 2) return job.element;
          await Promise.all(candidates.map((candidate) => waitForImageLoad(candidate)));
          const pixels = (element) => (Number(element?.naturalWidth) || 0) * (Number(element?.naturalHeight) || 0);
          return candidates.reduce((best, candidate) => (pixels(candidate) > pixels(best) ? candidate : best), candidates[0]);
        };

        // Drain deferred image acquisitions in parallel.
        const layersNeedingImages = layers.filter((layer) => layer.imageAcquisitionJob);
        await runWithConcurrency(layersNeedingImages, 6, async (layer) => {
          const job = layer.imageAcquisitionJob;
          if (!job) return;
          if (job.kind === "element") {
            const sourceElement = await pickLargestImageCopy(job);
            const acquired = await acquireImageForElement(sourceElement, job.width, job.height, {
              fitFetchedToTarget: Boolean(job.fitFetchedToTarget),
              cropRegion: job.cropRegion || null,
              quarterTurns: Number(job.quarterTurns) || 0,
              keepAnimated: Boolean(job.keepAnimated),
            });
            if (acquired.src) layer.imageSrc = acquired.src;
            if (acquired.dataUrl) layer.imageDataUrl = acquired.dataUrl;
            if (acquired.provenance) layer.imageProvenance = acquired.provenance;
            if (acquired.sourceWidth) layer.sourceWidth = acquired.sourceWidth;
            if (acquired.sourceHeight) layer.sourceHeight = acquired.sourceHeight;
            if (acquired.posterDataUrl) layer.posterDataUrl = acquired.posterDataUrl;
            if (acquired.animatedImage) layer.animatedImage = acquired.animatedImage;
            // If Canva served a background-baked version of this decoration (the page colour
            // composited into the asset), the raw asset looks wrong on its own. Drop the
            // lossy-fallback flag so background.js keeps its isolation snapshot, which
            // subtracts the page background and yields a clean cut-out. The genuine
            // full-page background is exempt — it SHOULD keep its baked colour.
            //
            // So is a model-confirmed photo FRAME (rect or circle): its asset is a plain opaque
            // rectangle by construction — the frame is applied by the editor as a corner radius —
            // and a photo with one dominant flat-ish tone (a wide sky, a studio backdrop) reads
            // as "baked" to this heuristic. Handing it to the isolation snapshot would throw away
            // the mask the frame depends on, so keep the asset. Read straight from the model:
            // layer.modelBorder isn't attached until the timeline pass further below.
            const frameBorder = (fiberModelById[String(layer.id || "")] || {}).border || null;
            const isReproducibleFrame = Boolean(
              frameBorder && (frameBorder.rectFrame || frameBorder.circleFrame)
            );
            if (
              layer.snapshotIsLossyFallback &&
              !layer.isFullPageBackground &&
              !layer.isBackgroundNode &&
              !isReproducibleFrame &&
              (await isBackgroundBakedAsset(layer.imageDataUrl))
            ) {
              layer.snapshotIsLossyFallback = false;
            }
            // MIRROR guard: a genuinely-masked layer normally keeps the isolation snapshot, but
            // the snapshot-diff BAKES semi-transparent pixels (a product cut-out's soft ground
            // shadow) against the page background — observed: a clean shoes cut-out gained an
            // opaque cream halo with the page's topography pattern in it. When the fetched asset
            // is itself a clean cut-out, flag it lossy-fallback so background.js's opaqueness
            // auto-pick chooses: it keeps the clean asset here, and still keeps the snapshot for
            // shaped masks (their rectangular asset crop has ~0% transparency → never flagged).
            if (
              !layer.snapshotIsLossyFallback &&
              layer.preferSnapshot &&
              String(layer.imageDataUrl || "").startsWith("data:image/") &&
              (await isCleanCutoutAsset(layer.imageDataUrl))
            ) {
              layer.snapshotIsLossyFallback = true;
            }
          } else if (job.kind === "url") {
            let dataUrl = "";
            if (String(job.url).startsWith("blob:")) {
              dataUrl = await blobUrlToDataUrl(job.url);
            } else if (/^https?:\/\//i.test(String(job.url))) {
              dataUrl = await readRemoteImageAssetAsDataUrl(job.url);
            }
            if (dataUrl && dataUrl.startsWith("data:image/")) {
              layer.imageSrc = dataUrl;
              layer.imageDataUrl = dataUrl;
              layer.imageProvenance =
                job.provenance || (String(job.url).startsWith("blob:") ? "blob" : "fetch");
            }
          }
        });
        for (const layer of layers) delete layer.imageAcquisitionJob;

        // ── Additive supplement: append the model's OFF-SCREEN elements ─────────────────────────
        // A timeline/video design renders only the current frame in the DOM, so the loop above
        // captured just that frame. The fiber model is a SUPERSET — append every model element not
        // already captured, built from model data (design-px geometry, animation, text content+style,
        // or a shared-media image). Static designs (model ⊆ DOM) add nothing here, so the proven DOM
        // path is untouched. Canva instances one media across many elements, so a single rendered
        // instance resolves the pixels for all off-screen instances of that media.
        try {
          const sx = Number(designScaleX) || 1;
          const sy = Number(designScaleY) || 1;
          // An element captured as paragraph / table-cell parts is captured: rebuilding it whole from
          // the model drew DAHNlFf3ad4's scene-3 paragraph a second time over its own parts.
          const capturedIds = new Set(
            layers.flatMap((l) => {
              const id = String(l.id || "");
              const base = splitPartBaseId(id);
              return base ? [id, base] : [id];
            })
          );
          const capturedByMedia = {};
          for (const l of layers) {
            const m = fiberModelById[String(l.id || "")];
            const mediaId = m && m.image && m.image.mediaId;
            if (!mediaId || capturedByMedia[mediaId]) continue;
            const url = String(l.imageSrc || "");
            const data = String(l.imageDataUrl || "");
            if ((url && /^https?:\/\//i.test(url)) || data.startsWith("data:image/")) {
              capturedByMedia[mediaId] = {
                imageSrc: /^https?:\/\//i.test(url) ? url : "",
                imageDataUrl: data.startsWith("data:image/") ? data : "",
              };
            }
          }
          // Canva font token "X,0" → CSS family "X_0" (Canva loads each design font under the
          // underscore name; the existing font-asset collector captures the loaded FontFaces).
          const fontTokenToFamily = (token) =>
            resolveCanvaFontToken(String(token || "").trim().replace(/,/g, "_"));
          const clampOpacity = (transparency) => {
            let t = Number(transparency) || 0;
            if (t > 1) t /= 100;
            return Math.max(0, Math.min(1, 1 - t));
          };

          // The element's node ON THE PAGE. Canva also draws every element into the timeline's
          // page thumbnails (DAHNZc5myOk: 50 px copies parked ~2000 design px left of the page), and
          // document.getElementById returns whichever comes first — an element off the current
          // frame then imported as a speck far off the page, or was "rendered but too small".
          const pageNodeById = (elementId) => {
            try {
              return bestPage.node.querySelector("#" + CSS.escape(String(elementId)));
            } catch (_error) {
              return null;
            }
          };

          const supplementImages = [];
          let supplementText = 0;
          let supplementLines = 0;
          let unresolvedMedia = 0;
          let unresolvedAnimated = 0;
          // Unresolved elements that DO have a rendered node: the DOM walk rejected them (size
          // gates), so "not visible at the current frame" would be the wrong diagnosis.
          let unresolvedRendered = 0;
          let backgroundPosterAdded = false;

          // ── Pattern groups ─────────────────────────────────────────────────────────────────────
          // A group made of many small pieces of image — a graph-paper grid of 238 hairlines, a dot
          // screen, confetti — is ONE visual layer. Every piece is too small for the layer walk (a
          // 2 px line at editor zoom) and its media went unresolved, so the whole grid vanished;
          // importing 238 layers instead would bury the editor. Paint the group into one
          // transparent image at design resolution: each piece's on-page box comes from its
          // rendered node (which already folds in the group's own scale), its turn, mirroring and
          // opacity from the model, its pixels from its own <img>.
          const PATTERN_MIN_PIECES = 12;
          const patternHandled = new Set();
          try {
            const childIdsByGroup = new Map();
            for (const id of Object.keys(fiberModelById)) {
              const el = fiberModelById[id];
              if (id.startsWith("__") || !el || !el.parentId) continue;
              if (!childIdsByGroup.has(el.parentId)) childIdsByGroup.set(el.parentId, []);
              childIdsByGroup.get(el.parentId).push(id);
            }
            const pieceBitmaps = new Map();
            const loadPieceBitmap = async (src) => {
              if (pieceBitmaps.has(src)) return pieceBitmaps.get(src);
              let bitmap = null;
              try {
                const dataUrl = src.startsWith("data:image/")
                  ? src
                  : src.startsWith("blob:")
                    ? await blobUrlToDataUrl(src)
                    : await readRemoteImageAssetAsDataUrl(src);
                if (String(dataUrl || "").startsWith("data:image/")) {
                  bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
                }
              } catch (_error) {
                bitmap = null;
              }
              pieceBitmaps.set(src, bitmap);
              return bitmap;
            };
            for (const [groupId, childIds] of childIdsByGroup) {
              const group = fiberModelById[groupId];
              if (!group || group.type !== "group" || capturedIds.has(groupId)) continue;
              if (childIds.length < PATTERN_MIN_PIECES || childIds.some((id) => capturedIds.has(id))) continue;
              const pieces = childIds.map((id) => ({ id, el: fiberModelById[id], node: pageNodeById(id) }));
              if (!pieces.every((piece) => piece.el && piece.el.type === "rect" && piece.el.image && piece.node)) continue;
              const groupNode = pageNodeById(groupId);
              const groupRect = groupNode ? groupNode.getBoundingClientRect() : null;
              if (!groupRect || groupRect.width < 1 || groupRect.height < 1) continue;
              const fit = Math.min(1, 2048 / Math.max(groupRect.width * sx, groupRect.height * sy));
              const pxX = sx * fit; // canvas px per screen px
              const pxY = sy * fit;
              const canvas = document.createElement("canvas");
              canvas.width = Math.max(1, Math.round(groupRect.width * pxX));
              canvas.height = Math.max(1, Math.round(groupRect.height * pxY));
              const context = canvas.getContext("2d");
              if (!context) continue;
              let painted = 0;
              let failed = false;
              for (const piece of pieces) {
                const imageNode = piece.node.querySelector("img");
                const src = imageNode ? String(imageNode.currentSrc || imageNode.src || "") : "";
                const bitmap = src ? await loadPieceBitmap(src) : null;
                if (!bitmap) {
                  failed = true;
                  break;
                }
                const box = piece.node.getBoundingClientRect();
                if (!(box.width > 0 && box.height > 0)) continue;
                const theta = (((Number(group.rotation) || 0) + (Number(piece.el.rotation) || 0)) * Math.PI) / 180;
                const w0 = Math.max(0.01, Number(piece.el.width) || 0);
                const h0 = Math.max(0.01, Number(piece.el.height) || 0);
                const cos = Math.abs(Math.cos(theta));
                const sin = Math.abs(Math.sin(theta));
                // The node's box is the turned piece's bounding box: solve the piece's own size.
                const perUnit = (box.width + box.height) / (w0 * cos + h0 * sin + w0 * sin + h0 * cos);
                const drawWidth = w0 * perUnit * pxX;
                const drawHeight = h0 * perUnit * pxY;
                const region = piece.el.image.crop
                  ? modelCropRegionForFrame(piece.el.image.crop, w0, h0)
                  : null;
                context.save();
                context.globalAlpha = clampOpacity(piece.el.transparency);
                context.translate(
                  (box.left + box.width / 2 - groupRect.left) * pxX,
                  (box.top + box.height / 2 - groupRect.top) * pxY
                );
                context.rotate(theta);
                if (piece.el.image.flipX || piece.el.image.flipY) {
                  context.scale(piece.el.image.flipX ? -1 : 1, piece.el.image.flipY ? -1 : 1);
                }
                if (region) {
                  context.drawImage(
                    bitmap,
                    region.x * bitmap.width,
                    region.y * bitmap.height,
                    region.width * bitmap.width,
                    region.height * bitmap.height,
                    -drawWidth / 2,
                    -drawHeight / 2,
                    drawWidth,
                    drawHeight
                  );
                } else {
                  context.drawImage(bitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
                }
                context.restore();
                painted += 1;
              }
              if (failed || painted === 0) continue;
              let dataUrl = "";
              try {
                dataUrl = canvas.toDataURL("image/png");
              } catch (_error) {
                dataUrl = "";
              }
              if (!dataUrl.startsWith("data:image/")) continue;
              const x = (groupRect.left - rect.x) * sx;
              const y = (groupRect.top - rect.y) * sy;
              const width = Math.max(1, Math.round(groupRect.width * sx));
              const height = Math.max(1, Math.round(groupRect.height * sy));
              layers.push({
                id: groupId,
                parentId: null,
                name: `Pattern (${pieces.length} pieces)`,
                kind: "image",
                x,
                y,
                width,
                height,
                angle: 0,
                domGeometry: true,
                flipX: false,
                flipY: false,
                viewportRect: { x: groupRect.left, y: groupRect.top, width: groupRect.width, height: groupRect.height },
                pageRelativeRect: { x, y, width, height },
                // The model z-order pass puts it back at the group's own depth.
                zIndex: 1000 + supplementText + supplementImages.length,
                opacity: clampOpacity(group.transparency),
                imageSrc: dataUrl,
                imageDataUrl: dataUrl,
                imageProvenance: "model-pattern-composite",
                preferSnapshot: false,
                sourceWidth: canvas.width,
                sourceHeight: canvas.height,
                text: "",
                textAlign: "left",
                color: "#111827",
                fontFamily: "",
                fontSize: 0,
                fontStyle: "normal",
                fontWeight: 400,
                lineHeight: 1.2,
                letterSpacing: 0,
                textDecoration: "none",
                textBackgroundColor: "",
                textBackgroundRadius: 0,
                fill: "",
                titleEn: "",
                tagsEn: [],
                labelsEn: [],
                isBackgroundNode: false,
                isFullPageBackground: false,
                fallback: false,
                fallbackReason: "",
                hasCompanionText: false,
                fromModel: true,
              });
              patternHandled.add(groupId);
              pieces.forEach((piece) => patternHandled.add(piece.id));
            }
          } catch (patternError) {
            console.warn("[canva-scraper] pattern group composite failed:", patternError);
          }

          for (const id of Object.keys(fiberModelById)) {
            if (id.startsWith("__")) continue; // meta entries (e.g. __background), not elements
            if (capturedIds.has(id) || patternHandled.has(id)) continue;
            const el = fiberModelById[id];
            if (!el || !el.type) continue;
            // The model's left/top/width/height are LOCAL to the element's GROUP. For a top-level
            // element that IS page space, but for a nested one it isn't remotely: a bullet-list
            // divider whose group rotates it 90° reads (-35,55) 93x2 in the model while actually
            // rendering at (1029,956) 3x93 — so it imported as a horizontal bar parked at the page
            // origin. When the element still has a DOM node, take its real page-space rect; the
            // model box is only trustworthy for top-level elements and for genuinely off-screen
            // timeline elements, which have no node at all.
            // Caveat: the DOM rect is an AABB, so a DIAGONAL line supplemented this way comes in as
            // its bounding box. Axis-aligned dividers (the case this path exists for) are exact.
            const domNode = pageNodeById(id);
            const domRect = domNode ? domNode.getBoundingClientRect() : null;
            const useDomRect = supplementUsesDomRect({
              hasDomRect: Boolean(domRect && domRect.width > 0.5 && domRect.height > 0.5),
              nestedInGroup: Boolean(domNode?.parentElement?.closest?.('[id^="LB"]')),
              // A `line` is drawn already resolved into its axis-aligned DOM box (no transform on
              // the node), so its model rotation must not be re-applied.
              rotation: el.type === "line" ? 0 : Number(el.rotation) || 0,
              modelWidth: Number(el.width) || 0,
              modelHeight: Number(el.height) || 0,
            });
            const w = Math.max(1, Math.round(useDomRect ? domRect.width * sx : el.width));
            const h = Math.max(1, Math.round(useDomRect ? domRect.height * sy : el.height));
            // A hairline divider is legitimately 1px tall — don't drop lines on the thin-axis gate.
            if (w <= 1 || (h <= 1 && el.type !== "line")) continue;
            // Model-only elements are placed through their groups (a top-level one is unchanged).
            const modelFrame = useDomRect ? null : modelElementPageFrame(el, fiberModelById);
            const x = useDomRect ? (domRect.left - rect.x) * sx : modelFrame.x;
            const y = useDomRect ? (domRect.top - rect.y) * sy : modelFrame.y;
            const base = {
              id,
              parentId: null,
              x,
              y,
              width: w,
              height: h,
              // A DOM-derived box is an axis-aligned bounding box — the rendered orientation is
              // already baked into it, so re-applying the model's rotation would turn it twice.
              // Model-only elements (no node) still need their own angle (plus their groups').
              angle: useDomRect ? 0 : modelFrame.angle,
              // Tells the later model-authoritative passes to leave this layer's rotation alone
              // (see the `!layer.domGeometry` guard); the box already encodes the orientation.
              domGeometry: useDomRect,
              flipX: false,
              flipY: false,
              viewportRect: { x: rect.x + x / sx, y: rect.y + y / sy, width: w / sx, height: h / sy },
              pageRelativeRect: { x, y, width: w, height: h },
              zIndex: 1000 + supplementText + supplementImages.length,
              opacity: clampOpacity(el.transparency),
              fallback: false,
              fallbackReason: "",
              hasCompanionText: false,
              fromModel: true,
              ...(el.animation ? { animation: el.animation } : {}),
            };
            if (el.type === "text" && el.text && String(el.text.plaintext || "").trim()) {
              const t = el.text;
              const plainText = String(t.plaintext).replace(/[\r\n]+$/, "");
              layers.push({
                ...base,
                name: plainText.trim().slice(0, 40) || `Text ${supplementText + 1}`,
                kind: "text",
                imageSrc: "",
                imageDataUrl: "",
                preferSnapshot: false,
                sourceWidth: undefined,
                sourceHeight: undefined,
                text: plainText,
                textAlign: t.textAlign || "center",
                color: t.color || "#111827",
                fontFamily: fontTokenToFamily(t.fontFamilyToken) || "sans-serif",
                // The model's font size is the text at scale 1; a scaled text box draws it at
                // width / layout width (DAHNZVrSYZM's «عروسـ» 70.16 → 100.65, «في بيتنا» → 62.47).
                fontSize: (() => {
                  const layoutScale =
                    Number(el.layoutWidth) > 0 && Number(el.width) > 0 ? Number(el.width) / Number(el.layoutWidth) : 1;
                  const size = pickModelTextFontSize({
                    fontSize: t.fontSize,
                    fontSizes: t.fontSizes,
                    boxHeight: el.height,
                    scale: layoutScale,
                    text: plainText,
                  });
                  return size > 0 ? size * layoutScale : Math.max(12, Math.round(h * 0.6));
                })(),
                fontStyle: "normal",
                fontWeight: 400,
                lineHeight: 1.2,
                letterSpacing: 0,
                textDecoration: "none",
                textBackgroundColor: "",
                textBackgroundRadius: 0,
                fill: "",
                titleEn: "",
                tagsEn: [],
                labelsEn: [],
                isBackgroundNode: false,
                isFullPageBackground: false,
              });
              supplementText += 1;
            } else if (el.type === "rect" && el.image && el.image.mediaId) {
              const captured = capturedByMedia[el.image.mediaId];
              if (!captured || (!captured.imageSrc && !captured.imageDataUrl)) {
                unresolvedMedia += 1;
                if (domNode) unresolvedRendered += 1;
                if (el.animation && (el.animation.motionPath || el.animation.mode)) {
                  unresolvedAnimated += 1;
                }
                continue;
              }
              const record = {
                ...base,
                name: `Image ${supplementImages.length + 1}`,
                kind: "image",
                flipX: Boolean(el.image.flipX),
                flipY: Boolean(el.image.flipY),
                imageSrc: captured.imageSrc || captured.imageDataUrl,
                imageDataUrl: captured.imageDataUrl || "",
                imageProvenance: "model-shared-media",
                preferSnapshot: false,
                sourceWidth: undefined,
                sourceHeight: undefined,
                // model in-frame crop (fill.sb); applied downstream in a later pass, kept so the
                // per-instance framing isn't lost when one media is reused across many elements.
                sourceCrop: el.image.crop || null,
                text: "",
                textAlign: "left",
                color: "#111827",
                fontFamily: "",
                fontSize: 0,
                fontStyle: "normal",
                fontWeight: 400,
                lineHeight: 1.2,
                letterSpacing: 0,
                textDecoration: "none",
                textBackgroundColor: "",
                textBackgroundRadius: 0,
                fill: "",
                titleEn: "",
                tagsEn: [],
                labelsEn: [],
                isBackgroundNode: false,
                isFullPageBackground: false,
              };
              layers.push(record);
              supplementImages.push(record);
            } else if (el.type === "line" && el.line && el.line.color) {
              // A dashed, arrowed or bent line keeps its own SVG as a vector image: a solid rect
              // could only ever draw a straight bar.
              const lineSvg = domNode ? domNode.querySelector("svg") : null;
              const linePaths = lineSvg
                ? Array.from(lineSvg.querySelectorAll("path"))
                    .filter((path) => Number(window.getComputedStyle(path).opacity) > 0.01)
                    .map((path) => {
                      const style = window.getComputedStyle(path);
                      const dash = String(style.strokeDasharray || "").trim().toLowerCase();
                      return {
                        dashed: Boolean(dash) && dash !== "none" && dash !== "0" && dash !== "0px",
                        filled: !isTransparentColor(String(style.fill || "")) && String(style.fill || "") !== "none",
                        d: String(path.getAttribute("d") || ""),
                      };
                    })
                : [];
              // The arrowhead and half the stroke reach past the element box, and a `0 0 w h` viewBox
              // would clip them: draw the paths' own bounds (plus the stroke) and grow the box to it.
              const lineVector =
                lineSvg && useDomRect && lineNeedsVector(linePaths) ? serializeLineSvgToDataUrl(lineSvg, x, y, w, h) : null;
              if (lineVector && lineVector.dataUrl.startsWith("data:image/")) {
                const record = {
                  ...base,
                  x: lineVector.x,
                  y: lineVector.y,
                  width: lineVector.width,
                  height: lineVector.height,
                  pageRelativeRect: { x: lineVector.x, y: lineVector.y, width: lineVector.width, height: lineVector.height },
                  name: `Line ${supplementLines + 1}`,
                  kind: "image",
                  imageSrc: lineVector.dataUrl,
                  imageDataUrl: lineVector.dataUrl,
                  imageProvenance: "shape-svg",
                  preferSnapshot: false,
                  sourceWidth: undefined,
                  sourceHeight: undefined,
                  text: "",
                  textAlign: "left",
                  color: "#111827",
                  fontFamily: "",
                  fontSize: 0,
                  fontStyle: "normal",
                  fontWeight: 400,
                  lineHeight: 1.2,
                  letterSpacing: 0,
                  textDecoration: "none",
                  textBackgroundColor: "",
                  textBackgroundRadius: 0,
                  fill: "",
                  titleEn: "",
                  tagsEn: [],
                  labelsEn: [],
                  isBackgroundNode: false,
                  isFullPageBackground: false,
                };
                layers.push(record);
                supplementImages.push(record);
                supplementLines += 1;
                continue;
              }
              // Recover a divider LINE the DOM thin-vector gate dropped. Emit it as a thin solid
              // rect through the editable-shape path (background.js turns modelShape {shapeKind:
              // "rect"} into a fill:color rect). `base` already carries the model geometry — for a
              // line that's length × weight in the element's own frame, plus its rotation.
              layers.push({
                ...base,
                name: `Line ${supplementLines + 1}`,
                kind: "shape",
                modelShape: { shapeKind: "rect", fillColor: el.line.color },
                imageSrc: "",
                imageDataUrl: "",
                preferSnapshot: false,
                sourceWidth: undefined,
                sourceHeight: undefined,
                text: "",
                textAlign: "left",
                color: "#111827",
                fontFamily: "",
                fontSize: 0,
                fontStyle: "normal",
                fontWeight: 400,
                lineHeight: 1.2,
                letterSpacing: 0,
                textDecoration: "none",
                textBackgroundColor: "",
                textBackgroundRadius: 0,
                fill: el.line.color,
                titleEn: "",
                tagsEn: [],
                labelsEn: [],
                isBackgroundNode: false,
                isFullPageBackground: false,
              });
              supplementLines += 1;
            }
          }

          // Fetch full-media bytes for shared-media images that only resolved to a URL, so the
          // template is self-contained (survives multipart transport like the DOM-captured layers).
          const needBytes = supplementImages.filter(
            (l) => !String(l.imageDataUrl || "").startsWith("data:image/") && /^https?:\/\//i.test(String(l.imageSrc || ""))
          );
          if (needBytes.length) {
            await runWithConcurrency(needBytes, 6, async (layer) => {
              try {
                const dataUrl = await readRemoteImageAssetAsDataUrl(layer.imageSrc);
                if (dataUrl && dataUrl.startsWith("data:image/")) layer.imageDataUrl = dataUrl;
              } catch (_e) {
                /* keep the URL as a fallback */
              }
            });
          }

          // Per-instance crop: when the model's fill.sb (media draw rect in element-frame coords)
          // differs from the frame, the element shows a SLICE of the media, not all of it — crop the
          // shared media to the visible region so reused media renders each instance's own slice.
          // Most instanced decorations have sb == frame (full image, no crop) and skip untouched.
          await runWithConcurrency(supplementImages, 4, async (layer) => {
            const crop = layer.sourceCrop;
            const frameW = Number(layer.width) || 0;
            const frameH = Number(layer.height) || 0;
            const region = modelCropRegionForFrame(crop, frameW, frameH);
            if (!region) return;
            const dataUrl = String(layer.imageDataUrl || "");
            if (!dataUrl.startsWith("data:image/")) return;
            const visX = Math.max(0, crop.left);
            const visY = Math.max(0, crop.top);
            const visRight = Math.min(frameW, crop.left + crop.width);
            const visBottom = Math.min(frameH, crop.top + crop.height);
            try {
              const cropped = await fitDataUrlToDisplayedBox(
                dataUrl,
                Math.max(1, Math.round(visRight - visX)),
                Math.max(1, Math.round(visBottom - visY)),
                region
              );
              if (cropped?.dataUrl && cropped.dataUrl.startsWith("data:image/")) {
                layer.imageDataUrl = cropped.dataUrl;
                layer.imageSrc = cropped.dataUrl;
                layer.imageProvenance = "model-shared-media-crop";
                layer.sourceWidth = cropped.width;
                layer.sourceHeight = cropped.height;
              }
            } catch (_cropError) {
              /* keep the uncropped media */
            }
          });

          // ── Page background VIDEO → static poster-frame layer ─────────────────────────────────
          // Canva video files are signed/protected, but the poster JPG is public and its URL was
          // harvested from resource timing (background.js __background extraction). Import it as a
          // bottom-most full-canvas image with the clip's own transparency so the wash matches
          // Canva; all 6 scenes reuse one video here, so a single poster spans the whole timeline.
          try {
            const bg = fiberModelById.__background;
            const firstVideoClip =
              bg && Array.isArray(bg.clips) ? bg.clips.find((c) => c && c.video) : null;
            const posterUrl =
              firstVideoClip && firstVideoClip.video && bg.posters
                ? bg.posters[firstVideoClip.video.videoId] || ""
                : "";
            if (posterUrl) {
              const posterDataUrl = await readRemoteImageAssetAsDataUrl(posterUrl);
              if (posterDataUrl && posterDataUrl.startsWith("data:image/")) {
                const pageW = Math.max(1, Math.round(Number(designWidth || rect.width)));
                const pageH = Math.max(1, Math.round(Number(designHeight || rect.height)));
                const rb = firstVideoClip.video.rb;
                let finalDataUrl = posterDataUrl;
                // A rotated rect (clip turned 90° for a portrait page) has no axis-aligned
                // page-visible region to crop to; keep the full poster and let the aspect check decide.
                if (rb && rb.width > 0 && rb.height > 0 && Math.abs(Number(rb.rotation) || 0) <= 0.5) {
                  // the clip covers the page from a larger video rect — crop the poster to the
                  // page-visible region so the framing matches
                  const region = {
                    x: Math.max(0, Math.min(1, (0 - rb.left) / rb.width)),
                    y: Math.max(0, Math.min(1, (0 - rb.top) / rb.height)),
                    width: Math.max(0.01, Math.min(1, pageW / rb.width)),
                    height: Math.max(0.01, Math.min(1, pageH / rb.height)),
                  };
                  try {
                    const fitted = await fitDataUrlToDisplayedBox(posterDataUrl, pageW, pageH, region);
                    if (fitted?.dataUrl) finalDataUrl = fitted.dataUrl;
                  } catch (_fitError) {
                    /* keep the full poster */
                  }
                }
                const totalMs = (bg.clips || []).reduce((a, c) => a + (Number(c.durationMs) || 0), 0);
                layers.push({
                  id: "model-background-video-poster",
                  parentId: null,
                  name: "Background video (poster frame)",
                  kind: "image",
                  x: 0,
                  y: 0,
                  width: pageW,
                  height: pageH,
                  angle: 0,
                  flipX: false,
                  flipY: false,
                  viewportRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                  pageRelativeRect: { x: 0, y: 0, width: pageW, height: pageH },
                  imageSrc: finalDataUrl,
                  imageDataUrl: finalDataUrl,
                  imageProvenance: "background-video-poster",
                  preferSnapshot: false,
                  sourceWidth: undefined,
                  sourceHeight: undefined,
                  text: "",
                  textAlign: "left",
                  color: "#111827",
                  fontFamily: "",
                  fontSize: 0,
                  fontStyle: "normal",
                  fontWeight: 400,
                  lineHeight: 1.2,
                  letterSpacing: 0,
                  textDecoration: "none",
                  textBackgroundColor: "",
                  textBackgroundRadius: 0,
                  fill: "",
                  zIndex: -10,
                  opacity: Math.max(
                    0.05,
                    Math.min(1, 1 - (Number(firstVideoClip.video.transparency) || 0))
                  ),
                  titleEn: "",
                  tagsEn: [],
                  labelsEn: [],
                  isBackgroundNode: true,
                  isFullPageBackground: true,
                  fallback: true,
                  fallbackReason: "background-video-poster",
                  fromModel: true,
                  ...(totalMs > 0 ? { timelineStartMs: 0, timelineEndMs: totalMs } : {}),
                });
                backgroundPosterAdded = true;
                // The DOM path already captured this clip's poster <img> as a non-LB full-page
                // background layer. With the model poster (and, downstream, the real video) in
                // place it would sit ABOVE them and hide the video — drop it. A page fill is
                // either a video or an image, never both, so any non-LB full-page background
                // node on a video page is that video's own rendering.
                for (let dupIndex = layers.length - 1; dupIndex >= 0; dupIndex -= 1) {
                  const dup = layers[dupIndex];
                  if (
                    dup &&
                    dup.isBackgroundNode &&
                    dup.isFullPageBackground &&
                    !/^LB/.test(String(dup.id || "")) &&
                    dup.id !== "model-background-video-poster"
                  ) {
                    layers.splice(dupIndex, 1);
                  }
                }
              }
            }
          } catch (_bgPosterError) {
            /* best-effort */
          }

          if (supplementText || supplementImages.length || unresolvedMedia || backgroundPosterAdded) {
            console.log(
              `[canva-scraper] timeline supplement: +${supplementText} text, +${supplementImages.length} image (off-screen model layers); ${unresolvedMedia} media unresolved; bgPoster=${backgroundPosterAdded}`
            );
          }
          timelineSupplementSummary = {
            addedText: supplementText,
            addedImages: supplementImages.length,
            unresolvedMedia,
            unresolvedAnimated,
            unresolvedRendered,
            backgroundVideoPoster: backgroundPosterAdded,
          };
        } catch (supplementError) {
          console.warn("[canva-scraper] timeline supplement failed:", supplementError);
        }

        // ── Timeline positioning ────────────────────────────────────────────────────────────────
        // Map each layer's model timing (startUs/durationUs) → the editor's per-element timeline
        // window (timelineStartMs/EndMs). Without this, a timeline/video design's elements — which
        // Canva SEQUENCES over the timeline (text flies in one after another) — all render at t=0 in
        // the editor and pile into an unreadable stack. Layers with no model timing (or 0 duration)
        // keep the editor's defaults (full page). The page duration is derived editor-side from the
        // max end so it stretches to fit (a 44s video shows 0:44, not the 15s default).
        try {
          // Canva gives EVERY element a start and a duration even on a STATIC design — its pages
          // are nominally 5s — so stamping those windows unconditionally made every import look
          // like a timeline design: the editor counts a layer whose window is shorter than the
          // page as animated, and a 5s window inside the 15s default page is exactly that (plus
          // any leftover per-element offset the template author never meant as animation). Carry
          // the timing only when the design really moves: a background video track, or at least
          // one element with a real animation (extractAnimation returns null for Canva's empty
          // {type} placeholders, so a non-null animation means an actual preset/motion path).
          const designHasMotion =
            Boolean(fiberModelById.__background) ||
            Boolean(fiberModelById.__pageAnimation) ||
            Object.keys(fiberModelById).some(
              (key) =>
                !key.startsWith("__") && Boolean(fiberModelById[key] && fiberModelById[key].animation)
            );
          // WHEN each element animates is Canva's scheduler's call, ported in background.js
          // (applyCanvaPageAnimations, docs/canva-animation-parity.md §8.5): it runs over the whole
          // page model — "Animate page" included, whose preset reaches every element that has no
          // animation of its own — once the page's objects are built. Nothing is synthesized here.
          // Page facts for background.js's one-record fallback (used only when the page scheduler
          // cannot run): the design size (the model's own, else the DOM's) and Canva's page length.
          const animationPageWidth = Math.max(
            1,
            Math.round(Number(fiberModelById.__pageWidth) || Number(designWidth || rect.width) || 1080)
          );
          const animationPageHeight = Math.max(
            1,
            Math.round(Number(fiberModelById.__pageHeight) || Number(designHeight || rect.height) || 1920)
          );
          const animationPageDurationMs =
            Number(fiberModelById.__pageDurationMs) > 0 ? Number(fiberModelById.__pageDurationMs) : 5000;
          // Windows are only worth carrying when they SEQUENCE something. Canva hands every element
          // the same default window (0 → the page's nominal 5s), and stamping that into our longer
          // default page would make the whole design vanish partway through. So stamp only when the
          // layers actually differ from one another.
          // ── canva-model-window:start ──────────────────────────────────────────────────────────
          // A group child's model timing is LOCAL to its group, exactly like its left/top (Canva's
          // Fbb, ported for the scheduler in background.js canvaElementTiming): a flower cluster
          // grouped on the 10→20 s scene stores startUs 0 / durationUs 10.4 s, and stamping that raw
          // put all three scenes' copies of the cluster on scene 1 (DAHNlB6Y2KI: the hanging flowers
          // vanished from scenes 2 and 3 while scene 1 stacked three). Walk the group chain: each
          // ancestor's start shifts the window, and a child never outlives its group.
          const resolveModelWindowMs = (model, modelById) => {
            if (!model) return null;
            let startUs = Number(model.startUs) || 0;
            let durationUs = Number(model.durationUs) > 0 ? Number(model.durationUs) : Infinity;
            let parent = model.parentId && modelById ? modelById[String(model.parentId)] : null;
            let hops = 0;
            while (parent && hops < 8) {
              const parentStartUs = Number(parent.startUs) || 0;
              const parentDurationUs = Number(parent.durationUs) > 0 ? Number(parent.durationUs) : Infinity;
              // The child's own window, clipped to the room its group leaves after the child's start.
              durationUs = Math.min(durationUs, parentDurationUs - startUs);
              startUs += parentStartUs;
              parent = parent.parentId ? modelById[String(parent.parentId)] : null;
              hops += 1;
            }
            if (!Number.isFinite(durationUs) || durationUs <= 0) return null;
            const startMs = Math.max(0, Math.round(startUs / 1000));
            const durMs = Math.round(durationUs / 1000);
            return durMs > 0 ? { startMs, durMs } : null;
          };
          // ── canva-model-window:end ────────────────────────────────────────────────────────────
          // A paragraph / table-cell part (`<id>__p1`, `<id>__cell1`) replaces its element, so it
          // shows when the element does — its window is the element's (the model has no part).
          const windowModelOf = (layer) => {
            const id = String((layer && layer.id) || "");
            return fiberModelById[id] || fiberModelById[splitPartBaseId(id)] || null;
          };
          const windowSignatures = new Set();
          for (const layer of layers) {
            const model = windowModelOf(layer);
            const window = resolveModelWindowMs(model, fiberModelById);
            windowSignatures.add(window ? `${window.startMs}:${window.durMs}` : "none");
          }
          const windowsAreSequenced = windowSignatures.size > 1;
          // The one-record fallback reads the page and the element's own geometry / raw timing
          // (undefined stays undefined) off the record.
          for (const layer of layers) {
            if (!layer || !layer.animation || typeof layer.animation !== "object") continue;
            const model = fiberModelById[String((layer && layer.id) || "")];
            Object.assign(layer.animation, {
              pageWidth: animationPageWidth,
              pageHeight: animationPageHeight,
              pageDurationMs: animationPageDurationMs,
              ...(model
                ? {
                    elementTop: Number(model.top) || 0,
                    elementLeft: Number(model.left) || 0,
                    elementWidth: Number(model.width) || 0,
                    elementHeight: Number(model.height) || 0,
                    elementRotation: Number(model.rotation) || 0,
                    ...(Number.isFinite(model.startUs) ? { startUs: model.startUs } : {}),
                    ...(Number.isFinite(model.durationUs) ? { durationUs: model.durationUs } : {}),
                  }
                : {}),
            });
          }
          for (const layer of layers) {
            const model = fiberModelById[String((layer && layer.id) || "")];
            if (!model) {
              // A part takes its element's window and nothing else (text, shape and frame belong to
              // the whole element).
              const partWindow = resolveModelWindowMs(windowModelOf(layer), fiberModelById);
              if (designHasMotion && windowsAreSequenced && partWindow) {
                layer.timelineStartMs = partWindow.startMs;
                layer.timelineEndMs = partWindow.startMs + partWindow.durMs;
              }
              continue;
            }
            const modelWindow = resolveModelWindowMs(model, fiberModelById);
            if (designHasMotion && windowsAreSequenced && modelWindow) {
              layer.timelineStartMs = modelWindow.startMs;
              layer.timelineEndMs = modelWindow.startMs + modelWindow.durMs;
            }
            // Carry the model's simple-shape classification so background.js can emit an editable
            // circle/rect instead of the DOM's protected raster (which snapshot-crops with a
            // baked-in background).
            if (model.shape) layer.modelShape = model.shape;
            // Canva photo-frame outline: the shape clips the captured photo AND draws a stroke.
            // Carry it so the emitted IMAGE object gets the border (matches Canva's framed photos).
            if (model.border) layer.modelBorder = model.border;
            // Model-rebuilt VECTOR for shapes with no editable equivalent (arches, blobs, badges,
            // gradient fills). Canva renders these as protected rasters, so every capture path can
            // only screenshot-crop them — and a crop has no alpha, so the silhouette is lost and
            // the page bakes into everything outside the path. The rebuilt SVG is the clean
            // source, so also keep the layer OUT of the snapshot/isolation branches (each of them
            // overwrites the src with captured pixels).
            if (model.vector && typeof model.vector.svg === "string" && model.vector.svg) {
              layer.modelVectorSvg = model.vector.svg;
              layer.preferSnapshot = false;
              layer.snapshotIsLossyFallback = true;
            }
            // Drop shadow (any layer type). The DOM capture can't carry one: a shadow is painted
            // OUTSIDE the layer's own box, so it either falls outside the crop entirely or, on the
            // isolation path, gets diffed away with the background. The model has it exactly.
            if (model.shadow) layer.modelShadow = model.shadow;
            // ── Model-authoritative TEXT content ──────────────────────────────────────────────
            // The DOM read loses line breaks when Canva renders a multi-line text without per-line
            // <p> nodes — a narrow price column "$5\n$5\n$5\n$5" imported as "$5$5$5$5". The model's
            // stream plaintext carries the exact \n's, so prefer it whenever it's plainly the SAME
            // content (identical after stripping all whitespace); never clobber a genuinely
            // different capture.
            if (
              String(layer.kind || "") === "text" &&
              model.text &&
              typeof model.text.plaintext === "string" &&
              model.text.plaintext.trim()
            ) {
              const modelText = model.text.plaintext.replace(/[\r\n]+$/, "");
              const stripWs = (s) => String(s || "").replace(/\s+/g, "");
              const sameContent = stripWs(modelText) === stripWs(layer.text);
              if (sameContent && modelText !== layer.text) {
                layer.text = modelText;
              }
              // Canva-laid wraps the page couldn't classify: the model's whitespace decides them.
              if (layer.textWrapRange?.pending) {
                layer.textWrapRange = sameContent
                  ? resolveCanvaLaidWrapRange(layer.textWrapRange.pending, modelText)
                  : null;
              }
            }
            // ── Model-authoritative ROTATION (+ frame geometry for rotated layers) ────────────
            // The DOM transform read is unreliable — it missed a -15.3° ice-cream (imported upright
            // at 0°) while its +14.7° twin was detected. The capture pipeline fetches the UN-rotated
            // asset (verified: both ice-cream assets are upright PNGs), so the model angle applies
            // directly without double-rotating. For a ROTATED element the DOM also measures the
            // rotated AABB (79×151 element captured as 115×167 → rendered ~45% oversized once the
            // angle is applied), so take the model's whole frame. And force the DIRECT asset path:
            // every snapshot branch in the hybrid builder spreads angle:0 (correct for true screen
            // crops, wrong for upright assets) — preferSnapshot=false keeps rotated layers out of
            // all of them (also out of the isolation pass, so no angle-0 isolation object either).
            // NOT for a layer whose box came from the DOM: that box is an axis-aligned bounding
            // box with the rendered orientation already baked in, so applying the model's
            // rotation on top turns it twice — a divider measured 3x93 (already vertical) was
            // being rotated 90° back to horizontal, straight through the text beside it.
            if (Number.isFinite(Number(model.rotation)) && !layer.domGeometry) {
              layer.angle = Number(model.rotation);
            }
            const modelRotationAbs = Math.abs(Number(model.rotation) || 0);
            // The model box is LOCAL to the element's group, so a nested element's left/top are
            // only page space once every ancestor group's own offset is added. Taking them raw put
            // a Kaaba cropped inside a group at (209, 901) down at the page ORIGIN — the whole
            // composition it anchored fell apart around it. A rotated ancestor would rotate that
            // offset too, so the override is skipped there and the DOM box stays.
            const modelPageOffset = (() => {
              let dx = 0;
              let dy = 0;
              let hops = 0;
              let parent = model.parentId ? fiberModelById[String(model.parentId)] : null;
              while (parent && hops < 8) {
                if (Math.abs(Number(parent.rotation) || 0) > 0.5) return null;
                dx += Number(parent.left) || 0;
                dy += Number(parent.top) || 0;
                parent = parent.parentId ? fiberModelById[String(parent.parentId)] : null;
                hops += 1;
              }
              return { dx, dy };
            })();
            if (
              modelRotationAbs > 0.5 &&
              // Same reason as the rotation guard above: a DOM-derived box is already correct in
              // page space, while model.left/top/width/height are LOCAL to the element's group.
              !layer.domGeometry &&
              modelPageOffset &&
              String(layer.kind || "") === "image" &&
              Number(model.width) >= 2 &&
              Number(model.height) >= 2
            ) {
              layer.x = (Number(model.left) || 0) + modelPageOffset.dx;
              layer.y = (Number(model.top) || 0) + modelPageOffset.dy;
              layer.width = Math.max(1, Math.round(Number(model.width)));
              layer.height = Math.max(1, Math.round(Number(model.height)));
              layer.pageRelativeRect = {
                x: layer.x,
                y: layer.y,
                width: layer.width,
                height: layer.height,
              };
              layer.preferSnapshot = false;
              layer.snapshotIsLossyFallback = true;
            }
          }
        } catch (timelineError) {
          console.warn("[canva-scraper] timeline positioning failed:", timelineError);
        }

        // ── Model-authoritative z-order ─────────────────────────────────────────────────────────
        // Canva's element array order IS the paint order (index 0 = bottom). The DOM scan order only
        // approximates it, and any model-recovered element (e.g. a divider line) would otherwise land
        // at the END of the array — painted on top of everything. Re-stack every layer by the model's
        // EXPLICIT zOrder stamp — NOT Object.keys() order, which arrives ALPHABETICALLY sorted after
        // the executeScript arg-serialization boundary (observed: a whole design re-stacked by id).
        // Layers with no model entry keep their place: the full-page background sinks to the bottom;
        // any other DOM-only companion inherits the order of the nearest preceding model layer so it
        // stays beside its neighbour. Stable on ties. Skips cleanly when the model has no zOrder
        // stamps (older canva-fiber-main.js) — DOM order is better than alphabetical order.
        try {
          const hasZOrderStamps = Object.keys(fiberModelById).some(
            (modelId) =>
              !modelId.startsWith("__") && Number.isFinite(Number(fiberModelById[modelId]?.zOrder))
          );
          if (hasZOrderStamps) {
            let lastZ = -1;
            layers.forEach((layer, i) => {
              const model = fiberModelById[String((layer && layer.id) || "")];
              const mo = model ? Number(model.zOrder) : NaN;
              if (Number.isFinite(mo)) {
                layer.__zkey = mo;
                lastZ = mo;
              } else if (layer && (layer.isFullPageBackground || layer.isBackgroundNode)) {
                layer.__zkey = -1;
              } else {
                layer.__zkey = lastZ + 0.001; // just above the last model layer; keeps DOM adjacency
              }
              layer.__zi = i;
            });
            layers.sort((a, b) => a.__zkey - b.__zkey || a.__zi - b.__zi);
            for (const layer of layers) {
              delete layer.__zkey;
              delete layer.__zi;
            }
          }
        } catch (zorderError) {
          console.warn("[canva-scraper] z-order sort failed:", zorderError);
        }

        // ── Protected / blob image src → bytes (client-side, LAST safety net) ───────────────────
        // The SERVER re-hosts each image by fetching its URL, but it has NO Canva session — so
        // protected srcs (media.canva.com/v2, ifs://, signed premium/upload URLs) return 403 and
        // blob: URLs are unreachable entirely. Either one trips a full flattened-snapshot fallback
        // (the WHOLE design collapses to one image). These srcs ARE fetchable IN-PAGE (live session
        // + live blobs — verified), so convert any that the server can't fetch into data URLs here,
        // before the payload leaves the page. Public CDN srcs (media-public/video-public.canva.com,
        // our R2) are left as URLs — the server fetches those fine, and keeping them URLs avoids
        // bloating the payload. Whatever still can't be converted falls back to the server's
        // per-layer snapshot crop (not a full-design snapshot).
        try {
          const serverCanFetchSrc = (url) =>
            /^https?:\/\/(?:[a-z0-9-]+\.)*(?:media-public|video-public)\.canva\.com\//i.test(url) ||
            /^https?:\/\/pub-[a-z0-9]+\.r2\.dev\//i.test(url);
          // Any kind — a shape/graphic can carry a protected src too; the server sanitizes .src
          // regardless of type. Text layers have an empty src and are filtered out below.
          const needsInPageBytes = layers.filter((layer) => {
            if (String(layer.imageDataUrl || "").startsWith("data:image/")) return false;
            const src = String(layer.imageSrc || "");
            if (!src || src.startsWith("data:")) return false;
            if (src.startsWith("blob:")) return true;
            if (/^https?:\/\//i.test(src)) return !serverCanFetchSrc(src);
            return false;
          });
          if (needsInPageBytes.length) {
            await runWithConcurrency(needsInPageBytes, 6, async (layer) => {
              const src = String(layer.imageSrc || "");
              let dataUrl = "";
              try {
                dataUrl = src.startsWith("blob:")
                  ? await blobUrlToDataUrl(src)
                  : await readRemoteImageAssetAsDataUrl(src);
              } catch (_e) {
                /* leave the URL; server falls back to a per-layer snapshot crop */
              }
              if (dataUrl && dataUrl.startsWith("data:image/")) {
                layer.imageSrc = dataUrl;
                layer.imageDataUrl = dataUrl;
                layer.imageProvenance =
                  layer.imageProvenance ||
                  (src.startsWith("blob:") ? "blob-normalized" : "fetch-normalized");
              }
            });
            console.log(
              `[canva-scraper] normalized ${needsInPageBytes.length} protected/blob image src(s) to in-page bytes`
            );
          }
        } catch (normalizeError) {
          console.warn("[canva-scraper] protected-src normalization failed:", normalizeError);
        }

        const imageMetadataById = shouldCollectLayerMetadata
          ? await collectCanvaLayerMetadata(
              imageMetadataCandidates,
              Number(designWidth || rect.width),
              Number(designHeight || rect.height)
            )
          : new Map();
        if (imageMetadataById.size > 0) {
          for (let index = 0; index < layers.length; index += 1) {
            const layer = layers[index];
            if (String(layer?.kind || "").toLowerCase() !== "image") continue;
            const metadata = imageMetadataById.get(String(layer.id || ""));
            if (!metadata) continue;
            layer.titleEn = sanitizeMetadataText(metadata.titleEn || layer.name || "");
            layer.tagsEn = uniqueMetadataStrings(metadata.tagsEn);
            layer.labelsEn = uniqueMetadataStrings(
              metadata.labelsEn && metadata.labelsEn.length > 0
                ? metadata.labelsEn
                : [layer.titleEn, ...layer.tagsEn, ...tokenizeMetadataLabel(layer.titleEn)]
            );
            layer.sourceAssetId =
              sanitizeMetadataText(layer.sourceAssetId || layer.imageSrc || layer.imageDataUrl || layer.id);
          }
        }

        if (layers.length <= 1) {
          const pageBounds = {
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
          };
          const pageArea = Math.max(1, rect.width * rect.height);
          const minTextArea = Math.max(120, pageArea * 0.0002);
          const minImageArea = Math.max(200, pageArea * 0.0003);
          const maxFallbackLayers = 60;
          const fallbackCandidates = [];
          const seenTextKeys = new Set();

          const toLayerFromViewportRect = (rawRect) => {
            const clipped = intersectRects(rawRect, pageBounds);
            if (!clipped) return null;
            const width = Math.max(1, clipped.width * designScaleX);
            const height = Math.max(1, clipped.height * designScaleY);
            const x = (clipped.x - rect.x) * designScaleX;
            const y = (clipped.y - rect.y) * designScaleY;
            return {
              x,
              y,
              width,
              height,
              viewportRect: {
                x: clipped.x,
                y: clipped.y,
                width: clipped.width,
                height: clipped.height,
              },
            };
          };

          const textNodes = Array.from(bestPage.node.querySelectorAll(`${TEXT_BLOCK_SELECTOR},span,div`));
          for (let index = 0; index < textNodes.length; index += 1) {
            const node = textNodes[index];
            if (!node) continue;
            const text = dedupeTextLines(node.innerText || "");
            if (!text || text.length < 2) continue;
            const nodeRect = node.getBoundingClientRect();
            const layerRect = toLayerFromViewportRect(nodeRect);
            if (!layerRect) continue;
            const area = Math.max(1, layerRect.width * layerRect.height);
            if (area < minTextArea) continue;

            const textStyle = window.getComputedStyle(node);
            const fontFamily = normalizeFontFamilyName(textStyle.fontFamily || "Arial") || "Arial";
            // This scale runs up to the PAGE node, so it includes Canva's zoom wrapper (scale(0.24)
            // at 24%) — the CSS font size × it is a SCREEN size, and like the box geometry above it
            // needs the design scale to land in design px. Without it every text this pass picked
            // up (DAHOnhalEeI imported mid-playback, its texts still transparent from their entrance
            // fade) came in at the zoom factor: 52 px → 12.46, 223.87 → 53.6.
            const textScale = getCompositeScaleToAncestor(node, bestPage.node);
            const textFontSize = Number.parseFloat(textStyle.fontSize || "") || 0;
            const resolvedFontSize = Math.max(
              8,
              (textFontSize || 24) * Math.max(0.01, textScale.y) * Math.max(0.0001, designScaleY)
            );
            const textLineHeightRaw = Number.parseFloat(textStyle.lineHeight || "");
            const textLineHeight =
              textLineHeightRaw && textFontSize > 0 ? textLineHeightRaw / textFontSize : 1.2;
            const textLetterSpacing =
              parseNumericPx(textStyle.letterSpacing || "") *
              Math.max(0.01, textScale.x) *
              Math.max(0.0001, designScaleX);
            const textDecoration = String(
              textStyle.textDecorationLine || textStyle.textDecoration || ""
            ).toLowerCase();
            const textBackgroundStyle = resolveTextBackgroundStyle(node, node);
            const textBackgroundColor = textBackgroundStyle.color;
            const textBackgroundRadius = textBackgroundStyle.radius;
            const opacity = getEffectiveOpacity(node, bestPage.node);
            if (opacity <= 0.03) continue;

            const textKey = `${text.toLowerCase()}|${Math.round(layerRect.x)}|${Math.round(
              layerRect.y
            )}|${Math.round(layerRect.width)}|${Math.round(layerRect.height)}`;
            if (seenTextKeys.has(textKey)) continue;
            seenTextKeys.add(textKey);

            const textRecord = {
              id: String(node.id || `fallback-text-${index + 1}`),
              parentId: null,
              name:
                String(node.getAttribute?.("aria-label") || "").trim() ||
                `Text ${fallbackCandidates.length + 1}`,
              kind: "text",
              x: layerRect.x,
              y: layerRect.y,
              width: Math.max(1, Math.round(layerRect.width)),
              height: Math.max(1, Math.round(layerRect.height)),
              angle: 0,
              flipX: false,
              flipY: false,
              viewportRect: layerRect.viewportRect,
              pageRelativeRect: {
                x: layerRect.x,
                y: layerRect.y,
                width: Math.max(1, Math.round(layerRect.width)),
                height: Math.max(1, Math.round(layerRect.height)),
              },
              imageSrc: "",
              imageDataUrl: "",
              preferSnapshot: false,
              sourceWidth: undefined,
              sourceHeight: undefined,
              text,
              textAlign: textStyle.textAlign || "left",
              color: textStyle.color || "#111827",
              fontFamily,
              fontSize: resolvedFontSize,
              fontStyle: textStyle.fontStyle || "normal",
              fontWeight: resolveEffectiveFontWeight(node, node, textStyle),
              lineHeight: Math.max(0.8, textLineHeight || 1.2),
              letterSpacing: textLetterSpacing,
              textDecoration,
              textBackgroundColor,
              textBackgroundRadius,
              fill: "",
              zIndex: getNumericZIndex(node, bestPage.node) ?? 1000 + index,
              opacity,
              fallback: false,
              fallbackReason: "",
            };
            if (!isDuplicateLayerEntry(textRecord)) {
              fallbackCandidates.push(textRecord);
            }
            if (fallbackCandidates.length >= maxFallbackLayers) break;
          }

          if (fallbackCandidates.length < maxFallbackLayers) {
            const mediaNodes = Array.from(bestPage.node.querySelectorAll("img,image,canvas,svg"));
            for (let index = 0; index < mediaNodes.length; index += 1) {
              const node = mediaNodes[index];
              if (!node) continue;

              const nodeRect = node.getBoundingClientRect();
              const layerRect = toLayerFromViewportRect(nodeRect);
              if (!layerRect) continue;
              const area = Math.max(1, layerRect.width * layerRect.height);
              if (area < minImageArea) continue;

              const tagName = String(node.tagName || "").toLowerCase();
              const imageTitleHint =
                tagName === "img" || tagName === "image"
                  ? getImageElementTitleHint(node)
                  : "";
              const isDecorativeFrame = looksLikeDecorativeFrameLabel(imageTitleHint);
              if (area > pageArea * 0.96 && layers.length > 0 && !isDecorativeFrame) continue;

              let imageSrc = "";
              if (tagName === "img" || tagName === "image") {
                imageSrc = getImageElementSource(node);
              } else if (tagName === "canvas") {
                try {
                  imageSrc = node.toDataURL("image/png");
                } catch (_error) {
                  imageSrc = "";
                }
              } else if (tagName === "svg") {
                if (hasRenderableSvgContent(node)) {
                  imageSrc = serializeSvgElementToDataUrl(
                    node,
                    Math.max(1, Math.round(layerRect.width)),
                    Math.max(1, Math.round(layerRect.height))
                  );
                }
              }
              if (!imageSrc) {
                imageSrc = findCssImageUrl(node);
              }

              let imageDataUrl = imageSrc.startsWith("data:image/") ? imageSrc : "";
              let imageProvenance = imageDataUrl ? "data" : "";
              let imageAcquisitionJob = null;
              if (
                !imageDataUrl &&
                (String(imageSrc).startsWith("blob:") || /^https?:\/\//i.test(String(imageSrc || "")))
              ) {
                imageAcquisitionJob = { kind: "url", url: imageSrc };
              }

              const opacity = getEffectiveOpacity(node, bestPage.node);
              if (opacity <= 0.03) continue;

              const fallbackReason = imageSrc ? "" : "unresolved-image-source";
              const imageRecord = {
                id: String(node.id || `fallback-image-${index + 1}`),
                parentId: null,
                name:
                  String(node.getAttribute?.("aria-label") || "").trim() ||
                  imageTitleHint ||
                  `Image ${fallbackCandidates.length + 1}`,
                kind: "image",
                x: layerRect.x,
                y: layerRect.y,
                width: Math.max(1, Math.round(layerRect.width)),
                height: Math.max(1, Math.round(layerRect.height)),
                angle: 0,
                flipX: false,
                flipY: false,
                viewportRect: layerRect.viewportRect,
                pageRelativeRect: {
                  x: layerRect.x,
                  y: layerRect.y,
                  width: Math.max(1, Math.round(layerRect.width)),
                  height: Math.max(1, Math.round(layerRect.height)),
                },
                imageSrc,
                imageDataUrl,
                imageProvenance,
                imageAcquisitionJob,
                preferSnapshot: !imageSrc,
                sourceWidth: Math.max(1, Math.round(layerRect.width)),
                sourceHeight: Math.max(1, Math.round(layerRect.height)),
                text: "",
                textAlign: "left",
                color: "#111827",
                fontFamily: "Arial",
                fontSize: 28,
                fontStyle: "normal",
                fontWeight: 400,
                lineHeight: 1.2,
                fill: "",
                zIndex: getNumericZIndex(node, bestPage.node) ?? 2000 + index,
                opacity,
                sourceAssetId: sanitizeMetadataText(imageSrc || node.id || ""),
                titleEn: imageTitleHint,
                tagsEn: imageTitleHint ? uniqueMetadataStrings(tokenizeMetadataLabel(imageTitleHint)) : [],
                labelsEn: imageTitleHint
                  ? uniqueMetadataStrings([imageTitleHint, ...tokenizeMetadataLabel(imageTitleHint)])
                  : [],
                fallback: Boolean(fallbackReason),
                fallbackReason,
              };
              if (!isDuplicateLayerEntry(imageRecord)) {
                fallbackCandidates.push(imageRecord);
              }
              if (fallbackCandidates.length >= maxFallbackLayers) break;
            }
          }

          const fallbackJobsNeedingImages = fallbackCandidates.filter(
            (record) => record.imageAcquisitionJob
          );
          await runWithConcurrency(fallbackJobsNeedingImages, 6, async (record) => {
            const job = record.imageAcquisitionJob;
            if (!job) return;
            let dataUrl = "";
            if (String(job.url).startsWith("blob:")) {
              dataUrl = await blobUrlToDataUrl(job.url);
            } else if (/^https?:\/\//i.test(String(job.url))) {
              dataUrl = await readRemoteImageAssetAsDataUrl(job.url);
            }
            if (dataUrl && dataUrl.startsWith("data:image/")) {
              record.imageSrc = dataUrl;
              record.imageDataUrl = dataUrl;
              record.imageProvenance = String(job.url).startsWith("blob:") ? "blob" : "fetch";
            }
          });
          for (const record of fallbackCandidates) delete record.imageAcquisitionJob;

          fallbackCandidates
            .sort((a, b) => {
              const zA = Number.isFinite(Number(a?.zIndex)) ? Number(a.zIndex) : 0;
              const zB = Number.isFinite(Number(b?.zIndex)) ? Number(b.zIndex) : 0;
              if (zA !== zB) return zA - zB;
              const yA = Number.isFinite(Number(a?.y)) ? Number(a.y) : 0;
              const yB = Number.isFinite(Number(b?.y)) ? Number(b.y) : 0;
              return yA - yB;
            })
            .slice(0, maxFallbackLayers)
            .forEach((candidate) => {
              if (!isDuplicateLayerEntry(candidate)) {
                layers.push(candidate);
              }
            });
        }
      }

      const usedLayerFonts = Array.from(
        new Set(
          layers
            .filter((layer) => String(layer?.kind || "").toLowerCase() === "text")
            .flatMap((layer) => [
              normalizeFontFamilyName(layer?.fontFamily),
              // A family used by one styled run of a multi-style text only (its textSpans).
              ...(Array.isArray(layer?.textRuns) ? layer.textRuns : []).map((run) =>
                normalizeFontFamilyName(run?.style?.fontFamily)
              ),
            ])
            .filter(Boolean)
        )
      );
      // Capture which (weight, style) each family is actually used at, so the resolver
      // keeps the matching font faces (e.g. Poppins Black 900 for big numbers) instead
      // of the arbitrary first few Canva happens to declare for the family.
      const usedFontTargetsByFamily = {};
      const addFontTarget = (family, target) => {
        const bucket = usedFontTargetsByFamily[family] || [];
        if (!bucket.some((t) => t.weight === target.weight && t.style === target.style)) {
          bucket.push(target);
        }
        usedFontTargetsByFamily[family] = bucket;
      };
      // A Canva text box can mix cuts — one bold line inside a regular paragraph. The layer
      // carries ONE weight (the editor has no per-run styling), but every cut the box renders
      // still has to ship, or the family lands with the regular file alone and the bold line can
      // never be recovered. Read the runs off the live node.
      const runFontTargets = (layerId) => {
        const node = layerId ? document.getElementById(String(layerId)) : null;
        if (!node) return [];
        const targets = [];
        node.querySelectorAll("*").forEach((child) => {
          if (child.children.length > 0 || !String(child.textContent || "").trim()) return;
          const style = window.getComputedStyle(child);
          if (parseFloat(style.fontSize || "0") < 6 || style.visibility === "hidden") return;
          targets.push({
            family: normalizeFontFamilyName(style.fontFamily),
            weight: parseFontWeight(style.fontWeight),
            style: normalizeFontStyle(style.fontStyle),
          });
        });
        return targets;
      };
      layers
        .filter((layer) => String(layer?.kind || "").toLowerCase() === "text")
        .forEach((layer) => {
          const family = normalizeFontFamilyName(layer?.fontFamily);
          if (!family) return;
          addFontTarget(family, {
            weight: parseFontWeight(layer?.fontWeight),
            style: normalizeFontStyle(layer?.fontStyle),
          });
          runFontTargets(layer?.id).forEach((target) => {
            if (target.family && target.family === family) {
              addFontTarget(family, { weight: target.weight, style: target.style });
            }
          });
          // Runs styled in ANOTHER family (or cut) are their own textSpans now, so their fonts ship too.
          (Array.isArray(layer?.textRuns) ? layer.textRuns : []).forEach((run) => {
            const runFamily = normalizeFontFamilyName(run?.style?.fontFamily);
            if (!runFamily || !String(run?.text || "").trim()) return;
            addFontTarget(runFamily, {
              weight: parseFontWeight(run.style.fontWeight),
              style: normalizeFontStyle(run.style.fontStyle),
            });
          });
        });
      const resolvedFontAssets = await resolveFontAssetsForFamilies(
        documentFontAssets,
        usedLayerFonts,
        usedFontTargetsByFamily
      );

      // A gradient page colour. Canva paints it as a page-level <svg><rect fill="url(#g)"> the
      // size of the page, outside every layer (the model's page fill carries it as `gradient`
      // with no `color`), so the import used to flatten it to one sampled colour. Re-expressed on
      // the page box exactly like a gradient text colour, in the app's own convention.
      const pageBackgroundGradient = (() => {
        try {
          if (!bestPage?.node) return null;
          const pageWidth = Math.max(1, Number(designWidth || rect.width));
          const pageHeight = Math.max(1, Number(designHeight || rect.height));
          const svg = Array.from(bestPage.node.querySelectorAll("svg")).find((candidate) => {
            if (candidate.closest('[id^="LB"]')) return false;
            if (!candidate.querySelector("linearGradient,radialGradient")) return false;
            const box = candidate.getBoundingClientRect();
            return box.width >= rect.width * 0.98 && box.height >= rect.height * 0.98;
          });
          if (!svg) return null;
          return canvaTextGradientToFill(svg.outerHTML, {
            width: pageWidth,
            height: pageHeight,
            bgX: 0,
            bgY: 0,
            originOffsetX: 0,
            originOffsetY: 0,
            imageWidth: pageWidth,
            imageHeight: pageHeight,
          });
        } catch (_error) {
          return null;
        }
      })();

      return {
        ok: true,
        title: document.title || "",
        sourceUrl: location.href,
        rect,
        devicePixelRatio: window.devicePixelRatio || 1,
        designWidth: Math.max(1, Math.round(designWidth || rect.width)),
        designHeight: Math.max(1, Math.round(designHeight || rect.height)),
        directDataUrl,
        sourceType: selectedCanvas ? "canvas" : "page-frame",
        layers,
        fontAssets: resolvedFontAssets,
        timelineSupplement: timelineSupplementSummary,
        pageBackgroundGradient,
      };
      
  }

  globalThis.__canvaImporterGetCaptureMetaFromTab = canvaImporterGetCaptureMeta;

  // Ordered page inventory for the multi-page orchestrator. Document order matches Canva's page
  // order (page 1 first); each entry carries the page's design-space dimensions when resolvable.
  globalThis.__canvaImporterListPages = function () {
    try {
      const parsePxLocal = (value) => {
        const parsed = Number.parseFloat(String(value || "").replace("px", ""));
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      };
      const parseStyleDimensionLocal = (styleText, dimension) => {
        const match = String(styleText || "").match(
          new RegExp(`${dimension}:\\s*([0-9.]+)px`, "i")
        );
        return match ? Number.parseFloat(match[1]) : 0;
      };
      return Array.from(document.querySelectorAll("[data-page-id]")).map((page, index) => {
        const rect = page.getBoundingClientRect();
        let designWidth = 0;
        let designHeight = 0;
        const scaleRoot = page.querySelector('div[style*="transform: scale"]');
        if (scaleRoot) {
          const styleText = scaleRoot.getAttribute("style") || "";
          designWidth = parseStyleDimensionLocal(styleText, "width");
          designHeight = parseStyleDimensionLocal(styleText, "height");
        }
        if (!designWidth || !designHeight) {
          const pageStyleText = page.getAttribute("style") || "";
          designWidth =
            parseStyleDimensionLocal(pageStyleText, "width") || parsePxLocal(page.style.width) || rect.width;
          designHeight =
            parseStyleDimensionLocal(pageStyleText, "height") || parsePxLocal(page.style.height) || rect.height;
        }
        return {
          index,
          pageId: String(page.getAttribute("data-page-id") || ""),
          top: rect.top,
          width: Math.max(1, Math.round(designWidth || 0)),
          height: Math.max(1, Math.round(designHeight || 0)),
          layerNodeCount: page.querySelectorAll('[id^="LB"]').length,
        };
      });
    } catch (_error) {
      return [];
    }
  };

  // Locates the bottom-strip page thumbnail for 1-based page number N. Canva's single-page view
  // switches pages ONLY through these thumbnails, and their handlers ignore untrusted events —
  // the background clicks the returned viewport coordinates through chrome.debugger (trusted
  // input). Locale-agnostic: matches any aria-label ENDING with the page number ("Page 2",
  // "صفحة 2", ...), skipping tiny live-region nodes.
  globalThis.__canvaImporterLocatePageThumb = function (pageNumber) {
    try {
      const target = Number(pageNumber);
      if (!Number.isInteger(target) || target < 1) return null;
      const matches = Array.from(document.querySelectorAll("[aria-label]"))
        .map((node) => ({ node, label: String(node.getAttribute("aria-label") || "").trim() }))
        .filter(({ label }) => new RegExp(`(^|\\s)${target}$`).test(label) && label.length < 48);
      for (const { node } of matches) {
        let rect = node.getBoundingClientRect();
        if (rect.width < 16 || rect.height < 16) continue;
        if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
          node.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
          rect = node.getBoundingClientRect();
        }
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          label: String(node.getAttribute("aria-label") || ""),
        };
      }
      return null;
    } catch (_error) {
      return null;
    }
  };

  // True when the currently mounted page contains any of the expected LB element ids — the
  // locale/DOM-agnostic way to know WHICH design page is on screen (the [data-page-id]
  // attribute is just the viewport slot index in single-page view, always "0").
  globalThis.__canvaImporterDisplayedPageMatches = function (expectedIds) {
    try {
      const scope = document.querySelector("[data-page-id]") || document;
      return (Array.isArray(expectedIds) ? expectedIds : []).some((id) => {
        try {
          return Boolean(scope.querySelector("#" + CSS.escape(String(id))));
        } catch (_e) {
          return false;
        }
      });
    } catch (_error) {
      return false;
    }
  };

  // Scrolls a page into view ahead of its scrape/capture pass. Current Canva editors
  // VIRTUALIZE pages — only the on-screen page's [data-page-id] node exists (attribute value =
  // page INDEX), so when the target is missing this nudges the design scroller forward to make
  // the next page mount; the caller re-invokes until "found". Returns "found" | "scrolled".
  globalThis.__canvaImporterScrollToPage = function (pageId) {
    try {
      const target = String(pageId || "").replace(/"/g, '\\"');
      const node = document.querySelector(`[data-page-id="${target}"]`);
      if (node) {
        node.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        return "found";
      }

      const scrollerOf = (start) => {
        let current = start && start.parentElement;
        while (current) {
          const style = window.getComputedStyle(current);
          if (
            /(auto|scroll)/.test(style.overflowY) &&
            current.scrollHeight > current.clientHeight + 10
          ) {
            return current;
          }
          current = current.parentElement;
        }
        return document.scrollingElement || document.documentElement;
      };

      const pageNodes = Array.from(document.querySelectorAll("[data-page-id]"));
      const anchor = pageNodes[pageNodes.length - 1] || document.querySelector('[id^="LB"]');
      const scroller = scrollerOf(anchor);
      if (anchor) {
        anchor.scrollIntoView({ block: "end", behavior: "instant" });
      }
      if (scroller) {
        scroller.scrollTop += Math.max(200, Math.round(scroller.clientHeight * 0.85));
      }
      return "scrolled";
    } catch (_error) {
      return "scrolled";
    }
  };
})();
