package nayroz.motion.ui

// ⚠️ NOT COMPILED in this study: Maven/Google repositories were blocked from both sandboxes,
// so Compose Multiplatform artifacts could not be resolved. The engine it calls (commonMain) IS
// compiled and parity-tested (JVM + Kotlin/JS). Verify this file in the real Nayroz KMP project.

import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.platform.LocalDensity
import nayroz.motion.*

/** One clock per template preview. withFrameMillis is vsync-driven on Android (Choreographer) and iOS (CADisplayLink). */
@Composable
fun rememberSceneClock(durationMs: Double, playing: Boolean = true, loop: Boolean = true): State<Double> {
    val t = remember { mutableDoubleStateOf(0.0) }
    LaunchedEffect(playing, durationMs) {
        if (!playing) return@LaunchedEffect
        val start = withFrameMillis { it }
        while (true) withFrameMillis { now ->
            val e = (now - start).toDouble()
            t.doubleValue = if (loop) e % durationMs else minOf(e, durationMs)
        }
    }
    return t
}

/** Evaluate once per frame for the whole scene (12–15 µs on JVM for 17 tracks), then each element reads its slice. */
@Composable
fun rememberSceneState(scene: Scene, clock: State<Double>, reducedMotion: Boolean): State<Map<String, Map<String, Double>>> {
    val laid = remember(scene) { MotionEngine.layout(scene, PresetLibrary.all) }
    return remember(laid, reducedMotion) { derivedStateOf { MotionEngine.evaluate(laid, clock.value, reducedMotion) } }
}

/**
 * Applies motion props in the DRAW phase only (graphicsLayer lambda + drawWithContent):
 * no recomposition and no relayout per frame. Text stays a real Text() => Arabic shaping intact.
 */
fun Modifier.motion(key: String, state: State<Map<String, Map<String, Double>>>, unitPx: Float): Modifier = this
    .graphicsLayer {
        val p = state.value[key] ?: return@graphicsLayer
        alpha = (p["opacity"] ?: 1.0).toFloat().coerceIn(0f, 1f)
        translationX = ((p["x"] ?: 0.0) * unitPx).toFloat()
        translationY = ((p["y"] ?: 0.0) * unitPx).toFloat()
        val s = (p["scale"] ?: 1.0).toFloat()
        scaleX = s * (p["scaleX"] ?: 1.0).toFloat(); scaleY = s * (p["scaleY"] ?: 1.0).toFloat()
        rotationZ = (p["rotate"] ?: 0.0).toFloat(); rotationY = (p["rotateY"] ?: 0.0).toFloat(); rotationX = (p["rotateX"] ?: 0.0).toFloat()
        cameraDistance = 12f * density
        val b = ((p["blur"] ?: 0.0) * unitPx).toFloat()
        // BlurEffect: Android 12+ (RenderEffect) and Skiko (iOS/desktop). On Android < 12 it is ignored -> fall back to opacity only.
        renderEffect = if (b > 0.5f) BlurEffect(b, b, TileMode.Decal) else null
        // compositingStrategy Offscreen only when alpha < 1 on overlapping children; default Auto is fine for text.
    }
    .drawWithContent {
        val p = state.value[key]
        val t = (p?.get("clipT") ?: 0.0).toFloat() / 100f; val r = (p?.get("clipR") ?: 0.0).toFloat() / 100f
        val bm = (p?.get("clipB") ?: 0.0).toFloat() / 100f; val l = (p?.get("clipL") ?: 0.0).toFloat() / 100f
        if (t + r + bm + l == 0f) drawContent()
        else clipRect(size.width * l, size.height * t, size.width * (1 - r), size.height * (1 - bm)) { this@drawWithContent.drawContent() }
    }

/** Stroke "draw-on": PathMeasure segment. Use for dividers/ornaments authored as vector paths. */
fun drawProgressPath(src: Path, progress: Float): Path {
    val pm = PathMeasure(); pm.setPath(src, false)
    val out = Path(); pm.getSegment(0f, pm.length * progress.coerceIn(0f, 1f), out, true); return out
}

/** Reduced motion: Android Settings.Global.ANIMATOR_DURATION_SCALE == 0 or "Remove animations";
 *  iOS UIAccessibility.isReduceMotionEnabled. expect/actual: */
// expect fun isReduceMotionEnabled(): Boolean
