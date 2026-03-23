import { normalizeHexColor } from "@/lib/editor/colorUtils"

export const RASTER_PALETTE_VERSION = 2

type RgbColor = [number, number, number]
type HslColor = { h: number; s: number; l: number }
type QuantizedBin = { rgb: RgbColor; count: number }
type ColorCluster = {
  count: number
  rSum: number
  gSum: number
  bSum: number
  representative: RgbColor
}

type PaletteHydrationOptions = {
  maxColors?: number
}

type PaletteHydrationResult = {
  fabricData: Record<string, unknown> | null
  generatedCount: number
  failedCount: number
  skippedCount: number
}

let canvasLibPromise: Promise<{ createCanvas: any; loadImage: any } | null> | null = null

function asString(value: unknown) {
  return String(value || "").trim()
}

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function toHex(value: number) {
  return clampChannel(value).toString(16).padStart(2, "0")
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value))
}

function colorDistance(a: RgbColor, b: RgbColor) {
  const dr = a[0] - b[0]
  const dg = a[1] - b[1]
  const db = a[2] - b[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function rgbToHsl(r: number, g: number, b: number): HslColor {
  const red = clampChannel(r) / 255
  const green = clampChannel(g) / 255
  const blue = clampChannel(b) / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2

  if (max === min) {
    return { h: 0, s: 0, l: lightness }
  }

  const delta = max - min
  const saturation =
    lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)

  let hue = 0
  switch (max) {
    case red:
      hue = (green - blue) / delta + (green < blue ? 6 : 0)
      break
    case green:
      hue = (blue - red) / delta + 2
      break
    default:
      hue = (red - green) / delta + 4
      break
  }

  return { h: hue / 6, s: saturation, l: lightness }
}

function hueDistance(a: number, b: number) {
  const diff = Math.abs(a - b)
  return Math.min(diff, 1 - diff)
}

function smartColorDistance(a: RgbColor, b: RgbColor) {
  const rgbDistance = colorDistance(a, b) / 255
  const ahsl = rgbToHsl(a[0], a[1], a[2])
  const bhsl = rgbToHsl(b[0], b[1], b[2])
  const hueWeight = Math.max(ahsl.s, bhsl.s, 0.12)
  const hueGap = hueDistance(ahsl.h, bhsl.h) * hueWeight
  const saturationGap = Math.abs(ahsl.s - bhsl.s)
  const lightnessGap = Math.abs(ahsl.l - bhsl.l)
  return rgbDistance * 0.52 + hueGap * 1.85 + saturationGap * 0.72 + lightnessGap * 1.08
}

function decodeQuantizedColor(binKey: string): RgbColor {
  const packed = Number(binKey)
  const r = ((packed >> 8) & 0x0f) * 17
  const g = ((packed >> 4) & 0x0f) * 17
  const b = (packed & 0x0f) * 17
  return [r, g, b]
}

function averageClusterColor(cluster: ColorCluster): RgbColor {
  const count = Math.max(1, cluster.count)
  return [
    clampChannel(cluster.rSum / count),
    clampChannel(cluster.gSum / count),
    clampChannel(cluster.bSum / count),
  ]
}

function buildColorClusters(bins: QuantizedBin[]) {
  const clusters: ColorCluster[] = []

  for (let index = 0; index < bins.length; index += 1) {
    const bin = bins[index]
    const candidate = bin.rgb
    const candidateHsl = rgbToHsl(candidate[0], candidate[1], candidate[2])
    let bestCluster: ColorCluster | null = null
    let bestDistance = Number.POSITIVE_INFINITY

    for (let clusterIndex = 0; clusterIndex < clusters.length; clusterIndex += 1) {
      const cluster = clusters[clusterIndex]
      const representative = averageClusterColor(cluster)
      const representativeHsl = rgbToHsl(
        representative[0],
        representative[1],
        representative[2]
      )
      const distance = smartColorDistance(candidate, representative)
      const closeInHue =
        hueDistance(candidateHsl.h, representativeHsl.h) <= 0.075 &&
        Math.abs(candidateHsl.l - representativeHsl.l) <= 0.2
      const closeInGray =
        Math.max(candidateHsl.s, representativeHsl.s) <= 0.14 &&
        Math.abs(candidateHsl.l - representativeHsl.l) <= 0.16
      if (distance < 0.18 || closeInHue || closeInGray) {
        if (distance < bestDistance) {
          bestDistance = distance
          bestCluster = cluster
        }
      }
    }

    if (bestCluster) {
      bestCluster.count += bin.count
      bestCluster.rSum += candidate[0] * bin.count
      bestCluster.gSum += candidate[1] * bin.count
      bestCluster.bSum += candidate[2] * bin.count
      bestCluster.representative = averageClusterColor(bestCluster)
      continue
    }

    clusters.push({
      count: bin.count,
      rSum: candidate[0] * bin.count,
      gSum: candidate[1] * bin.count,
      bSum: candidate[2] * bin.count,
      representative: candidate,
    })
  }

  return clusters
    .map((cluster) => ({
      ...cluster,
      representative: averageClusterColor(cluster),
    }))
    .sort((a, b) => b.count - a.count)
}

function shouldIgnoreBackgroundCluster(cluster: ColorCluster) {
  const hsl = rgbToHsl(
    cluster.representative[0],
    cluster.representative[1],
    cluster.representative[2]
  )
  return (
    (hsl.l >= 0.94 && hsl.s <= 0.12) ||
    (hsl.l <= 0.07 && hsl.s <= 0.08)
  )
}

async function getCanvasLib() {
  if (canvasLibPromise) return canvasLibPromise
  canvasLibPromise = import("canvas")
    .then((module) => ({
      createCanvas: module.createCanvas,
      loadImage: module.loadImage,
    }))
    .catch(() => null)
  return canvasLibPromise
}

async function loadSourceImage(sourceInput: string) {
  const source = asString(sourceInput)
  if (!source) return null

  const canvasLib = await getCanvasLib()
  if (!canvasLib?.loadImage) return null

  try {
    if (/^https?:\/\//i.test(source)) {
      const response = await fetch(source, {
        method: "GET",
        redirect: "follow",
        headers: {
          Accept: "image/*,*/*;q=0.8",
        },
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (!bytes.length) return null
      return await canvasLib.loadImage(bytes)
    }

    return await canvasLib.loadImage(source)
  } catch {
    return null
  }
}

export async function extractRasterPaletteFromSource(sourceInput: string, maxColors = 6) {
  const source = asString(sourceInput)
  if (!source) return []

  const canvasLib = await getCanvasLib()
  if (!canvasLib?.createCanvas) return []

  const image = await loadSourceImage(source)
  if (!image?.width || !image?.height) return []

  const sampleSide = 96
  const width = Math.max(1, Math.min(sampleSide, Math.round(Number(image.width) || 1)))
  const height = Math.max(1, Math.min(sampleSide, Math.round(Number(image.height) || 1)))

  try {
    const canvas = canvasLib.createCanvas(width, height)
    const context = canvas.getContext("2d")
    context.clearRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    const { data } = context.getImageData(0, 0, width, height)
    const bins = new Map<string, number>()

    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3]
      if (alpha < 24) continue

      const qr = Math.round(data[index] / 17) & 0x0f
      const qg = Math.round(data[index + 1] / 17) & 0x0f
      const qb = Math.round(data[index + 2] / 17) & 0x0f
      const packed = (qr << 8) | (qg << 4) | qb
      const key = String(packed)
      bins.set(key, (bins.get(key) || 0) + 1)
    }

    if (bins.size === 0) return []

    const quantizedBins = Array.from(bins.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([binKey, count]) => ({ rgb: decodeQuantizedColor(binKey), count }))

    const clusters = buildColorClusters(quantizedBins)
    const nonBackgroundClusters = clusters.filter(
      (cluster) => !shouldIgnoreBackgroundCluster(cluster)
    )
    const visibleClusters =
      nonBackgroundClusters.length >= 2 ? nonBackgroundClusters : clusters

    const picked = visibleClusters
      .slice(0, Math.max(1, maxColors))
      .map((cluster) => cluster.representative)

    return Array.from(
      new Set(
        picked
          .map(([r, g, b]) => normalizeHexColor(rgbToHex(r, g, b)))
          .filter((value): value is string => Boolean(value))
      )
    )
  } catch {
    return []
  }
}

function collectTargetImageNodes(node: unknown, results: Record<string, unknown>[] = []) {
  if (!node || typeof node !== "object") return results

  if (Array.isArray(node)) {
    node.forEach((item) => {
      collectTargetImageNodes(item, results)
    })
    return results
  }

  const objectNode = node as Record<string, unknown>
  const type = asString(objectNode.type).toLowerCase()
  const source = asString(objectNode.rasterOriginalSrc || objectNode.src)
  if (type === "image" && source) {
    results.push(objectNode)
  }

  Object.values(objectNode).forEach((value) => {
    if (value && typeof value === "object") {
      collectTargetImageNodes(value, results)
    }
  })

  return results
}

function normalizePalette(input: unknown) {
  if (!Array.isArray(input)) return []
  return input
    .map((value) => normalizeHexColor(String(value || "")))
    .filter((value): value is string => Boolean(value))
}

export async function hydrateFabricRasterPalettes(
  fabricData: Record<string, unknown> | null,
  options: PaletteHydrationOptions = {}
): Promise<PaletteHydrationResult> {
  if (!fabricData || typeof fabricData !== "object") {
    return {
      fabricData,
      generatedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    }
  }

  const maxColors = Math.max(1, Math.min(8, Math.round(Number(options.maxColors || 6))))
  const imageNodes = collectTargetImageNodes(
    Array.isArray(fabricData.objects) ? fabricData.objects : [],
    []
  )

  if (imageNodes.length === 0) {
    return {
      fabricData,
      generatedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    }
  }

  const paletteCache = new Map<string, Promise<string[]>>()
  const nextNodes: Array<{ node: Record<string, unknown>; source: string }> = []
  let skippedCount = 0

  for (let index = 0; index < imageNodes.length; index += 1) {
    const node = imageNodes[index]
    const source = asString(node.rasterOriginalSrc || node.src)
    if (!source) {
      skippedCount += 1
      continue
    }

    const existingPalette = normalizePalette(node.rasterPalette)
    const existingVersion = Math.max(0, Number(node.rasterPaletteVersion || 0))
    const persistedSource = asString(node.rasterOriginalSrc)
    const shouldRefresh =
      persistedSource !== source ||
      existingVersion < RASTER_PALETTE_VERSION ||
      existingPalette.length === 0

    if (!shouldRefresh) {
      skippedCount += 1
      continue
    }

    if (!paletteCache.has(source)) {
      paletteCache.set(source, extractRasterPaletteFromSource(source, maxColors))
    }
    nextNodes.push({ node, source })
  }

  let generatedCount = 0
  let failedCount = 0

  await Promise.all(
    nextNodes.map(async ({ node, source }) => {
      let palette: string[] = []
      try {
        palette = (await paletteCache.get(source)) || []
      } catch {
        palette = []
      }

      node.rasterOriginalSrc = source
      node.rasterPalette = palette
      node.rasterPaletteVersion = RASTER_PALETTE_VERSION

      if (palette.length > 0) {
        generatedCount += 1
      } else {
        failedCount += 1
      }
    })
  )

  return {
    fabricData,
    generatedCount,
    failedCount,
    skippedCount,
  }
}
