/* Preset library — JSON-compatible. Units: ms, px (at 1080 wide; scale with canvas), deg, %.
 * phase: entrance | emphasis | loop | exit
 * "$param" strings are substituted from params (defaults below, overridable per track).
 */
(function (root) {
  const P = {
    // ---------- ENTRANCES ----------
    'fade-in':        { phase: 'entrance', cat: 'fade', targets: ['any'], duration: 600, ease: 'cubicOut', from: { opacity: 0 }, to: { opacity: 1 } },
    'fade-up':        { phase: 'entrance', cat: 'slide', targets: ['any'], duration: 700, ease: 'expoOut', params: { distance: { default: 40, min: 0, max: 200 } }, from: { opacity: 0, y: '$distance' }, to: { opacity: 1, y: 0 } },
    'fade-down':      { phase: 'entrance', cat: 'slide', targets: ['any'], duration: 700, ease: 'expoOut', params: { distance: { default: 40, min: 0, max: 200 } }, from: { opacity: 0, y: '-$distance' }, to: { opacity: 1, y: 0 } },
    'slide-in-start': { phase: 'entrance', cat: 'slide', targets: ['any'], duration: 800, ease: 'quartOut', params: { distance: { default: 120, min: 0, max: 1080 } }, from: { opacity: 0, x: '$distance' }, to: { opacity: 1, x: 0 }, note: 'RTL start = from the right (+x). Mirror for LTR.' },
    'slide-in-end':   { phase: 'entrance', cat: 'slide', targets: ['any'], duration: 800, ease: 'quartOut', params: { distance: { default: 120, min: 0, max: 1080 } }, from: { opacity: 0, x: '-$distance' }, to: { opacity: 1, x: 0 } },
    'drift-in':       { phase: 'entrance', cat: 'slide', targets: ['text', 'image'], duration: 1400, ease: 'silk', params: { distance: { default: 24, min: 0, max: 80 } }, from: { opacity: 0, x: '$distance' }, to: { opacity: 1, x: 0 }, note: 'Long, low-distance: luxury.' },
    'scale-in':       { phase: 'entrance', cat: 'scale', targets: ['any'], duration: 600, ease: 'cubicOut', params: { fromScale: { default: 0.85, min: 0, max: 1 } }, from: { opacity: 0, scale: '$fromScale' }, to: { opacity: 1, scale: 1 } },
    'settle-in':      { phase: 'entrance', cat: 'scale', targets: ['text', 'image'], duration: 1600, ease: 'silk', from: { opacity: 0, scale: 1.06, blur: 6 }, to: { opacity: 1, scale: 1, blur: 0 }, note: 'Large -> 1 with blur clearing. Elegant hero.' },
    'zoom-in':        { phase: 'entrance', cat: 'scale', targets: ['image', 'shape'], duration: 900, ease: 'expoOut', from: { opacity: 0, scale: 1.6 }, to: { opacity: 1, scale: 1 } },
    'pop':            { phase: 'entrance', cat: 'scale', targets: ['icon', 'badge', 'shape', 'text'], duration: 550, ease: 'backOut', from: { opacity: 0, scale: 0.4 }, to: { opacity: 1, scale: 1 } },
    'pop-spring':     { phase: 'entrance', cat: 'scale', targets: ['icon', 'badge'], duration: 900, ease: 'springBouncy', from: { opacity: 0, scale: 0.3 }, to: { opacity: 1, scale: 1 } },
    'rise':           { phase: 'entrance', cat: 'slide', targets: ['any'], duration: 900, ease: 'expoOut', params: { distance: { default: 80, min: 0, max: 400 } }, from: { opacity: 0, y: '$distance' }, to: { opacity: 1, y: 0 }, note: 'Ali: never on backgrounds.' },
    'bounce-in':      { phase: 'entrance', cat: 'bounce', targets: ['icon', 'badge', 'sticker'], duration: 900, ease: 'bounceOut', from: { opacity: 1, y: -300 }, to: { y: 0 } },
    'blur-in':        { phase: 'entrance', cat: 'blur', targets: ['text', 'image'], duration: 900, ease: 'cubicOut', params: { radius: { default: 16, min: 0, max: 40 } }, from: { opacity: 0, blur: '$radius' }, to: { opacity: 1, blur: 0 } },
    'mask-reveal-up': { phase: 'entrance', cat: 'mask', targets: ['text', 'image'], duration: 900, ease: 'expoOut', params: { distance: { default: 30, min: 0, max: 120 } }, from: { clipT: 100, y: '$distance' }, to: { clipT: 0, y: 0 }, note: 'Clip from top edge + slight rise: classic title reveal.' },
    'wipe-start':     { phase: 'entrance', cat: 'mask', targets: ['any'], duration: 1000, ease: 'quartInOut', from: { clipL: 100 }, to: { clipL: 0 }, note: 'RTL: reveals right->left (clipL shrinks).' },
    'wipe-center':    { phase: 'entrance', cat: 'mask', targets: ['line', 'divider', 'image'], duration: 900, ease: 'expoOut', from: { clipL: 50, clipR: 50 }, to: { clipL: 0, clipR: 0 } },
    'iris-in':        { phase: 'entrance', cat: 'mask', targets: ['image', 'frame'], duration: 1100, ease: 'expoOut', from: { clipT: 50, clipB: 50, clipL: 50, clipR: 50, scale: 1.1 }, to: { clipT: 0, clipB: 0, clipL: 0, clipR: 0, scale: 1 } },
    'draw-stroke':    { phase: 'entrance', cat: 'draw', targets: ['path', 'ornament', 'divider'], duration: 1600, ease: 'sineInOut', from: { draw: 0 }, to: { draw: 1 } },
    'flip-in-y':      { phase: 'entrance', cat: '3d', targets: ['card', 'image'], duration: 1000, ease: 'backOutSoft', from: { opacity: 0, rotateY: -90 }, to: { opacity: 1, rotateY: 0 } },
    'stretch-snap':   { phase: 'entrance', cat: 'stretch', targets: ['text'], duration: 700, keyframes: [{ t: 0, props: { scaleY: 0, opacity: 1 } }, { t: 0.55, props: { scaleY: 1.35 }, ease: 'expoOut' }, { t: 1, props: { scaleY: 1 }, ease: 'backOut' }], note: 'Jitter "Snappy Text Stretch" style.' },
    'typewriter':     { phase: 'entrance', cat: 'text', targets: ['text'], duration: 1, ease: 'linear', from: { opacity: 0 }, to: { opacity: 1 }, unit: 'letter', note: 'Per-unit instant-on; stagger.each = typing speed. Latin only. Arabic: unit=word.' },
    'glitch-in':      { phase: 'entrance', cat: 'advanced', targets: ['text', 'image'], duration: 700, keyframes: [{ t: 0, props: { opacity: 0, rgbSplit: 0, x: 0 } }, { t: .15, props: { opacity: 1, rgbSplit: 14, x: -12 }, ease: 'steps(2)' }, { t: .3, props: { rgbSplit: -10, x: 10 }, ease: 'steps(2)' }, { t: .45, props: { rgbSplit: 6, x: -4 }, ease: 'steps(2)' }, { t: .7, props: { rgbSplit: 0, x: 0 }, ease: 'cubicOut' }, { t: 1, props: { rgbSplit: 0, x: 0 } }] },
    'count-up':       { phase: 'entrance', cat: 'text', targets: ['number'], duration: 1400, ease: 'expoOut', from: { value: 0 }, to: { value: 1 }, note: 'Renderer maps value 0..1 to the target number.' },

    // ---------- EMPHASIS (one-shot attention) ----------
    'pulse-once':     { phase: 'emphasis', cat: 'scale', targets: ['badge', 'cta'], duration: 600, keyframes: [{ t: 0, props: { scale: 1 } }, { t: .4, props: { scale: 1.12 }, ease: 'cubicOut' }, { t: 1, props: { scale: 1 }, ease: 'cubicInOut' }] },
    'wiggle':         { phase: 'emphasis', cat: 'rotate', targets: ['icon', 'cta'], duration: 700, keyframes: [{ t: 0, props: { rotate: 0 } }, { t: .2, props: { rotate: -8 } }, { t: .4, props: { rotate: 7 } }, { t: .6, props: { rotate: -4 } }, { t: .8, props: { rotate: 2 } }, { t: 1, props: { rotate: 0 } }] },
    'shimmer-sweep':  { phase: 'emphasis', cat: 'light', targets: ['text', 'gold'], duration: 1600, ease: 'sineInOut', from: { shimmer: -0.3 }, to: { shimmer: 1.3 }, note: 'Light band crossing gold text once.' },

    // ---------- LOOPS (periodic => seamless) ----------
    'float':          { phase: 'loop', cat: 'loop', targets: ['object', 'icon'], loop: { period: 4000, wave: 'sine', props: { y: [0, -12] } }, params: { amplitude: { default: 1, min: 0, max: 3 } } },
    'breathe':        { phase: 'loop', cat: 'loop', targets: ['object', 'seal', 'badge'], loop: { period: 3000, wave: 'pulse', props: { scale: [1, 0.04] } }, params: { amplitude: { default: 1, min: 0, max: 3 } } },
    'sway':           { phase: 'loop', cat: 'loop', targets: ['sprig', 'lantern', 'flower'], loop: { period: 5000, wave: 'sine', props: { rotate: [0, 3] } }, params: { amplitude: { default: 1, min: 0, max: 3 } }, note: 'Pivot at top for lanterns, bottom for sprigs.' },
    'twinkle':        { phase: 'loop', cat: 'loop', targets: ['sparkle', 'star'], loop: { period: 1800, wave: 'pulse', props: { opacity: [1, -0.75], scale: [1, -0.25] } }, params: { amplitude: { default: 1, min: 0, max: 1 } } },
    'spin-slow':      { phase: 'loop', cat: 'loop', targets: ['ornament', 'star'], loop: { period: 20000, wave: 'saw', props: { rotate: [0, 360] } } },
    'shimmer-loop':   { phase: 'loop', cat: 'loop', targets: ['gold text'], loop: { period: 3500, wave: 'saw', props: { shimmer: [-0.3, 1.6] } }, note: 'Band exits frame before wrapping => seamless.' },
    'ken-burns':      { phase: 'loop', cat: 'image', targets: ['image', 'background'], loop: { period: 16000, wave: 'tri', props: { scale: [1.04, 0.08], x: [0, -20] } }, note: 'Triangle wave = ping-pong; seamless.' },
    'parallax-drift': { phase: 'loop', cat: 'image', targets: ['layer'], loop: { period: 10000, wave: 'sine', props: { x: [0, 16] } }, params: { amplitude: { default: 1, min: -3, max: 3 } }, note: 'Different amplitude per depth layer.' },

    // ---------- TRANSITION HALVES (no opacity: both panels stay solid) ----------
    'push-in-start':  { phase: 'entrance', cat: 'transition', targets: ['page', 'panel'], duration: 800, ease: 'quartInOut', params: { distance: { default: 1080 } }, from: { x: '$distance' }, to: { x: 0 } },
    'push-out-end':   { phase: 'exit', cat: 'transition', targets: ['page', 'panel'], duration: 800, ease: 'quartInOut', params: { distance: { default: 1080 } }, from: { x: 0 }, to: { x: '-$distance' } },

    // ---------- EXITS ----------
    'fade-out':       { phase: 'exit', cat: 'fade', targets: ['any'], duration: 500, ease: 'cubicIn', from: { opacity: 1 }, to: { opacity: 0 } },
    'slide-out-end':  { phase: 'exit', cat: 'slide', targets: ['any'], duration: 600, ease: 'emphasizedAccelerate', params: { distance: { default: 120 } }, from: { opacity: 1, x: 0 }, to: { opacity: 0, x: '-$distance' } },
    'shrink-out':     { phase: 'exit', cat: 'scale', targets: ['any'], duration: 450, ease: 'cubicIn', from: { opacity: 1, scale: 1 }, to: { opacity: 0, scale: 0.6 } },
    'dissolve-out':   { phase: 'exit', cat: 'blur', targets: ['text', 'image'], duration: 700, ease: 'cubicIn', from: { opacity: 1, blur: 0 }, to: { opacity: 0, blur: 14 } },
  };
  for (const k in P) P[k].id = k;
  root.PRESETS = P;
  if (typeof module !== 'undefined') module.exports = P;
})(typeof window !== 'undefined' ? window : globalThis);
