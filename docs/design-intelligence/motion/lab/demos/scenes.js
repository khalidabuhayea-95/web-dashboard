/* 14 benchmark scenes (13 styles + 1 diagnostic). Stage 540x960. Times in ms. */
(function () {
  const gold = '#e3c27a';
  // seeded RNG for deterministic particles
  const rng = s => () => (s = (s * 16807) % 2147483647) / 2147483647;
  const goldFrame = `<svg width="540" height="960" viewBox="0 0 540 960"><g fill="none" stroke="${gold}" stroke-width="2">
    <rect data-draw x="30" y="30" width="480" height="900" rx="6"/><rect data-draw x="42" y="42" width="456" height="876" rx="4" stroke-width="1"/></g></svg>`;
  const divider = c => `<svg width="300" height="40" viewBox="0 0 300 40"><g fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round">
    <path data-draw d="M10 20 H120 M180 20 H290"/><path data-draw d="M150 6 C138 14 138 26 150 34 C162 26 162 14 150 6 Z"/><circle data-draw cx="128" cy="20" r="3"/><circle data-draw cx="172" cy="20" r="3"/></g></svg>`;
  const sparkle = (c, s) => `<svg width="${s}" height="${s}" viewBox="0 0 40 40"><path d="M20 0 C21 14 26 19 40 20 C26 21 21 26 20 40 C19 26 14 21 0 20 C14 19 19 14 20 0Z" fill="${c}"/></svg>`;
  const star8 = (c) => `<svg width="420" height="420" viewBox="-110 -110 220 220"><g fill="none" stroke="${c}" stroke-width="1.4">
    <polygon data-draw points="0,-100 29,-71 71,-71 71,-29 100,0 71,29 71,71 29,71 0,100 -29,71 -71,71 -71,29 -100,0 -71,-29 -71,-71 -29,-71"/>
    <rect data-draw x="-70" y="-70" width="140" height="140"/><rect data-draw x="-70" y="-70" width="140" height="140" transform="rotate(45)"/>
    <circle data-draw r="46"/></g></svg>`;
  const lantern = c => `<svg width="70" height="170" viewBox="0 0 70 170"><g stroke="${c}" stroke-width="2" fill="none"><line x1="35" y1="0" x2="35" y2="40"/>
    <path d="M22 40 h26 l6 14 h-38z" fill="${c}"/><path d="M16 54 h38 l-4 70 h-30z" fill="rgba(255,190,90,.25)"/><path d="M20 124 h30 l-6 14 h-18z" fill="${c}"/><line x1="35" y1="70" x2="35" y2="108"/></g></svg>`;

  window.SCENES = {
    // 1 — Luxury Arabic wedding (Andalusi/Wedvite-grade): controlled, slow, staggered by role
    'luxury-wedding-ar': {
      duration: 8000, bg: 'radial-gradient(ellipse at 50% 35%, #2a2218 0%, #0b0907 70%)',
      elements: [
        { key: 'frame', html: goldFrame, style: 'left:0;top:0' },
        { key: 'bism', cls: 'c', text: 'بسم الله الرحمن الرحيم', style: `top:150px;font:26px Amiri;color:${gold}` },
        { key: 'hero', cls: 'c gold', text: 'عقد قران', style: 'top:215px;font:112px Ruqaa;line-height:1.3' },
        { key: 'sh', cls: 'c sh', html: '', style: 'top:215px;font:112px Ruqaa;line-height:1.3;color:transparent', custom: (n, p) => { if (!n.dataset.t) { n.dataset.t = 'عقد قران'; n.textContent = 'عقد قران'; } } },
        { key: 'intro', cls: 'c', text: 'يسرّنا دعوتكم لتشريفنا وحضور', style: 'top:420px;font:24px Amiri;color:#efe3c8', split: 'word' },
        { key: 'groom', text: 'أحمد', style: 'top:480px;left:300px;width:170px;text-align:center;font:58px Ruqaa;color:#f6e9c9' },
        { key: 'amp', cls: 'c', text: '&', style: `top:500px;font:34px Cormorant;color:${gold}` },
        { key: 'bride', text: 'سارة', style: 'top:480px;left:70px;width:170px;text-align:center;font:58px Ruqaa;color:#f6e9c9' },
        { key: 'div', html: divider(gold), style: 'left:120px;top:590px' },
        { key: 'date', cls: 'c', text: 'الخميس ١٥ نوفمبر ٢٠٣٠ • الثامنة مساءً', style: 'top:650px;font:22px Amiri;color:#efe3c8' },
        { key: 'venue', cls: 'c', text: 'قاعة الفخامة — عمّان', style: 'top:690px;font:22px Amiri;color:#cdb98f' },
        { key: 'sp1', html: sparkle('#f7e3a6', 26), style: 'left:395px;top:220px' },
        { key: 'sp2', html: sparkle('#f7e3a6', 16), style: 'left:120px;top:300px' },
        { key: 'sp3', html: sparkle('#f7e3a6', 12), style: 'left:430px;top:330px' },
      ],
      tracks: [
        { el: 'frame', preset: 'draw-stroke', at: 0, params: { duration: 1800 } },
        { el: 'bism', preset: 'fade-in', at: 300, params: { duration: 900 } },
        { el: 'hero', preset: 'mask-reveal-up', at: 600, params: { duration: 1400, ease: 'silk' } },
        { el: 'sh', preset: 'shimmer-loop', at: 2200, length: 6000 },
        { el: 'intro', preset: 'blur-in', at: '>-500', stagger: { each: 110 }, params: { radius: 10, duration: 700 } },
        { el: 'groom', preset: 'drift-in', at: '>-200', params: { distance: 40 } },
        { el: 'bride', preset: 'drift-in', at: '<', params: { distance: -40 } },
        { el: 'amp', preset: 'fade-in', at: '<400' },
        { el: 'div', preset: 'draw-stroke', at: '<300', params: { duration: 1200 } },
        { el: 'date', preset: 'fade-up', at: '<500', params: { distance: 16, duration: 900 } },
        { el: 'venue', preset: 'fade-up', at: '<150', params: { distance: 16, duration: 900 } },
        { el: 'sp1', preset: 'fade-in', at: 1800 }, { el: 'sp2', preset: 'fade-in', at: 2400 }, { el: 'sp3', preset: 'fade-in', at: 2900 },
        { el: 'sp1', preset: 'twinkle', at: 2000, length: 6000 },
        { el: 'sp2', preset: 'twinkle', at: 2600, length: 6000, params: { period: 2300 } },
        { el: 'sp3', preset: 'twinkle', at: 3100, length: 6000, params: { period: 1500 } },
      ]
    },

    // 2 — Arabic word stagger (RTL): units = words, order = reading order (right->left)
    'arabic-word-stagger': {
      duration: 5000, bg: 'linear-gradient(160deg,#f4eee2,#e8dcc6)',
      elements: [
        { key: 'l1', cls: 'c', text: 'وجعل بينكم مودة ورحمة', style: 'top:330px;font:54px Amiri;color:#5b4128', split: 'word' },
        { key: 'l2', cls: 'c', text: 'سورة الروم — ٢١', style: 'top:430px;font:24px Amiri;color:#8a6a3e', split: 'word' },
        { key: 'cap', cls: 'c', text: 'WORD-LEVEL SPLIT • RTL ORDER', style: 'top:880px;font:600 13px Cairo;letter-spacing:3px;color:#b39b74' },
      ],
      tracks: [
        { el: 'l1', preset: 'fade-up', at: 300, stagger: { each: 180, from: 'start' }, params: { distance: 24, duration: 900 } },
        { el: 'l2', preset: 'blur-in', at: '>-200', stagger: { each: 120 }, params: { radius: 8 } },
        { el: 'cap', preset: 'fade-in', at: '>' },
      ]
    },

    // 3 — Diagnostic: per-letter split on Arabic (shows broken joining)
    'arabic-letter-split-test': {
      duration: 1000, bg: '#fff',
      elements: [
        { key: 'ok', cls: 'c', text: 'محمد ومريم', style: 'top:250px;font:64px Amiri;color:#222' },
        { key: 'bad', cls: 'c', text: 'محمد ومريم', style: 'top:420px;font:64px Amiri;color:#b00', split: 'letter' },
        { key: 'l1', cls: 'c', text: 'whole text (correct shaping)', style: 'top:350px;font:16px Cairo;color:#666' },
        { key: 'l2', cls: 'c', text: 'split per letter, no dir → joins break + order reversed', style: 'top:520px;font:16px Cairo;color:#b00' },
        { key: 'bad2', cls: 'c', text: 'محمد ومريم', style: 'top:600px;font:64px Amiri;color:#b06000;direction:rtl', split: 'letter' },
        { key: 'l3', cls: 'c', text: 'split per letter + dir=rtl → order ok, joins still break', style: 'top:700px;font:16px Cairo;color:#b06000' },
      ],
      tracks: [{ el: 'ok', preset: 'fade-in', at: 0, params: { duration: 1 } }]
    },

    // 4 — Typewriter (Latin) + caret blink
    'typewriter-latin': {
      duration: 5000, bg: '#0f1115',
      elements: [
        { key: 'tw', text: 'Launch day is here.', style: 'left:40px;top:420px;font:600 44px Cairo;color:#fff;direction:ltr', split: 'letter' },
        { key: 'caret', html: '', style: 'left:40px;top:428px;width:3px;height:52px;background:#4ad9ff', custom: (n, p, t) => { const typed = Math.max(0, Math.min(19, Math.floor((t - 300) / 70) + 1)); const spans = document.querySelectorAll('#stage .w'); const s = spans[typed - 1]; n.style.left = (s ? 40 + s.offsetLeft + s.offsetWidth + 3 : 40) + 'px'; n.style.opacity = Math.floor(t / 530) % 2 ? 0 : 1; } },
      ],
      tracks: [{ el: 'tw', preset: 'typewriter', at: 300, stagger: { each: 70 } }]
    },

    // 5 — Jitter "Snappy Text Stretch"
    'snappy-stretch': {
      duration: 4000, bg: '#000',
      elements: [
        { key: 'a', text: 'All Eyes on', style: 'left:44px;top:120px;font:700 52px Cairo;color:#fff;transform-origin:50% 100%', split: 'word' },
        { key: 'b', text: 'Independents', style: 'left:44px;top:185px;font:700 52px Cairo;color:#fff;transform-origin:50% 100%' },
        { key: 'c', text: 'January', style: 'left:44px;top:330px;font:700 52px Cairo;color:#fff;transform-origin:50% 100%' },
        { key: 'd', text: '19 - 21', style: 'left:44px;top:395px;font:700 52px Cairo;color:#fff;transform-origin:50% 100%', split: 'word' },
      ],
      tracks: [
        { el: 'a', preset: 'stretch-snap', at: 200, stagger: { each: 70 } },
        { el: 'b', preset: 'stretch-snap', at: '<210' },
        { el: 'c', preset: 'stretch-snap', at: '<250' },
        { el: 'd', preset: 'stretch-snap', at: '<120', stagger: { each: 70 } },
        { el: 'a', preset: 'shrink-out', at: 3300, stagger: { each: 40 } },
        { el: 'b', preset: 'shrink-out', at: '<60' }, { el: 'c', preset: 'shrink-out', at: '<60' }, { el: 'd', preset: 'shrink-out', at: '<60', stagger: { each: 40 } },
      ]
    },

    // 6 — Sale / product ad: energetic, overshoot, count-up, CTA emphasis
    'sale-pop': {
      duration: 6000, bg: 'linear-gradient(170deg,#ff5a36,#c2185b)',
      elements: [
        { key: 'h', cls: 'c', text: 'تخفيضات الجمعة', style: 'top:170px;font:64px Lalezar;color:#fff' },
        { key: 'badge', html: '<div style="width:230px;height:230px;border-radius:50%;background:#ffe14d;display:flex;align-items:center;justify-content:center;flex-direction:column;box-shadow:0 10px 30px rgba(0,0,0,.25)"><div id="pct" style="font:96px Lalezar;color:#c2185b;line-height:1">٥٠٪</div><div style="font:26px Lalezar;color:#c2185b">خصم</div></div>', style: 'left:155px;top:300px' },
        { key: 'num', cls: 'c', text: '0', style: 'top:580px;font:72px Lalezar;color:#fff', custom: (n, p) => { const v = Math.round((p.value ?? 0) * 199); n.textContent = v + ' JD'; } },
        { key: 'cta', html: '<div style="padding:16px 46px;border-radius:40px;background:#fff;color:#c2185b;font:30px Lalezar">تسوّق الآن</div>', style: 'left:150px;top:760px' },
      ],
      tracks: [
        { el: 'h', preset: 'stretch-snap', at: 100 },
        { el: 'badge', preset: 'pop-spring', at: '<250' },
        { el: 'badge', preset: 'breathe', at: 1500, length: 4500, params: { amplitude: 0.8 } },
        { el: 'num', preset: 'count-up', at: 700 },
        { el: 'num', preset: 'fade-up', at: 700, params: { distance: 30 } },
        { el: 'cta', preset: 'pop', at: 1500 },
        { el: 'cta', preset: 'pulse-once', at: 2600 },
        { el: 'cta', preset: 'wiggle', at: 4200 },
      ]
    },

    // 7 — Product reveal: Ken Burns bg + parallax layers + float + mask title
    'product-kenburns': {
      duration: 8000, bg: '#1b1410',
      elements: [
        { key: 'bg', html: '<div style="width:540px;height:960px;background:radial-gradient(circle at 30% 30%,#7a4a2a,#2a1a10 60%),repeating-linear-gradient(45deg,rgba(255,255,255,.03) 0 8px,transparent 8px 16px)"></div>', style: 'left:0;top:0' },
        { key: 'l1', html: '<div style="width:700px;height:180px;border-radius:50%;background:rgba(255,200,150,.12);filter:blur(20px)"></div>', style: 'left:-80px;top:650px' },
        { key: 'prod', html: '<div style="width:130px;height:300px;border-radius:24px 24px 30px 30px;background:linear-gradient(90deg,#3b1f12,#c27a45 45%,#5a2f18);box-shadow:0 30px 60px rgba(0,0,0,.6)"><div style="width:60px;height:46px;margin:-40px auto 0;border-radius:8px;background:#d9b27a"></div></div>', style: 'left:205px;top:380px' },
        { key: 't', cls: 'c', text: 'عطر العود', style: 'top:150px;font:76px ReemKufi;font-weight:700;color:#f3dcb8' },
        { key: 's', cls: 'c', text: 'إصدار محدود', style: 'top:255px;font:26px Tajawal;color:#d3b48c;letter-spacing:0' },
      ],
      tracks: [
        { el: 'bg', preset: 'ken-burns', at: 0, length: 8000, params: { period: 16000 } },
        { el: 'l1', preset: 'parallax-drift', at: 0, length: 8000, params: { amplitude: -1.5 } },
        { el: 'prod', preset: 'fade-up', at: 300, params: { distance: 120, duration: 1400, ease: 'quartOut' } },
        { el: 'prod', preset: 'float', at: 1700, length: 6300 },
        { el: 't', preset: 'mask-reveal-up', at: 900 },
        { el: 's', preset: 'fade-in', at: '>-300' },
      ]
    },

    // 8 — Transitions: crossfade, push, wipe, zoom, split-strips between 5 panels
    'transitions': {
      duration: 10000, bg: '#000',
      elements: ['#c0392b', '#2471a3', '#1e8449', '#7d3c98', '#b9770e', '#17202a'].map((c, i) => ({ key: 'p' + i, html: `<div style="width:540px;height:960px;background:${c};display:flex;align-items:center;justify-content:center;font:80px Lalezar;color:#fff">${['١', '٢', '٣', '٤', '٥', '٦'][i]}</div>`, style: 'left:0;top:0' })),
      tracks: [
        // crossfade 0->1 @1.2s
        { el: 'p1', preset: 'fade-in', at: 1200, params: { duration: 700, ease: 'sineInOut' } },
        // push 1->2 @2.9s (RTL push: new comes from start=right)
        { el: 'p1', preset: 'push-out-end', at: 2900 },
        { el: 'p2', preset: 'push-in-start', at: '<' },
        // wipe 2->3 @4.6s
        { el: 'p3', preset: 'wipe-start', at: 4600, params: { duration: 900 } },
        // zoom 3->4 @6.3s
        { el: 'p3', preset: 'shrink-out', at: 6300, params: { duration: 500 } },
        { el: 'p4', preset: 'zoom-in', at: '<200', params: { duration: 800 } },
        // iris 4->5 @8s
        { el: 'p5', preset: 'iris-in', at: 8000 },
      ],
      init: { p1: 0, p2: 0, p3: 0, p4: 0, p5: 0 }
    },

    // 9 — 3D card flip
    'card-flip-3d': {
      duration: 5000, bg: '#0c0c10',
      elements: [
        { key: 'card', html: '<div style="width:300px;height:420px;border-radius:24px;background:linear-gradient(135deg,#7b2ff7,#b47cff);box-shadow:0 30px 70px rgba(123,47,247,.45);display:flex;align-items:flex-end;padding:28px;box-sizing:border-box;font:700 46px Cairo;color:#fff">Pay</div>', style: 'left:120px;top:270px' },
      ],
      tracks: [
        { el: 'card', preset: 'flip-in-y', at: 200, params: { duration: 1200 } },
        { el: 'card', preset: 'float', at: 1400, length: 3600, params: { amplitude: 0.8 } },
      ]
    },

    // 10 — Gradient flow + particles (pure loop, period = 6000ms)
    'gradient-particles-loop': {
      duration: 6000, bg: '#0a0a1a',
      elements: [
        { key: 'g', type: 'canvas', style: 'left:0;top:0', draw: (cx, p, t) => {
          const T = 6000, ph = 2 * Math.PI * (t % T) / T;
          cx.clearRect(0, 0, 540, 960);
          const blobs = [['#5b5cff', 0], ['#ff3d7f', 2.1], ['#18d6c6', 4.2]];
          for (const [c, o] of blobs) { const x = 270 + 170 * Math.cos(ph + o), y = 480 + 260 * Math.sin(ph * 1 + o * 1.3); const g = cx.createRadialGradient(x, y, 0, x, y, 420); g.addColorStop(0, c + 'cc'); g.addColorStop(1, c + '00'); cx.fillStyle = g; cx.fillRect(0, 0, 540, 960); }
          const r = rng(7);
          for (let i = 0; i < 90; i++) { const bx = r() * 540, by = r(), sp = 1 + Math.floor(r() * 2), sz = 1 + r() * 2.5; const y = ((by - sp * (t % T) / T) % 1 + 1) % 1 * 960; const a = .35 + .65 * (0.5 + 0.5 * Math.sin(ph * 3 + i)); cx.fillStyle = `rgba(255,255,255,${a})`; cx.beginPath(); cx.arc(bx + 6 * Math.sin(ph + i), y, sz, 0, 7); cx.fill(); }
        } },
        { key: 't', cls: 'c', text: 'Seamless loop', style: 'top:440px;font:700 44px Cairo;color:#fff' },
      ],
      tracks: [{ el: 't', preset: 'float', at: 0, length: 6000, params: { period: 6000, amplitude: 0.6 } }]
    },

    // 11 — Countdown bold: per-number in/out with blur + scale
    'countdown': {
      duration: 4000, bg: '#111',
      elements: ['٣', '٢', '١'].map((d, i) => ({ key: 'n' + i, cls: 'c', text: d, style: `top:260px;font:360px Lalezar;line-height:1.1;color:${['#ffd400', '#00e0ff', '#ff2e88'][i]}` })),
      tracks: [0, 1, 2].flatMap(i => [
        { el: 'n' + i, preset: 'zoom-in', at: 200 + i * 1200, params: { duration: 450 } },
        { el: 'n' + i, preset: 'dissolve-out', at: 200 + i * 1200 + 800, params: { duration: 350 } },
      ])
    },

    // 12 — Ramadan / Islamic geometric: draw-on pattern, lantern sway, shimmer title
    'islamic-ramadan': {
      duration: 8000, bg: 'radial-gradient(ellipse at 50% 30%, #13324f, #06121f 70%)',
      elements: [
        { key: 'star', html: star8('#d8b46a'), style: 'left:60px;top:150px;opacity:.9' },
        { key: 'lan1', html: lantern('#d8b46a'), style: 'left:60px;top:0;transform-origin:50% 0' },
        { key: 'lan2', html: lantern('#d8b46a'), style: 'left:410px;top:-30px;transform-origin:50% 0' },
        { key: 't', cls: 'c gold', text: 'رمضان كريم', style: 'top:600px;font:88px Rakkas' },
        { key: 'sh', cls: 'c sh', html: '', style: 'top:600px;font:88px Rakkas;color:transparent', custom: (n) => { if (!n.dataset.t) { n.dataset.t = 'رمضان كريم'; n.textContent = 'رمضان كريم'; } } },
        { key: 's', cls: 'c', text: 'كل عام وأنتم بخير', style: 'top:730px;font:28px Amiri;color:#e9dcc0', split: 'word' },
      ],
      tracks: [
        { el: 'star', preset: 'draw-stroke', at: 0, params: { duration: 2600 } },
        { el: 'star', preset: 'spin-slow', at: 2600, length: 5400, params: { period: 60000 } },
        { el: 'lan1', preset: 'fade-down', at: 300, params: { distance: 60, duration: 1200 } },
        { el: 'lan2', preset: 'fade-down', at: '<250', params: { distance: 60, duration: 1200 } },
        { el: 'lan1', preset: 'sway', at: 1500, length: 6500 },
        { el: 'lan2', preset: 'sway', at: 1750, length: 6250, params: { period: 5600 } },
        { el: 't', preset: 'settle-in', at: 1200 },
        { el: 'sh', preset: 'shimmer-loop', at: 2800, length: 5200 },
        { el: 's', preset: 'fade-up', at: 2200, stagger: { each: 140 }, params: { distance: 20 } },
      ]
    },

    // 13 — Cinematic promo: glitch title, light sweep, letterbox wipe
    'cinematic-glitch': {
      duration: 5000, bg: '#050505',
      elements: [
        { key: 'bars', html: '<div style="position:absolute;left:0;top:0;width:540px;height:110px;background:#000"></div><div style="position:absolute;left:0;top:850px;width:540px;height:110px;background:#000"></div>', style: 'left:0;top:0;width:540px;height:960px;z-index:5' },
        { key: 'leak', html: '<div style="width:900px;height:960px;background:linear-gradient(100deg,transparent 35%,rgba(255,150,60,.35) 50%,transparent 65%)"></div>', style: 'left:-900px;top:0', custom: (n, p, t) => { n.style.left = (-900 + (t % 5000) / 5000 * 1500) + 'px'; } },
        { key: 't', cls: 'c', text: 'الموسم الجديد', style: 'top:390px;font:84px ReemKufi;font-weight:700;color:#fff', },
        { key: 's', cls: 'c', text: 'قريباً — 2030', style: 'top:510px;font:600 26px Cairo;color:#bbb' },
      ],
      tracks: [
        { el: 'bars', preset: 'fade-in', at: 0, params: { duration: 400 } },
        { el: 't', preset: 'glitch-in', at: 500, params: { duration: 900 } },
        { el: 's', preset: 'wipe-start', at: 1500 },
        { el: 't', preset: 'dissolve-out', at: 4300 },
        { el: 's', preset: 'fade-out', at: '<' },
      ]
    },

    // 14 — Education steps: clear sequential, low-amplitude, readable
    'education-steps': {
      duration: 6000, bg: '#f7f9fc',
      elements: [
        { key: 'h', cls: 'c', text: 'خطوات نوم صحي', style: 'top:110px;font:700 46px Cairo;color:#1d3557' },
        ...[0, 1, 2, 3].map(i => ({ key: 'r' + i, html: `<div style="display:flex;flex-direction:row-reverse;align-items:center;gap:18px;width:440px"><div style="width:58px;height:58px;border-radius:16px;background:${['#e63946', '#f4a261', '#2a9d8f', '#457b9d'][i]};color:#fff;font:700 30px Cairo;display:flex;align-items:center;justify-content:center">${i + 1}</div><div style="font:600 26px Cairo;color:#1d3557;text-align:right;flex:1">${['ثبّت موعد النوم', 'أطفئ الشاشات قبل ساعة', 'اجعل الغرفة مظلمة وباردة', 'تجنّب الكافيين مساءً'][i]}</div></div>`, style: `left:50px;top:${250 + i * 120}px` })),
        { key: 'bar', html: '<div style="width:440px;height:10px;border-radius:5px;background:#2a9d8f"></div>', style: 'left:50px;top:780px' },
      ],
      tracks: [
        { el: 'h', preset: 'fade-down', at: 200, params: { distance: 20 } },
        ...[0, 1, 2, 3].map(i => ({ el: 'r' + i, preset: 'slide-in-start', at: i ? '<350' : '>-300', params: { distance: 60, duration: 700 } })),
        { el: 'bar', preset: 'wipe-start', at: '>', params: { duration: 1400, ease: 'cubicInOut' } },
      ]
    },
  };
})();
