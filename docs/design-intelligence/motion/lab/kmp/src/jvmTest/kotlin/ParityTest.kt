import nayroz.motion.*
import kotlin.math.abs

fun main() {
    var checks = 0; var fails = 0; var maxErr = 0.0
    for ((name, exp) in ParityVectors.eases) {
        val f = Easings.get(name)
        for (i in 0..20) { val e = abs(f(i / 20.0) - exp[i]); checks++; if (e > maxErr) maxErr = e; if (e > 1e-6) { fails++; println("EASE $name t=${i / 20.0} kt=${f(i / 20.0)} js=${exp[i]}") } }
    }
    for ((id, scene, samples) in ParityVectors.scenes) {
        val laid = MotionEngine.layout(scene, PresetLibrary.all)
        for ((t, expected) in samples) {
            val got = MotionEngine.evaluate(laid, t)
            for ((key, props) in expected) for ((p, v) in props) {
                val g = got[key]?.get(p); checks++
                val e = if (g == null) Double.MAX_VALUE else abs(g - v)
                if (g != null && e > maxErr) maxErr = e
                if (e > 1e-6) { fails++; if (fails < 30) println("SCENE $id t=$t $key.$p kt=$g js=$v") }
            }
        }
    }
    // performance of the pure engine on JVM: evaluate full luxury scene per frame
    val (_, sc, _) = ParityVectors.scenes.first()
    val laid = MotionEngine.layout(sc, PresetLibrary.all)
    repeat(2000) { MotionEngine.evaluate(laid, (it * 16.67) % 8000) } // warmup
    val n = 20000; val t0 = System.nanoTime()
    repeat(n) { MotionEngine.evaluate(laid, (it * 16.67) % 8000) }
    val us = (System.nanoTime() - t0) / 1000.0 / n
    println("checks=$checks fails=$fails maxAbsErr=$maxErr evaluateCost=${"%.1f".format(us)}us/frame (luxury scene, ${laid.size} tracks)")
}
