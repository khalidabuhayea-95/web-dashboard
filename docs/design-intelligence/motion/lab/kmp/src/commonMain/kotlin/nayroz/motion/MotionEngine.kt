package nayroz.motion

import kotlin.math.*

/**
 * Motion Engine (commonMain, pure Kotlin — no platform APIs).
 * 1:1 port of engine/motion-engine.js. Parity verified by ParityTest (JVM) against JS vectors.
 * UI binding (Compose graphicsLayer / drawWithContent) lives in the platform/UI layer, not here.
 */

typealias Easing = (Double) -> Double

object Easings {
    fun cubicBezier(x1: Double, y1: Double, x2: Double, y2: Double): Easing {
        val cx = 3 * x1; val bx = 3 * (x2 - x1) - cx; val ax = 1 - cx - bx
        val cy = 3 * y1; val by = 3 * (y2 - y1) - cy; val ay = 1 - cy - by
        fun sx(t: Double) = ((ax * t + bx) * t + cx) * t
        fun sy(t: Double) = ((ay * t + by) * t + cy) * t
        fun dx(t: Double) = (3 * ax * t + 2 * bx) * t + cx
        return fun(x: Double): Double {
            if (x <= 0) return 0.0; if (x >= 1) return 1.0
            var t = x
            repeat(8) {
                val e = sx(t) - x; if (abs(e) < 1e-6) return sy(t)
                val d = dx(t); if (abs(d) < 1e-6) return@repeat
                t -= e / d
            }
            var lo = 0.0; var hi = 1.0; t = x
            repeat(30) { val v = sx(t); if (abs(v - x) < 1e-6) return sy(t); if (x > v) lo = t else hi = t; t = (lo + hi) / 2 }
            return sy(t)
        }
    }
    private fun powOut(n: Double): Easing = { t -> 1 - (1 - t).pow(n) }
    private fun powIn(n: Double): Easing = { t -> t.pow(n) }
    private fun powInOut(n: Double): Easing = { t -> if (t < .5) (2 * t).pow(n) / 2 else 1 - (2 - 2 * t).pow(n) / 2 }
    private fun backOut(s: Double): Easing = { t0 -> val t = t0 - 1; t * t * ((s + 1) * t + s) + 1 }
    private fun elasticOut(a: Double, p: Double): Easing = { t ->
        if (t == 0.0 || t == 1.0) t else { val A = max(1.0, a); val s = p / (2 * PI) * asin(1 / A); A * 2.0.pow(-10 * t) * sin((t - s) * (2 * PI) / p) + 1 }
    }
    val bounceOut: Easing = { t0 ->
        val n = 7.5625; val d = 2.75; var t = t0
        when {
            t < 1 / d -> n * t * t
            t < 2 / d -> { t -= 1.5 / d; n * t * t + .75 }
            t < 2.5 / d -> { t -= 2.25 / d; n * t * t + .9375 }
            else -> { t -= 2.625 / d; n * t * t + .984375 }
        }
    }
    /** Analytic damped spring (mass 1). Same parameters as Compose spring(dampingRatio, stiffness). */
    class Spring(val dampingRatio: Double, val stiffness: Double) {
        // NOTE: not implementing (Double)->Double: Kotlin/JS forbids implementing function types (found by the JS compile check)
        private val w0 = sqrt(stiffness); private val z = dampingRatio
        fun pos(t: Double): Double = when {
            z < 1 -> { val wd = w0 * sqrt(1 - z * z); 1 - exp(-z * w0 * t) * (cos(wd * t) + (z * w0 / wd) * sin(wd * t)) }
            z == 1.0 -> 1 - exp(-w0 * t) * (1 + w0 * t)
            else -> { val r1 = -w0 * (z - sqrt(z * z - 1)); val r2 = -w0 * (z + sqrt(z * z - 1)); val c2 = r1 / (r1 - r2); val c1 = 1 - c2; 1 - (c1 * exp(r1 * t) + c2 * exp(r2 * t)) }
        }
        val settleSec: Double = run {
            var found = 0.01; var t = 0.01
            while (t < 10) { var ok = true; for (k in 0 until 40) if (abs(1 - pos(t + k * 0.005)) > 0.001) { ok = false; break }; if (ok) { found = t; break }; t += 0.005 }
            found
        }
        operator fun invoke(x: Double): Double = if (x >= 1) 1.0 else pos(x * settleSec)
    }

    fun spring(z: Double, k: Double): Easing { val s = Spring(z, k); return { x -> s(x) } }

    val named: Map<String, Easing> = mapOf(
        "linear" to { t -> t },
        "ease" to cubicBezier(.25, .1, .25, 1.0),
        "sineInOut" to cubicBezier(.37, 0.0, .63, 1.0),
        "cubicOut" to powOut(3.0), "cubicIn" to powIn(3.0), "cubicInOut" to powInOut(3.0),
        "quartOut" to powOut(4.0), "quartInOut" to powInOut(4.0), "quintOut" to powOut(5.0),
        "expoOut" to { t -> if (t == 1.0) 1.0 else 1 - 2.0.pow(-10 * t) },
        "expoInOut" to { t -> if (t == 0.0 || t == 1.0) t else if (t < .5) 2.0.pow(20 * t - 10) / 2 else (2 - 2.0.pow(-20 * t + 10)) / 2 },
        "circOut" to { t -> sqrt(1 - (t - 1).pow(2)) },
        "backOut" to backOut(1.70158), "backOutSoft" to backOut(1.1), "backOutStrong" to backOut(2.4),
        "elasticOut" to elasticOut(1.0, .35), "bounceOut" to bounceOut,
        "emphasizedDecelerate" to cubicBezier(.05, .7, .1, 1.0),
        "emphasizedAccelerate" to cubicBezier(.3, 0.0, .8, .15),
        "standard" to cubicBezier(.2, 0.0, 0.0, 1.0),
        "silk" to cubicBezier(.22, .61, .36, 1.0),
        "springGentle" to spring(1.0, 120.0), "springSoft" to spring(.75, 200.0),
        "springBouncy" to spring(.5, 300.0), "springSnappy" to spring(.85, 600.0),
    )

    fun get(name: String?): Easing {
        if (name == null) return named.getValue("cubicOut")
        named[name]?.let { return it }
        Regex("""^cubicBezier\(([^)]+)\)$""").find(name)?.let { m -> val p = m.groupValues[1].split(',').map { it.trim().toDouble() }; return cubicBezier(p[0], p[1], p[2], p[3]) }
        Regex("""^steps\((\d+)\)$""").find(name)?.let { m -> val n = m.groupValues[1].toInt(); return { t -> min(1.0, floor(t * n) / max(1, n - 1)) } }
        Regex("""^spring\(([^)]+)\)$""").find(name)?.let { m -> val p = m.groupValues[1].split(',').map { it.trim().toDouble() }; return spring(p[0], p[1]) }
        error("Unknown ease $name")
    }
}

enum class Phase { ENTRANCE, EMPHASIS, LOOP, EXIT }
enum class Wave { SINE, SAW, TRI, PULSE }

/** A value is either a number or a "$param" / "-$param" reference. */
sealed interface V { data class Num(val v: Double) : V; data class Ref(val name: String, val sign: Double) : V }
fun V.resolve(p: Map<String, Double>): Double = when (this) { is V.Num -> v; is V.Ref -> sign * (p[name] ?: error("param $name")) }

data class Keyframe(val t: Double, val props: Map<String, V>, val ease: String? = null)
data class LoopSpec(val period: Double, val wave: Wave, val props: Map<String, Pair<Double, Double>>, val amplitude: Double = 1.0)
data class Param(val default: Double, val min: Double? = null, val max: Double? = null)

data class Preset(
    val id: String, val phase: Phase, val duration: Double = 0.0, val ease: String? = null,
    val from: Map<String, V> = emptyMap(), val to: Map<String, V> = emptyMap(),
    val keyframes: List<Keyframe>? = null, val loop: LoopSpec? = null,
    val params: Map<String, Param> = emptyMap(),
)

data class Stagger(val each: Double, val from: String = "start")
/** One timeline row. `at` follows GSAP position syntax subset: number, "<", ">", "<200", ">-300", "+=200", "-=200", label, label+=n. */
data class Track(
    val el: String = "", val preset: String = "", val at: Any? = null, val params: Map<String, Any> = emptyMap(),
    val units: Int = 1, val stagger: Stagger? = null, val length: Double? = null, val label: String? = null,
)
data class Scene(val duration: Double, val tracks: List<Track>)

class LaidTrack(val track: Track, val preset: Preset, val num: Map<String, Double>, val ease: String?, val start: Double, val dur: Double, val each: Double)

val DEFAULTS = mapOf("opacity" to 1.0, "x" to 0.0, "y" to 0.0, "scale" to 1.0, "scaleX" to 1.0, "scaleY" to 1.0, "rotate" to 0.0,
    "rotateX" to 0.0, "rotateY" to 0.0, "skewX" to 0.0, "blur" to 0.0, "clipT" to 0.0, "clipR" to 0.0, "clipB" to 0.0, "clipL" to 0.0,
    "draw" to 1.0, "shimmer" to -1.0, "brightness" to 1.0, "rgbSplit" to 0.0)
private val MULTIPLICATIVE = setOf("opacity", "scale", "scaleX", "scaleY", "brightness")
private val ABSOLUTE = setOf("draw", "shimmer")

object MotionEngine {
    private fun lerp(a: Double, b: Double, t: Double) = a + (b - a) * t

    fun evalPreset(p: Preset, tLocal: Double, num: Map<String, Double>, easeOverride: String?): Map<String, Double> {
        val dur = num["duration"] ?: p.duration
        p.loop?.let { lp ->
            val T = num["period"] ?: lp.period
            val ph = ((tLocal % T) + T) % T / T
            val amp = num["amplitude"] ?: lp.amplitude
            val s = when (lp.wave) { Wave.SINE -> sin(2 * PI * ph); Wave.SAW -> ph; Wave.TRI -> 1 - abs(2 * ph - 1); Wave.PULSE -> 0.5 - 0.5 * cos(2 * PI * ph) }
            return lp.props.mapValues { (_, bd) -> bd.first + bd.second * amp * s }
        }
        val t = (tLocal / dur).coerceIn(0.0, 1.0)
        p.keyframes?.let { kf ->
            var a = kf.first(); var b = kf.last()
            for (i in 0 until kf.size - 1) if (t >= kf[i].t && t <= kf[i + 1].t) { a = kf[i]; b = kf[i + 1]; break }
            val lt = if (b.t == a.t) 1.0 else (t - a.t) / (b.t - a.t)
            val e = Easings.get(b.ease ?: p.ease)(lt)
            return (a.props.keys + b.props.keys).associateWith { k ->
                lerp(a.props[k]?.resolve(num) ?: DEFAULTS[k]!!, b.props[k]?.resolve(num) ?: DEFAULTS[k]!!, e)
            }
        }
        val e = Easings.get(easeOverride ?: p.ease)(t)
        return (p.from.keys + p.to.keys).associateWith { k ->
            lerp(p.from[k]?.resolve(num) ?: DEFAULTS[k] ?: 0.0, p.to[k]?.resolve(num) ?: DEFAULTS[k] ?: 0.0, e)
        }
    }

    fun layout(scene: Scene, lib: Map<String, Preset>): List<LaidTrack> {
        var cursor = 0.0; var lastStart = 0.0; var lastEnd = 0.0
        val labels = mutableMapOf<String, Double>(); val out = mutableListOf<LaidTrack>()
        for (tr in scene.tracks) {
            if (tr.label != null) { labels[tr.label] = cursor; continue }
            val p = lib[tr.preset] ?: error("No preset ${tr.preset}")
            val num = p.params.mapValues { it.value.default }.toMutableMap()
            tr.params.forEach { (k, v) -> if (v is Number) num[k] = v.toDouble() }
            val ease = tr.params["ease"] as? String
            val dur = if (p.loop != null) (tr.length ?: scene.duration) else (num["duration"] ?: p.duration)
            val each = tr.stagger?.each ?: 0.0
            val total = dur + each * (tr.units - 1)
            val at = tr.at
            val start: Double = when {
                at == null || at == ">" -> lastEnd
                at is Number -> at.toDouble()
                at == "<" -> lastStart
                at is String && Regex("""^<[-+]?\d+""").containsMatchIn(at) -> lastStart + at.drop(1).toDouble()
                at is String && Regex("""^>[-+]?\d+""").containsMatchIn(at) -> lastEnd + at.drop(1).toDouble()
                at is String && Regex("""^[+-]=\d+""").containsMatchIn(at) -> cursor + (if (at[0] == '-') -1 else 1) * at.drop(2).toDouble()
                at is String -> { val parts = at.split(Regex("(?=[+-]=)")); val base = labels[parts[0]] ?: error("Bad position $at")
                    base + if (parts.size > 1) (if (parts[1][0] == '-') -1 else 1) * parts[1].drop(2).toDouble() else 0.0 }
                else -> error("Bad position $at")
            }
            out += LaidTrack(tr, p, num, ease, start, dur, each)
            if (p.loop == null) { lastStart = start; lastEnd = start + total; cursor = max(cursor, lastEnd) }
        }
        return out
    }

    private fun order(i: Int, n: Int, from: String?): Double = when (from) {
        "end" -> (n - 1 - i).toDouble(); "center" -> abs(i - (n - 1) / 2.0); "edges" -> (n - 1) / 2.0 - abs(i - (n - 1) / 2.0); else -> i.toDouble()
    }

    /** Snapshot of every element/unit at time t (ms). Keys: "el" or "el#i". */
    fun evaluate(laid: List<LaidTrack>, t: Double, reducedMotion: Boolean = false): Map<String, Map<String, Double>> {
        val state = linkedMapOf<String, MutableMap<String, Double>>()
        for (lt in laid) {
            val n = lt.track.units
            for (i in 0 until n) {
                val key = if (n > 1) "${lt.track.el}#$i" else lt.track.el
                val s = state.getOrPut(key) { mutableMapOf() }
                val local = t - (lt.start + order(i, n, lt.track.stagger?.from) * lt.each)
                val ph = lt.preset.phase
                if (reducedMotion) {
                    val k = (local / 200).coerceIn(0.0, 1.0)
                    if (ph == Phase.ENTRANCE) s["opacity"] = (s["opacity"] ?: 1.0) * k
                    else if (ph == Phase.EXIT) s["opacity"] = (s["opacity"] ?: 1.0) * (1 - k)
                    continue
                }
                if (ph == Phase.ENTRANCE && local < 0) { s.putAll(evalPreset(lt.preset, 0.0, lt.num, lt.ease)); continue }
                if (ph != Phase.ENTRANCE && local < 0) continue
                for ((k, v) in evalPreset(lt.preset, local, lt.num, lt.ease)) {
                    s[k] = when (k) { in MULTIPLICATIVE -> (s[k] ?: 1.0) * v; in ABSOLUTE -> v; else -> (s[k] ?: 0.0) + v }
                }
            }
        }
        return state
    }
}
