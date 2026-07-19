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
          { type: "RISE", label: "Rise", regex: /\b(rise)\b|ارتفاع/ },
          { type: "PAN", label: "Pan", regex: /\b(pan)\b|تأرجح|ترنح/ },
          { type: "POP", label: "Pop", regex: /\b(pop|zoom|zoom in|zoom out)\b|انبثاق/ },
          { type: "WIPE", label: "Wipe", regex: /\b(directional wipe|wipe)\b|المسح/ },
          { type: "BLUR", label: "Blur", regex: /\b(blur|soft blur)\b|تمويه/ },
          { type: "SUCCESSION", label: "Succession", regex: /\b(succession|zoom fade)\b|التتابع/ },
          { type: "BREATHE", label: "Breathe", regex: /\b(breathe|slow reveal)\b|ظهور بطيء/ },
          { type: "BASELINE", label: "Baseline", regex: /\b(baseline|bounce)\b|baseline|خط الأساس/ },
          { type: "DRIFT", label: "Drift", regex: /\b(drift|slide|slide in|slide out)\b|انجراف/ },
          { type: "TECTONIC", label: "Tectonic", regex: /\b(soft gradient wipe|wipe gradient|gradient wipe|tectonic)\b|حركة تكتونية/ },
          { type: "TUMBLE", label: "Tumble", regex: /\b(tumble|turn|radial sweep reveal|radial sweep|radial)\b|دوران/ },
          { type: "NEON", label: "Neon", regex: /\b(neon|soft circular reveal|circular fade)\b|نيون/ },
          { type: "SCRAPBOOK", label: "Scrapbook", regex: /\b(scrapbook)\b|سجل قصاصات/ },
          { type: "STOMP", label: "Stomp", regex: /\b(stomp|circular reveal|circular|aerial)\b|سقوط هوائي/ },
          { type: "ROTATE", label: "Rotate", regex: /\b(continuous rotation|rotation|spin|rotate)\b|تدوير/ },
          { type: "FLICKER", label: "Flicker", regex: /\bflicker\b|ومض/ },
          { type: "PULSE", label: "Pulse", regex: /\b(pulse|pulse zoom|squash and stretch|heart beat|heartbeat)\b|تقلص العنصر وتمدد|نبض/ },
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
          // flatten groups → every element
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
                  if (
                    Array.isArray(val) &&
                    val.some((it) => it && typeof it === "object" && "type" in it)
                  ) {
                    collect(val, depth + 1);
                  }
                } catch (_error) {
                  /* ignore */
                }
              }
            }
          };
          collect(elementsArray, 0);

          // Track container + track/array names are MINIFIED and ROTATE between Canva deploys
          // (observed: Sv→Tv, tf→sf, Acb→Lcb, eGd→SGd, gGd→UGd; Wf/dts survived one rotation).
          // Everything is therefore resolved STRUCTURALLY, mirroring background.js's
          // extractCanvaFiberModel — keep the two in sync.
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

          // Image media reference + in-frame crop from a rect's fill. media.id is shared across every
          // instance of the same image (Canva instances one media many times), so one rendered
          // instance resolves the pixels for all — each element supplies its own crop (fill.sb).
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

          const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
          for (const el of allElements) {
            const id = String((el && el.id) || "");
            if (!id || !/^LB/.test(id)) continue;
            result[id] = {
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
            };
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
          hasAngle: Boolean(rotateMatch),
          angle: Number.isFinite(Number(rotateMatch?.[1])) ? Number(rotateMatch[1]) : 0,
        };
      };

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
            inlineTransform.hasAngle;
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
            Math.abs(Number(computedTransform.angle || 0)) > 0.2 || inlineTransform.hasAngle;
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
        for (let index = 0; index < candidates.length; index += 1) {
          const normalized = normalizeAssetUrl(candidates[index]);
          if (normalized) return normalized;
        }
        return "";
      };

      const dedupeTextLines = (value) => {
        const lines = String(value || "")
          .split("\n")
          .map((line) => line.replace(/\s+/g, " ").trim())
          .filter(Boolean);
        if (lines.length === 0) return "";

        const shortLineCount = lines.filter((line) => line.length <= 2).length;
        const isCharacterStack =
          lines.length >= 4 && shortLineCount / Math.max(1, lines.length) >= 0.7;
        if (isCharacterStack) {
          return lines.join("");
        }

        const deduped = [];
        lines.forEach((line) => {
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

      const normalizeFontFamilyName = (value) => {
        const input = String(value || "").trim();
        if (!input) return "";
        const primary = input.split(",")[0]?.replace(/^['"]+|['"]+$/g, "").trim() || "";
        if (!primary) return "";
        if (GENERIC_FONT_FAMILIES.has(primary.toLowerCase())) return "";
        return primary.replace(/\s+/g, " ").trim();
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
            if (!blob || blob.size <= 0 || blob.size > maxBytes) continue;
            const mimeType = String(blob.type || "").trim().toLowerCase();
            if (mimeType && !mimeType.startsWith("image/")) continue;
            const dataUrl = await toDataUrlFromBlob(blob);
            if (String(dataUrl).startsWith("data:image/")) return dataUrl;
          } catch (_error) {
            // Try the next credentials mode.
          }
        }
        return "";
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

        // (1) Already a data: URL — done.
        if (String(initialSrc).startsWith("data:image/")) {
          return { src: initialSrc, dataUrl: initialSrc, provenance: "data" };
        }

        // (2) blob: URL - fetch through FileReader while the blob is still live.
        if (String(initialSrc).startsWith("blob:")) {
          const blobDataUrl = await blobUrlToDataUrl(initialSrc);
          if (blobDataUrl) {
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
                cropRegion
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

      const findCssImageUrl = (element) => {
        if (!element) return "";
        const searchSources = [];
        const pushStyle = (style) => {
          if (!style) return;
          searchSources.push(style.backgroundImage);
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

      const findBestTextStyleElement = (node, ownerNode = node) => {
        const candidates = Array.from(node.querySelectorAll("p,span,div")).filter(
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
            (candidate.tagName === "P" ? 12 : 0) +
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
      const snapshotRequiredForLayer = (layerNode, imageElement) => {
        if (!layerNode || !imageElement) return false;
        if (hasRotationOrFlipBetween(imageElement, layerNode)) return true;
        let node = imageElement;
        let depth = 0;
        while (node && depth < 12) {
          const style = window.getComputedStyle(node);
          if (
            style.clipPath !== "none" ||
            style.maskImage !== "none" ||
            style.webkitMaskImage !== "none" ||
            parseNumericPx(style.borderRadius) > 2 ||
            (style.filter && style.filter !== "none") ||
            (style.backdropFilter && style.backdropFilter !== "none") ||
            (style.mixBlendMode && style.mixBlendMode !== "normal")
          ) {
            return true;
          }
          if (node === layerNode) break;
          node = node.parentElement;
          depth += 1;
        }
        const renderableDescendants = Array.from(
          layerNode.querySelectorAll("img, image, svg, canvas")
        ).filter(
          (candidate) =>
            !isInsideForeignLayer(candidate, layerNode) &&
            candidate !== imageElement &&
            !candidate.contains?.(imageElement)
        );
        if (renderableDescendants.length > 0) return true;
        if (findCssImageUrl(layerNode)) return true;
        const primaryImageSource = getImageElementSource(imageElement);
        const otherImageSources = getScopedImageElements(layerNode)
          .filter((candidate) => candidate !== imageElement)
          .map((candidate) => getImageElementSource(candidate))
          .filter(Boolean);
        return otherImageSources.some((candidate) => candidate !== primaryImageSource);
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
          if (!isVisible(candidate, rect)) return;
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
            Math.round(targetWidth || parseNumericDimension(svgElement.getAttribute("width")) || rect.width || 1)
          );
          const height = Math.max(
            1,
            Math.round(targetHeight || parseNumericDimension(svgElement.getAttribute("height")) || rect.height || 1)
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
          if (opaque < total * 0.35) return false; // mostly transparent → clean cut-out
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

      const fitDataUrlToDisplayedBox = async (dataUrl, targetWidth, targetHeight, cropRegion = null) => {
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
          // outScale is clamped to <= 1 so we never upscale beyond the real pixels.
          const nativeWidth = Math.max(1, Math.round(sw));
          const nativeHeight = Math.max(1, Math.round(sh));
          const outScale = Math.min(1, MAX_FITTED_IMAGE_SIDE / Math.max(nativeWidth, nativeHeight, 1));
          const width = Math.max(1, Math.round(nativeWidth * outScale));
          const height = Math.max(1, Math.round(nativeHeight * outScale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) return null;
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = "high";
          context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
          const outDataUrl = encodeAsJpeg
            ? canvas.toDataURL("image/jpeg", 0.92)
            : canvas.toDataURL("image/png");
          return { dataUrl: outDataUrl, width, height };
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

      const serializeClipPathShapeToDataUrl = (
        layerNode,
        clipPathShapeCandidate,
        targetWidth,
        targetHeight
      ) => {
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
          const width = Math.max(1, Math.round(targetWidth || layerRect.width || candidateRect.width || 1));
          const height = Math.max(1, Math.round(targetHeight || layerRect.height || candidateRect.height || 1));
          const scaleX = candidateRect.width / Math.max(1, clipBounds.width);
          const scaleY = candidateRect.height / Math.max(1, clipBounds.height);
          const translateX =
            candidateRect.left - layerRect.left - clipBounds.x * scaleX;
          const translateY =
            candidateRect.top - layerRect.top - clipBounds.y * scaleY;
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

          const svgMarkup = [
            `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`,
            `<g fill="${clipPathShapeCandidate.backgroundColor}" opacity="${clipPathShapeCandidate.opacity}" transform="translate(${translateX} ${translateY}) scale(${scaleX} ${scaleY})">`,
            serializedShapes,
            "</g>",
            "</svg>",
          ].join("");
          return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup)}`;
        } catch (_error) {
          return "";
        }
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
      const pageNodes = Array.from(document.querySelectorAll("[data-page-id]"));
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

        for (let layerIndex = 0; layerIndex < layerNodes.length; layerIndex += 1) {
          const node = layerNodes[layerIndex];
          const styleText = node.getAttribute("style") || "";
          const styleTransform = parseStyleTransform(styleText);
          const computedNodeStyle = window.getComputedStyle(node);
          const transform = parseComputedTransform(computedNodeStyle.transform || styleText);
          const backgroundMeta = backgroundLayerMeta.get(node) || null;
          const isBackgroundNode = Boolean(backgroundMeta);
          const isFullPageBackground = Boolean(backgroundMeta && backgroundMeta.coverage >= 0.9);
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
          const isInsidePageFrame = viewportInfo.coverage >= 0.2;
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
          if (
            !isBackgroundNode &&
            (!isInsidePageFrame ||
              (!passesDefaultSizeGate &&
                !passesSmallTextGate &&
                !passesThinVectorGate &&
                !passesSmallImageGate))
          ) {
            continue;
          }

          const styleWidth = parseStyleDimension(styleText, "width");
          const styleHeight = parseStyleDimension(styleText, "height");
          const hasStyleGeometry = styleWidth >= 2 && styleHeight >= 2;
          const imageElements = scopedImageElements;
          const imageElement =
            imageElements
              .map((element) => ({ element, rect: element.getBoundingClientRect() }))
              .sort((a, b) => rectArea(b.rect) - rectArea(a.rect))[0]?.element || null;
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
          const shouldUseVisibleGeometry = isMaskedImage;
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
          const nodeScale = getCompositeScaleToAncestor(node, bestPage.node);
          const layerScaleX = Math.max(0.01, Number(transform.scaleX || 1));
          const layerScaleY = Math.max(0.01, Number(transform.scaleY || 1));
          const rawDesignWidth = Math.max(1, rawRect.width * designScaleX);
          const rawDesignHeight = Math.max(1, rawRect.height * designScaleY);
          const centerDesignX =
            (rawRect.x - rect.x + rawRect.width / 2) * designScaleX;
          const centerDesignY =
            (rawRect.y - rect.y + rawRect.height / 2) * designScaleY;
          const styledWidth = hasStyleGeometry
            ? Math.max(1, styleWidth * nodeScale.x * layerScaleX)
            : 0;
          const styledHeight = hasStyleGeometry
            ? Math.max(1, styleHeight * nodeScale.y * layerScaleY)
            : 0;
          const styleWidthRatio = styledWidth > 0 ? styledWidth / rawDesignWidth : 0;
          const styleHeightRatio = styledHeight > 0 ? styledHeight / rawDesignHeight : 0;
          const styleGeometryMatchesViewport =
            hasStyleGeometry &&
            styleWidthRatio >= 0.8 &&
            styleWidthRatio <= 1.25 &&
            styleHeightRatio >= 0.8 &&
            styleHeightRatio <= 1.25;
          const width = isFullPageBackground
            ? Math.max(1, Number(designWidth || rect.width))
            : styleGeometryMatchesViewport
              ? styledWidth
              : rawDesignWidth;
          const height = isFullPageBackground
            ? Math.max(1, Number(designHeight || rect.height))
            : styleGeometryMatchesViewport
              ? styledHeight
              : rawDesignHeight;
          const x = isFullPageBackground ? 0 : centerDesignX - width / 2;
          const y = isFullPageBackground ? 0 : centerDesignY - height / 2;
          const layerAngle = isFullPageBackground
            ? 0
            : transform.hasReflection
              ? transform.angle
              : styleTransform.hasAngle
                ? styleTransform.angle
                : transform.angle;
          const layerFlipX = isFullPageBackground ? false : Boolean(transform.flipX);
          const layerFlipY = isFullPageBackground ? false : Boolean(transform.flipY);
          if (width < 2 || height < 2) continue;

          const textFromParagraphs = Array.from(node.querySelectorAll("p"))
            .filter((item) => !isInsideForeignLayer(item, node))
            .map((item) => item.innerText || "")
            .filter(Boolean)
            .join("\n");
          const text = dedupeTextLines(textFromParagraphs || textPreview);

          const textStyleElement = findBestTextStyleElement(node, node);

          let shapeFill = "";
          let shapeImageDataUrl = "";
          let thinVectorStrokeStyle = { color: "", strokeOnly: false };
          if (!imageElement) {
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
          const effectiveOpacity = getEffectiveOpacity(imageElement || node, bestPage.node);
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

          let imageAcquisitionJob = null;
          if (imageElement && !imageDataUrl) {
            imageSrc = getImageElementSource(imageElement);
            if (String(imageSrc).startsWith("data:image/")) {
              imageDataUrl = imageSrc;
              imageProvenance = "data";
            } else {
              // Defer acquisition; resolve all jobs in parallel after the loop.
              imageAcquisitionJob = { kind: "element", element: imageElement, width, height };
            }
          }

          if (!imageSrc) {
            const backgroundCandidates = [node, ...getScopedDescendants(node)];
            for (let index = 0; index < backgroundCandidates.length; index += 1) {
              const candidate = backgroundCandidates[index];
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
            (customFontSize > 0 ? customFontSize : textFontSize > 0 ? textFontSize : 28) * textScale.y
          );
          const textLineHeightRaw = Number.parseFloat(textStyle?.lineHeight || "");
          const textLineHeight =
            textLineHeightRaw && textFontSize > 0 ? textLineHeightRaw / textFontSize : 1.2;
          const textLetterSpacing = parseNumericPx(textStyle?.letterSpacing || "");
          const textDecoration = String(
            textStyle?.textDecorationLine || textStyle?.textDecoration || ""
          ).toLowerCase();
          const textBackgroundStyle = textStyleElement
            ? resolveTextBackgroundStyle(textStyleElement, node)
            : { color: "", radius: 0 };
          const textBackgroundColor = textBackgroundStyle.color;
          const textBackgroundRadius = textBackgroundStyle.radius;

          const mediaWidth = Number(imageElement?.naturalWidth || imageElement?.width?.baseVal?.value || 0);
          const mediaHeight = Number(imageElement?.naturalHeight || imageElement?.height?.baseVal?.value || 0);
          const hasMediaDimensions = mediaWidth >= 12 && mediaHeight >= 12;
          const hasImageSignal = Boolean(imageElement || imageSrc || imageDataUrl || backgroundImageSignals.length);
          const zIndexSignal = zIndex === null || zIndex >= -10;
          const opacitySignal = effectiveOpacity > 0.03;
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
            ((isLargeEnough && hasEnoughArea) || passesSmallImageGate);
          const roundedWidth = Math.max(1, Math.round(width));
          const roundedHeight = Math.max(1, Math.round(height));
          const vectorAspectRatio =
            Math.max(roundedWidth, roundedHeight) / Math.max(1, Math.min(roundedWidth, roundedHeight));
          const isThinVectorDividerLayer =
            !imageElement &&
            !text &&
            hasVectorSignal &&
            thinVectorStrokeStyle.strokeOnly &&
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
          const modelFillImage = (fiberModelById[String(node.id || "")] || {}).image || null;
          const normalizedLayerFlipX =
            (isThinVectorDividerLayer ? false : layerFlipX) || Boolean(modelFillImage?.flipX);
          const normalizedLayerFlipY =
            (isThinVectorDividerLayer ? false : layerFlipY) || Boolean(modelFillImage?.flipY);
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
          const hasGenuineMaskOrComposite =
            Boolean(shouldPreserveRenderedImagePixels) &&
            snapshotRequiredForLayer(node, imageElement);
          const snapshotIsLossyFallback =
            Boolean(shouldPreserveRenderedImagePixels) && !hasGenuineMaskOrComposite;

          if (shouldPreserveRenderedImagePixels && imageAcquisitionJob?.kind === "element") {
            // buildDisplayedImageCropRegion maps the visible region in SCREEN space; for a layer
            // rendered rotated ~180° (and/or fill-mirrored) that region must be remapped into the
            // UN-rotated source's coordinate space or the crop picks the OPPOSITE corner of the
            // media (symptom: corner bouquets sliced mid-flower). rot180 mirrors both axes; a fill
            // flip mirrors X once more; the editor re-applies angle+flip at render, so the slice
            // must be cut from the pre-image location.
            const remapRegionForOrientation = (region) => {
              if (!region) return region;
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
              cropRegion: isMaskedImage
                ? remapRegionForOrientation(buildDisplayedImageCropRegion(imageElement, viewportRect))
                : null,
            };
          }
          if (shouldPreserveRenderedImagePixels && !hasCompanionText) {
            preferSnapshot = true;
          }

          const layerAnimation = (fiberModelById[String(node.id || "")] || {}).animation || null;
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
            x,
            y,
            width: roundedWidth,
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
              x,
              y,
              width: roundedWidth,
              height: roundedHeight,
            },
            imageSrc,
            imageDataUrl,
            imageProvenance,
            imageAcquisitionJob,
            preferSnapshot,
            snapshotIsLossyFallback,
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
            fontSize: resolvedFontSize,
            fontStyle: textStyle?.fontStyle || "normal",
            fontWeight: resolveEffectiveFontWeight(textStyleElement, node, textStyle),
            lineHeight: Math.max(0.8, textLineHeight || 1.2),
            letterSpacing: textLetterSpacing,
            textDecoration,
            textBackgroundColor,
            textBackgroundRadius,
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
            fallbackReason,
            hasCompanionText,
          };
          let companionTextRecord = null;
          if (hasCompanionText) {
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
          if (!isDuplicateLayerEntry(layerRecord)) {
            layers.push(layerRecord);
          }
          if (companionTextRecord && !isDuplicateLayerEntry(companionTextRecord)) {
            layers.push(companionTextRecord);
          }
        }

        // Drain deferred image acquisitions in parallel.
        const layersNeedingImages = layers.filter((layer) => layer.imageAcquisitionJob);
        await runWithConcurrency(layersNeedingImages, 6, async (layer) => {
          const job = layer.imageAcquisitionJob;
          if (!job) return;
          if (job.kind === "element") {
            const acquired = await acquireImageForElement(job.element, job.width, job.height, {
              fitFetchedToTarget: Boolean(job.fitFetchedToTarget),
              cropRegion: job.cropRegion || null,
            });
            if (acquired.src) layer.imageSrc = acquired.src;
            if (acquired.dataUrl) layer.imageDataUrl = acquired.dataUrl;
            if (acquired.provenance) layer.imageProvenance = acquired.provenance;
            if (acquired.sourceWidth) layer.sourceWidth = acquired.sourceWidth;
            if (acquired.sourceHeight) layer.sourceHeight = acquired.sourceHeight;
            // If Canva served a background-baked version of this decoration (the page colour
            // composited into the asset), the raw asset looks wrong on its own. Drop the
            // lossy-fallback flag so background.js keeps its isolation snapshot, which
            // subtracts the page background and yields a clean cut-out. The genuine
            // full-page background is exempt — it SHOULD keep its baked colour.
            if (
              layer.snapshotIsLossyFallback &&
              !layer.isFullPageBackground &&
              !layer.isBackgroundNode &&
              (await isBackgroundBakedAsset(layer.imageDataUrl))
            ) {
              layer.snapshotIsLossyFallback = false;
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
          const capturedIds = new Set(layers.map((l) => String(l.id || "")));
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
          const fontTokenToFamily = (token) => String(token || "").trim().replace(/,/g, "_");
          const clampOpacity = (transparency) => {
            let t = Number(transparency) || 0;
            if (t > 1) t /= 100;
            return Math.max(0, Math.min(1, 1 - t));
          };

          const supplementImages = [];
          let supplementText = 0;
          let unresolvedMedia = 0;
          let unresolvedAnimated = 0;
          let backgroundPosterAdded = false;
          for (const id of Object.keys(fiberModelById)) {
            if (id.startsWith("__")) continue; // meta entries (e.g. __background), not elements
            if (capturedIds.has(id)) continue;
            const el = fiberModelById[id];
            if (!el || !el.type) continue;
            const w = Math.max(1, Math.round(el.width));
            const h = Math.max(1, Math.round(el.height));
            if (w <= 1 || h <= 1) continue;
            const x = el.left;
            const y = el.top;
            const base = {
              id,
              parentId: null,
              x,
              y,
              width: w,
              height: h,
              angle: Number(el.rotation) || 0,
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
                fontSize: Number(t.fontSize) > 0 ? Number(t.fontSize) : Math.max(12, Math.round(h * 0.6)),
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
            if (!crop || !(crop.width > 0) || !(crop.height > 0)) return;
            if (Math.abs(Number(crop.rotation) || 0) > 0.5) return; // rotated fills: keep full media
            const frameW = Number(layer.width) || 0;
            const frameH = Number(layer.height) || 0;
            if (frameW < 1 || frameH < 1) return;
            const matchesFrame =
              Math.abs(crop.left) < 1 &&
              Math.abs(crop.top) < 1 &&
              Math.abs(crop.width - frameW) < 2 &&
              Math.abs(crop.height - frameH) < 2;
            if (matchesFrame) return;
            const dataUrl = String(layer.imageDataUrl || "");
            if (!dataUrl.startsWith("data:image/")) return;
            // visible region = media rect ∩ frame rect, expressed as fractions of the media rect
            const visX = Math.max(0, crop.left);
            const visY = Math.max(0, crop.top);
            const visRight = Math.min(frameW, crop.left + crop.width);
            const visBottom = Math.min(frameH, crop.top + crop.height);
            if (visRight - visX < 1 || visBottom - visY < 1) return;
            const region = {
              x: (visX - crop.left) / crop.width,
              y: (visY - crop.top) / crop.height,
              width: (visRight - visX) / crop.width,
              height: (visBottom - visY) / crop.height,
            };
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
                if (rb && rb.width > 0 && rb.height > 0) {
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
          const usToMsFloor = (us) => {
            const n = Number(us);
            return Number.isFinite(n) && n > 0 ? Math.round(n / 1000) : 0;
          };
          for (const layer of layers) {
            const model = fiberModelById[String((layer && layer.id) || "")];
            if (!model) continue;
            const startMs = usToMsFloor(model.startUs);
            const durMs = usToMsFloor(model.durationUs);
            if (durMs > 0) {
              layer.timelineStartMs = startMs;
              layer.timelineEndMs = startMs + durMs;
            }
          }
        } catch (timelineError) {
          console.warn("[canva-scraper] timeline positioning failed:", timelineError);
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

          const textNodes = Array.from(bestPage.node.querySelectorAll("p,span,div"));
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
            const textScale = getCompositeScaleToAncestor(node, bestPage.node);
            const textFontSize = Number.parseFloat(textStyle.fontSize || "") || 0;
            const resolvedFontSize = Math.max(8, (textFontSize || 24) * Math.max(0.01, textScale.y));
            const textLineHeightRaw = Number.parseFloat(textStyle.lineHeight || "");
            const textLineHeight =
              textLineHeightRaw && textFontSize > 0 ? textLineHeightRaw / textFontSize : 1.2;
            const textLetterSpacing = parseNumericPx(textStyle.letterSpacing || "");
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
            .map((layer) => normalizeFontFamilyName(layer?.fontFamily))
            .filter(Boolean)
        )
      );
      // Capture which (weight, style) each family is actually used at, so the resolver
      // keeps the matching font faces (e.g. Poppins Black 900 for big numbers) instead
      // of the arbitrary first few Canva happens to declare for the family.
      const usedFontTargetsByFamily = {};
      layers
        .filter((layer) => String(layer?.kind || "").toLowerCase() === "text")
        .forEach((layer) => {
          const family = normalizeFontFamilyName(layer?.fontFamily);
          if (!family) return;
          const target = {
            weight: parseFontWeight(layer?.fontWeight),
            style: normalizeFontStyle(layer?.fontStyle),
          };
          const bucket = usedFontTargetsByFamily[family] || [];
          if (!bucket.some((t) => t.weight === target.weight && t.style === target.style)) {
            bucket.push(target);
          }
          usedFontTargetsByFamily[family] = bucket;
        });
      const resolvedFontAssets = await resolveFontAssetsForFamilies(
        documentFontAssets,
        usedLayerFonts,
        usedFontTargetsByFamily
      );

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
      };
      
  }

  globalThis.__canvaImporterGetCaptureMetaFromTab = canvaImporterGetCaptureMeta;
})();
