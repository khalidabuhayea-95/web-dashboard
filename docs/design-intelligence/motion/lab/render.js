// Renders every scene deterministically (frame-by-frame) to MP4 + contact sheet,
// then measures real-time playback (rAF pacing + JS cost) at 1x and throttled CPU.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const ROOT = __dirname, OUT = path.join(ROOT, 'out');
const only = process.argv[2] ? process.argv[2].split(',') : null;
const FPS = 30;

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  // discover scenes
  await page.goto('file://' + ROOT + '/demos/stage.html?scene=luxury-wedding-ar');
  const ids = (await page.evaluate(() => Object.keys(SCENES))).filter(i => !only || only.includes(i));
  const results = {};
  for (const id of ids) {
    const dir = path.join(OUT, 'frames', id); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    await page.goto(`file://${ROOT}/demos/stage.html?scene=${id}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    const dur = await page.evaluate(() => window.__duration);
    const n = Math.round(dur / 1000 * FPS);
    const stage = await page.$('#stage');
    for (let i = 0; i <= n; i++) {
      await page.evaluate(t => window.__seek(t), Math.min(dur - 1, i * 1000 / FPS));
      await stage.screenshot({ path: path.join(dir, String(i).padStart(4, '0') + '.png') });
    }
    execSync(`ffmpeg -y -loglevel error -framerate ${FPS} -i ${dir}/%04d.png -c:v libx264 -pix_fmt yuv420p -crf 20 ${OUT}/${id}.mp4`);
    // contact sheet: 8 evenly spaced frames
    const picks = [...Array(8)].map((_, k) => String(Math.round(k * n / 7)).padStart(4, '0'));
    execSync(`ffmpeg -y -loglevel error ${picks.map(p => `-i ${dir}/${p}.png`).join(' ')} -filter_complex "${picks.map((_, k) => `[${k}]scale=180:320[s${k}]`).join(';')};${picks.map((_, k) => `[s${k}]`).join('')}hstack=inputs=8" ${OUT}/${id}-sheet.png`);
    // real-time pacing at 1x and 4x CPU throttle
    const cdp = await ctx.newCDPSession(page);
    const perf = {};
    for (const rate of [1, 4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      const r = await page.evaluate(ms => window.__play(ms), Math.min(dur, 6000));
      const st = a => { const s = [...a].sort((x, y) => x - y); const q = p => +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2); return { n: s.length, p50: q(.5), p95: q(.95), p99: q(.99), max: +s[s.length - 1].toFixed(1) }; };
      const dts = st(r.dts), cost = st(r.cost);
      const jank = r.dts.filter(d => d > 16.7 * 1.5).length / r.dts.length;
      perf['cpu' + rate + 'x'] = { frameDt: dts, jsCost: cost, jankPct: +(jank * 100).toFixed(1) };
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    results[id] = { durationMs: dur, frames: n + 1, perf };
    console.log(id, JSON.stringify(perf));
  }
  // loop seam test: frame(0) vs frame(period) must be identical for pure loop scene
  await page.goto(`file://${ROOT}/demos/stage.html?scene=gradient-particles-loop`); await page.evaluate(() => document.fonts.ready);
  const stage = await page.$('#stage');
  await page.evaluate(() => window.__seek(0)); const a = await stage.screenshot();
  await page.evaluate(() => window.__seek(6000)); const b = await stage.screenshot();
  await page.evaluate(() => window.__seek(3000)); const c = await stage.screenshot();
  fs.writeFileSync(OUT + '/seam-a.png', a); fs.writeFileSync(OUT + '/seam-b.png', b); fs.writeFileSync(OUT + '/seam-c.png', c);
  // reduced motion snapshots
  for (const t of [0, 250, 2000]) {
    await page.goto(`file://${ROOT}/demos/stage.html?scene=luxury-wedding-ar&reduced=1`); await page.evaluate(() => document.fonts.ready);
    await page.evaluate(t => window.__seek(t), t); await (await page.$('#stage')).screenshot({ path: `${OUT}/reduced-${t}.png` });
  }
  results._errors = errors;
  fs.writeFileSync(OUT + '/results.json', JSON.stringify(results, null, 1));
  await browser.close();
})();
