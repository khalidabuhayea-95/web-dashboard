/**
 * Merging several TEXT layers into ONE editable text layer — the editor's Merge on a selection
 * that holds nothing but text. Merge used to flatten every selection into a picture, so a
 * paragraph an import had split into one layer per line could never be edited as text again.
 *
 * The merged layer keeps the style of the first layer read (font, colour, effects, animation) and
 * re-creates the block where the originals sat: every rendered line (soft wraps resolved) becomes
 * a hard line, lines side by side become one line in reading order, and one line height is fitted
 * to where the original lines actually were.
 *
 * Pure: the caller hands over each layer's lines exactly as the renderer laid them out, plus a
 * measure for a line in the kept style, so this runs under node:test with no canvas.
 */

export type TextMergeAlign = "left" | "center" | "right" | "justify";

export interface TextMergeLine {
  text: string;
  /** Rendered width in the layer's own (unscaled) px. */
  width: number;
}

export interface TextMergeSource {
  id: string;
  /** The node's origin — its box's top-left corner before rotation — in page px. */
  x: number;
  y: number;
  /** Box width in the layer's own px. */
  width: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  fontSize: number;
  lineHeight: number;
  align: TextMergeAlign;
  /** The layer's lines as the renderer wrapped them, top to bottom. */
  lines: TextMergeLine[];
}

export interface TextMergePlan {
  /** The layer whose style and settings the merged text keeps: the first one read. */
  primaryId: string;
  text: string;
  /** The merged box's origin in page px; it takes the primary's rotation and scale. */
  x: number;
  y: number;
  /** In the primary's own px. */
  width: number;
  height: number;
  lineHeight: number;
}

/** Measures one line set in the primary's style, in its own px; null when it can't. */
export type MeasureMergedLine = (text: string, primaryId: string) => number | null;

const ROTATION_TOLERANCE_DEG = 0.5;
const MIN_LINE_HEIGHT = 0.5;
const MAX_LINE_HEIGHT = 5;
// Kept on the right of the widest line (textBox.ts's TEXT_BOX_WIDTH_EPSILON): a box exactly as
// wide as its line folds the last word on a sub-pixel rounding difference.
const BOX_SLACK_PX = 2;
// The canvas's own direction test (resolveTextDirection in CanvasEditor).
const RTL_TEXT = /[֐-ࣿ]/;

interface LinePiece {
  sourceIndex: number;
  text: string;
  /** Line centre along the shared box's vertical axis, page px. */
  centre: number;
  /** The source's line pitch, page px. */
  pitch: number;
  /** Line ink start/end along the shared box's horizontal axis, page px. */
  start: number;
  end: number;
}

interface LineRow {
  pieces: LinePiece[];
  centre: number;
  pitch: number;
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function rotationsMatch(a: number, b: number) {
  const difference = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(difference, 360 - difference) <= ROTATION_TOLERANCE_DEG;
}

function rowText(row: LineRow) {
  if (row.pieces.length === 1) return row.pieces[0].text;
  // Pieces side by side read right to left in Arabic, left to right otherwise.
  const rtl = row.pieces.some((piece) => RTL_TEXT.test(piece.text));
  return [...row.pieces]
    .sort((a, b) => (rtl ? b.end - a.end : a.start - b.start))
    .map((piece) => piece.text.trim())
    .filter(Boolean)
    .join(" ");
}

/**
 * The single text layer that reproduces `sources`, or null when one text box cannot: fewer than
 * two layers with text, layers turned by different angles, or a flipped layer. The caller then
 * keeps the raster merge.
 */
export function planTextLayerMerge(
  sources: TextMergeSource[],
  measureLine: MeasureMergedLine
): TextMergePlan | null {
  const usable = (Array.isArray(sources) ? sources : []).filter(
    (source) =>
      source &&
      finite(source.fontSize) > 0 &&
      Array.isArray(source.lines) &&
      source.lines.some((line) => String(line?.text ?? "").trim())
  );
  if (usable.length < 2) return null;

  const rotation = finite(usable[0].rotation);
  if (!usable.every((source) => rotationsMatch(finite(source.rotation), rotation))) return null;
  if (!usable.every((source) => finite(source.scaleX, 1) > 0 && finite(source.scaleY, 1) > 0)) return null;

  // Everything is measured in the shared box's own frame: `along` its rotated x axis and `down`
  // its rotated y axis, so a turned paragraph merges exactly like a level one.
  const radians = (rotation * Math.PI) / 180;
  const [ux, uy] = [Math.cos(radians), Math.sin(radians)];
  const [vx, vy] = [-Math.sin(radians), Math.cos(radians)];
  const along = (x: number, y: number) => x * ux + y * uy;
  const down = (x: number, y: number) => x * vx + y * vy;

  // Konva centres each line in its line box (lineHeight × fontSize) and places it inside the box
  // by `align` alone.
  const pieces: LinePiece[] = [];
  usable.forEach((source, sourceIndex) => {
    const scaleX = finite(source.scaleX, 1);
    const scaleY = finite(source.scaleY, 1);
    const pitch = finite(source.fontSize) * (finite(source.lineHeight, 1) || 1) * scaleY;
    const originAlong = along(finite(source.x), finite(source.y));
    const originDown = down(finite(source.x), finite(source.y));
    source.lines.forEach((line, lineIndex) => {
      const lineWidth = Math.max(0, finite(line?.width));
      const boxWidth = Math.max(lineWidth, finite(source.width));
      const offset =
        source.align === "right"
          ? boxWidth - lineWidth
          : source.align === "center"
            ? (boxWidth - lineWidth) / 2
            : 0;
      const start = originAlong + offset * scaleX;
      pieces.push({
        sourceIndex,
        text: String(line?.text ?? ""),
        centre: originDown + (lineIndex + 0.5) * pitch,
        pitch,
        start,
        end: start + lineWidth * scaleX,
      });
    });
  });

  // Lines whose centres sit within half a line of each other share a row; a source's own lines
  // are a full pitch apart, so they never do.
  pieces.sort((a, b) => a.centre - b.centre);
  const rows: LineRow[] = [];
  for (const piece of pieces) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(piece.centre - row.centre) < Math.min(row.pitch, piece.pitch) / 2) {
      row.pieces.push(piece);
      row.centre = row.pieces.reduce((sum, member) => sum + member.centre, 0) / row.pieces.length;
      row.pitch = Math.min(row.pitch, piece.pitch);
    } else {
      rows.push({ pieces: [piece], centre: piece.centre, pitch: piece.pitch });
    }
  }

  const firstRow = rows[0];
  const firstRtl = firstRow.pieces.some((piece) => RTL_TEXT.test(piece.text));
  const readFirst = [...firstRow.pieces]
    .filter((piece) => piece.text.trim())
    .sort((a, b) => (firstRtl ? b.end - a.end : a.start - b.start))[0];
  const primary = usable[(readFirst ?? firstRow.pieces[0]).sourceIndex];
  const primaryScaleX = finite(primary.scaleX, 1);
  const primaryScaleY = finite(primary.scaleY, 1);
  const primaryFontPx = finite(primary.fontSize) * primaryScaleY;

  // One line height for the whole block: the least-squares pitch through the rows' centres, so
  // evenly spaced lines land exactly and uneven ones as closely as a single text box allows.
  const count = rows.length;
  let pitch = finite(primary.fontSize) * (finite(primary.lineHeight, 1) || 1) * primaryScaleY;
  const meanIndex = (count - 1) / 2;
  const meanCentre = rows.reduce((sum, row) => sum + row.centre, 0) / count;
  if (count > 1) {
    let covariance = 0;
    let variance = 0;
    rows.forEach((row, index) => {
      covariance += (index - meanIndex) * (row.centre - meanCentre);
      variance += (index - meanIndex) ** 2;
    });
    pitch = covariance / variance;
  }
  const lineHeight = Math.min(MAX_LINE_HEIGHT, Math.max(MIN_LINE_HEIGHT, pitch / primaryFontPx));
  pitch = lineHeight * primaryFontPx;
  const top = meanCentre - meanIndex * pitch - pitch / 2;

  const texts = rows.map(rowText);
  const inked = pieces.filter((piece) => piece.text.trim());
  const minAlong = Math.min(...inked.map((piece) => piece.start));
  const maxAlong = Math.max(...inked.map((piece) => piece.end));
  const widestLine = Math.max(
    0,
    ...rows.map((row, index) => {
      const measured = texts[index].trim() ? measureLine(texts[index], primary.id) : 0;
      if (measured !== null && Number.isFinite(measured)) return measured;
      const extent = Math.max(...row.pieces.map((piece) => piece.end)) - Math.min(...row.pieces.map((piece) => piece.start));
      return extent / primaryScaleX;
    })
  );
  const width = Math.max((maxAlong - minAlong) / primaryScaleX, widestLine + BOX_SLACK_PX);
  const left =
    primary.align === "right"
      ? maxAlong - width * primaryScaleX
      : primary.align === "center"
        ? (minAlong + maxAlong) / 2 - (width * primaryScaleX) / 2
        : minAlong;

  return {
    primaryId: primary.id,
    text: texts.join("\n"),
    x: left * ux + top * vx,
    y: left * uy + top * vy,
    width,
    height: (count * pitch) / primaryScaleY,
    lineHeight,
  };
}
