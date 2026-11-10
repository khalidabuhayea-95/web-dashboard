# Raster-cost proxy using Skia (same 2D engine as Compose Multiplatform/Skiko on iOS & desktop;
# Android Compose draws through hwui, also Skia-based). CPU raster surface => pessimistic vs device GPU.
import skia, time, math, random, json, statistics as st
W, H = 1080, 1920
FONT = skia.Font(skia.Typeface.MakeFromFile('/home/claude/motion/fonts/Amiri-Regular.ttf'), 64)
HERO = skia.Font(skia.Typeface.MakeFromFile('/home/claude/motion/fonts/ArefRuqaa-Bold.ttf'), 220)
blobs = [skia.TextBlob.MakeFromShapedText('وجعل بينكم مودة ورحمة', FONT) if hasattr(skia.TextBlob, 'MakeFromShapedText') else skia.TextBlob('text', FONT)]
try:
    shaper = skia.Shaper.Make()
except Exception:
    shaper = None
def shaped(txt, font):
    if shaper is None: return skia.TextBlob(txt, font)
    b = skia.TextBlobBuilderRunHandler(txt, skia.Point(0, 0))
    shaper.shape(txt, font, False, 10000, b)  # leftToRight=False => RTL
    return b.makeBlob()
lines = [shaped(t, FONT) for t in ['بسم الله الرحمن الرحيم', 'يسرّنا دعوتكم لتشريفنا وحضور', 'الخميس ١٥ نوفمبر ٢٠٣٠', 'قاعة الفخامة — عمّان']] * 3
hero = shaped('عقد قران', HERO)
bg = skia.Surface(W, H); c0 = bg.getCanvas(); c0.clear(0xFF1A140E)
p = skia.Paint(Shader=skia.GradientShader.MakeRadial((540, 700), 1200, [0xFF3A2C1C, 0xFF0B0907]))
c0.drawRect(skia.Rect(0, 0, W, H), p); bgimg = bg.makeImageSnapshot()

def scene(case, t):
    surf = skia.Surface(W, H); c = surf.getCanvas()
    c.drawImage(bgimg, 0, 0)
    ph = 2 * math.pi * (t % 6000) / 6000
    if case in ('gradient_particles',):
        for i, (col, o) in enumerate([(0xCC5B5CFF, 0), (0xCCFF3D7F, 2.1), (0xCC18D6C6, 4.2)]):
            x = 540 + 340 * math.cos(ph + o); y = 960 + 520 * math.sin(ph + o * 1.3)
            c.drawRect(skia.Rect(0, 0, W, H), skia.Paint(Shader=skia.GradientShader.MakeRadial((x, y), 840, [col, col & 0x00FFFFFF])))
        r = random.Random(7); pt = skia.Paint(AntiAlias=True, Color=0xCCFFFFFF)
        for i in range(90):
            bx, by, sp, sz = r.random() * W, r.random(), 1 + int(r.random() * 2), 2 + r.random() * 5
            c.drawCircle(bx, ((by - sp * (t % 6000) / 6000) % 1) * H, sz, pt)
        return surf
    gold = skia.Paint(AntiAlias=True, Shader=skia.GradientShader.MakeLinear([(0, 0), (900, 0)], [0xFF9C7A2F, 0xFFF3DC96, 0xFFB8913C]))
    for i, b in enumerate(lines):
        c.save(); k = min(1, max(0, (t - i * 120) / 700)); e = 1 - (1 - k) ** 3
        c.translate(980, 300 + i * 120 + (1 - e) * 40);
        pa = skia.Paint(AntiAlias=True, Color=0xFFEFE3C8); pa.setAlphaf(e)
        if case == 'text_blur' and i < 4: pa.setImageFilter(skia.ImageFilters.Blur((1 - e) * 10 + 0.01, (1 - e) * 10 + 0.01))
        c.drawTextBlob(b, -b.bounds().width(), 0, pa); c.restore()
    c.save()
    if case == 'clip_reveal':
        k = (t % 1400) / 1400; c.clipRect(skia.Rect(0, 400 + (1 - k) * 300, W, 700))
    c.translate(540, 650); s = 1 + 0.02 * math.sin(ph); c.scale(s, s)
    c.drawTextBlob(hero, -hero.bounds().width() / 2, 0, gold); c.restore()
    if case == 'shimmer':
        sh = skia.Paint(AntiAlias=True, BlendMode=skia.BlendMode.kSrcATop if False else skia.BlendMode.kPlus,
                        Shader=skia.GradientShader.MakeLinear([((t % 3500) / 3500 * 1500 - 300, 0), ((t % 3500) / 3500 * 1500, 0)], [0x00FFFFFF, 0x66FFF5DC, 0x00FFFFFF]))
        c.drawRect(skia.Rect(0, 400, W, 700), sh)
    if case == 'fullscreen_blur':
        img = surf.makeImageSnapshot(); c.drawImage(img, 0, 0, skia.SamplingOptions(), skia.Paint(ImageFilter=skia.ImageFilters.Blur(12, 12)))
    return surf

res = {}
for case in ['text_transform_alpha', 'text_blur', 'clip_reveal', 'shimmer', 'gradient_particles', 'fullscreen_blur']:
    for i in range(5): scene(case, i * 16.67)  # warmup
    ts = []
    for i in range(90):
        t0 = time.perf_counter(); s = scene(case, i * 16.67); s.flushAndSubmit() if hasattr(s, 'flushAndSubmit') else None; ts.append((time.perf_counter() - t0) * 1000)
    ts.sort(); res[case] = {'p50_ms': round(ts[45], 2), 'p95_ms': round(ts[int(.95 * 90)], 2), 'fits60fps': ts[int(.95 * 90)] < 16.7}
    scene(case, 900).makeImageSnapshot().save(f'/home/claude/motion/out/skia-{case}.png') if case in ('text_blur', 'gradient_particles') else None
print(json.dumps(res, indent=1))
json.dump(res, open('/home/claude/motion/out/skia-bench.json', 'w'), indent=1)
