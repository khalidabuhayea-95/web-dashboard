"use client";

import { useEffect, useId, useRef, useState } from "react";
import clsx from "clsx";

/**
 * Dependency-free chart + stat primitives for the admin Overview.
 *
 * Everything here is plain inline SVG / CSS themed with the existing design
 * tokens (--chart-1..5, --ds-*, --destructive) so it stays in sync with light
 * and dark mode automatically. No charting library.
 *
 * Components are icon-agnostic: callers pass lucide icon components via props
 * so this module has no icon dependency.
 */

export const CHART_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatDayLabel(iso) {
  if (typeof iso !== "string") return "";
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

function formatNumber(value) {
  const n = Number(value) || 0;
  return n.toLocaleString();
}

// Sanitize React's useId() output (contains ":") for safe use in SVG url(#id).
function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "");
}

// SVG path for a bar with only its top corners rounded.
function roundedTopBar(x, y, w, h, radius) {
  if (h <= 0) return "";
  const r = Math.max(Math.min(radius, w / 2, h), 0);
  return [
    `M${x},${y + h}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + w - r},${y}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `L${x + w},${y + h}`,
    "Z",
  ].join(" ");
}

/** Track a container's rendered width so SVG charts can use crisp pixel coords. */
function useChartWidth(initialWidth = 640) {
  const ref = useRef(null);
  const [width, setWidth] = useState(initialWidth);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect?.width;
      if (next && next > 0) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function Gridlines({ x, width, top, height, rows = 4 }) {
  return (
    <g>
      {Array.from({ length: rows + 1 }, (_, k) => {
        const y = top + (height * k) / rows;
        const isBaseline = k === rows;
        return (
          <line
            key={k}
            x1={x}
            y1={y}
            x2={x + width}
            y2={y}
            stroke="var(--ds-border)"
            strokeWidth="1"
            strokeOpacity={isBaseline ? 0.9 : 0.4}
            strokeDasharray={isBaseline ? "0" : "2 5"}
          />
        );
      })}
    </g>
  );
}

export function EmptyState({ message = "No data yet", height = 160 }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-1 rounded-xl text-center text-xs text-muted-foreground"
      style={{ height, background: "var(--ds-surface-2)" }}
    >
      <span className="text-sm">∅</span>
      {message}
    </div>
  );
}

export function ChartCard({ title, subtitle, icon: Icon, actions, children, className }) {
  return (
    <div
      className={clsx(
        "card flex flex-col transition-shadow duration-200 hover:[box-shadow:var(--ds-shadow-md)]",
        className,
      )}
    >
      <div className="card-content flex flex-1 flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {Icon ? (
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground"
                style={{ background: "var(--ds-surface-2)" }}
              >
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
              </span>
            ) : null}
            <div>
              <div className="text-sm font-semibold leading-tight">{title}</div>
              {subtitle ? (
                <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>
              ) : null}
            </div>
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function Legend({ series }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Week-over-week (or period-over-period) change badge. */
export function DeltaBadge({ current, previous, suffix = "%" }) {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;

  let label;
  let tone;
  if (p === 0) {
    if (c === 0) return null;
    label = "New";
    tone = "up";
  } else {
    const pct = Math.round(((c - p) / p) * 100);
    tone = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
    const arrow = tone === "up" ? "↑" : tone === "down" ? "↓" : "→";
    label = `${arrow} ${Math.abs(pct)}${suffix}`;
  }

  const color =
    tone === "up"
      ? "var(--chart-1)"
      : tone === "down"
        ? "var(--destructive)"
        : "var(--ds-text-muted)";

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none"
      style={{ color, background: "color-mix(in oklab, currentColor 13%, transparent)" }}
    >
      {label}
    </span>
  );
}

/** Refined metric card with accent icon. */
export function StatCard({ icon: Icon, label, value, hint, delta, accent = "var(--chart-1)" }) {
  return (
    <div className="card transition-shadow duration-200 hover:[box-shadow:var(--ds-shadow-md)]">
      <div className="card-content">
        <div className="flex items-center justify-between gap-2">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{
              background: `color-mix(in oklab, ${accent} 15%, transparent)`,
              color: accent,
            }}
          >
            {Icon ? <Icon size={18} strokeWidth={2} aria-hidden="true" /> : null}
          </span>
          {delta ? <DeltaBadge current={delta.current} previous={delta.previous} /> : null}
        </div>
        <div className="mt-3.5 text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums">
          {value}
        </div>
        <div className="mt-2 text-xs font-medium text-muted-foreground">{label}</div>
        {hint ? <div className="mt-0.5 text-[11px] text-muted-foreground/80">{hint}</div> : null}
      </div>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="card">
      <div className="card-content">
        <div
          className="h-9 w-9 animate-pulse rounded-lg"
          style={{ background: "var(--ds-surface-2)" }}
        />
        <div
          className="mt-3.5 h-7 w-20 animate-pulse rounded-md"
          style={{ background: "var(--ds-surface-2)" }}
        />
        <div
          className="mt-2.5 h-3 w-24 animate-pulse rounded"
          style={{ background: "var(--ds-surface-2)" }}
        />
      </div>
    </div>
  );
}

/** Single-series filled area / line chart. data: [{ day, count }] */
export function AreaChart({ data, height = 184, color = "var(--chart-1)", ariaLabel = "Trend chart" }) {
  const [ref, width] = useChartWidth();
  const rawId = useId();
  const gradId = `area-grad-${sanitizeId(rawId)}`;

  if (!data || data.length === 0) return <EmptyState height={height} />;

  const padX = 4;
  const padTop = 14;
  const padBottom = 22;
  const innerW = Math.max(width - padX * 2, 1);
  const innerH = Math.max(height - padTop - padBottom, 1);
  const n = data.length;
  const max = Math.max(1, ...data.map((d) => Number(d.count) || 0));

  const xAt = (i) => (n === 1 ? padX + innerW / 2 : padX + (i / (n - 1)) * innerW);
  const yAt = (v) => padTop + innerH - ((Number(v) || 0) / max) * innerH;
  const baseY = padTop + innerH;

  const points = data.map((d, i) => `${xAt(i).toFixed(2)},${yAt(d.count).toFixed(2)}`);
  const linePath = `M${points.join(" L")}`;
  const areaPath = `M${xAt(0).toFixed(2)},${baseY} L${points.join(" L")} L${xAt(n - 1).toFixed(2)},${baseY} Z`;

  const labelIdxs = n <= 2 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];
  const slot = n > 1 ? innerW / (n - 1) : innerW;
  const lastX = xAt(n - 1);
  const lastY = yAt(data[n - 1].count);

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <Gridlines x={padX} width={innerW} top={padTop} height={innerH} rows={4} />
        <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {n <= 12
          ? data.map((d, i) => (
              <circle key={`pt-${i}`} cx={xAt(i)} cy={yAt(d.count)} r="2.5" fill={color} />
            ))
          : null}
        <circle cx={lastX} cy={lastY} r="5" fill={color} fillOpacity="0.18" />
        <circle cx={lastX} cy={lastY} r="2.5" fill={color} />
        {data.map((d, i) => (
          <rect
            key={`hit-${i}`}
            x={Math.max(xAt(i) - slot / 2, 0)}
            y={padTop}
            width={slot}
            height={innerH}
            fill="transparent"
          >
            <title>{`${formatDayLabel(d.day)}: ${formatNumber(d.count)}`}</title>
          </rect>
        ))}
        {labelIdxs.map((i) => (
          <text
            key={`lbl-${i}`}
            x={Math.min(Math.max(xAt(i), padX + 12), padX + innerW - 12)}
            y={height - 5}
            textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
            fontSize="10"
            fill="var(--ds-text-muted)"
          >
            {formatDayLabel(data[i].day)}
          </text>
        ))}
      </svg>
    </div>
  );
}

/**
 * Vertical stacked bars over day buckets.
 * data: [{ day, ...segmentValues }], series: [{ key, label, color }]
 */
export function StackedBarChart({ data, series, height = 204, ariaLabel = "Stacked bar chart" }) {
  const [ref, width] = useChartWidth();

  if (!data || data.length === 0) return <EmptyState height={height} />;

  const padX = 4;
  const padTop = 14;
  const padBottom = 22;
  const innerW = Math.max(width - padX * 2, 1);
  const innerH = Math.max(height - padTop - padBottom, 1);
  const n = data.length;

  const totals = data.map((d) =>
    series.reduce((sum, s) => sum + (Number(d[s.key]) || 0), 0),
  );
  const max = Math.max(1, ...totals);

  const slot = innerW / n;
  const barW = Math.max(Math.min(slot * 0.58, 26), 3);
  const baseY = padTop + innerH;
  const radius = Math.min(barW / 2, 4);

  const labelIdxs = n <= 2 ? [0, n - 1] : [0, Math.floor((n - 1) / 2), n - 1];

  return (
    <div ref={ref} style={{ width: "100%" }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        <Gridlines x={padX} width={innerW} top={padTop} height={innerH} rows={4} />
        {data.map((d, i) => {
          const cx = padX + slot * i + slot / 2;
          const x = cx - barW / 2;
          let cursorY = baseY;
          const positive = series.filter((s) => (Number(d[s.key]) || 0) > 0);
          const topKey = positive.length ? positive[positive.length - 1].key : null;
          const tooltip = series
            .map((s) => `${s.label}: ${formatNumber(d[s.key])}`)
            .join("  ·  ");
          return (
            <g key={`bar-${i}`}>
              {series.map((s) => {
                const v = Number(d[s.key]) || 0;
                if (v <= 0) return null;
                const segH = (v / max) * innerH;
                cursorY -= segH;
                return s.key === topKey ? (
                  <path key={s.key} d={roundedTopBar(x, cursorY, barW, segH, radius)} fill={s.color} />
                ) : (
                  <rect key={s.key} x={x} y={cursorY} width={barW} height={segH} fill={s.color} />
                );
              })}
              <rect x={x} y={padTop} width={barW} height={innerH} fill="transparent">
                <title>{`${formatDayLabel(d.day)}\n${tooltip}`}</title>
              </rect>
            </g>
          );
        })}
        {labelIdxs.map((i) => {
          const cx = padX + slot * i + slot / 2;
          return (
            <text
              key={`lbl-${i}`}
              x={Math.min(Math.max(cx, padX + 12), padX + innerW - 12)}
              y={height - 5}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              fontSize="10"
              fill="var(--ds-text-muted)"
            >
              {formatDayLabel(data[i].day)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

/** Donut with center total + legend. data: [{ label, count }] */
export function DonutChart({ data, size = 172, thickness = 20, palette = CHART_PALETTE }) {
  const items = (data || []).filter((d) => (Number(d.count) || 0) > 0);
  const total = items.reduce((sum, d) => sum + (Number(d.count) || 0), 0);

  if (items.length === 0 || total === 0) {
    return <EmptyState height={size} />;
  }

  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  const cx = size / 2;
  const cy = size / 2;
  const gap = items.length > 1 ? 2.5 : 0;

  const segments = items.map((d, i) => {
    const fraction = (Number(d.count) || 0) / total;
    const priorFraction = items
      .slice(0, i)
      .reduce((sum, x) => sum + (Number(x.count) || 0) / total, 0);
    const dash = Math.max(fraction * circumference - gap, 0.5);
    return {
      color: palette[i % palette.length],
      dash,
      gap: circumference - dash,
      offset: -priorFraction * circumference,
      label: d.label,
      count: Number(d.count) || 0,
      pct: Math.round(fraction * 100),
    };
  });

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Donut chart">
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--ds-surface-2)" strokeWidth={thickness} />
          {segments.map((s, i) => (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${s.dash} ${s.gap}`}
              strokeDashoffset={s.offset}
            />
          ))}
        </g>
        <text x={cx} y={cy - 3} textAnchor="middle" fontSize="28" fontWeight="700" fill="var(--ds-text)">
          {formatNumber(total)}
        </text>
        <text x={cx} y={cy + 17} textAnchor="middle" fontSize="11" fill="var(--ds-text-muted)">
          total
        </text>
      </svg>
      <ul className="flex-1 space-y-2.5 text-xs">
        {segments.map((s, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="capitalize">{s.label || "unknown"}</span>
            <span className="ml-auto font-medium tabular-nums">{formatNumber(s.count)}</span>
            <span className="w-9 text-right text-muted-foreground tabular-nums">{s.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ranked horizontal bars. items: [{ label, value }] */
export function HorizontalBarList({
  items,
  color = "var(--chart-1)",
  emptyMessage = "No data yet",
}) {
  const rows = items || [];
  if (rows.length === 0) return <EmptyState message={emptyMessage} height={120} />;

  const max = Math.max(1, ...rows.map((it) => Number(it.value) || 0));

  return (
    <ul className="space-y-3.5">
      {rows.map((it, idx) => {
        const v = Number(it.value) || 0;
        const pct = (v / max) * 100;
        const segColor = Array.isArray(color) ? color[idx % color.length] : color;
        return (
          <li key={it.label ?? idx}>
            <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
              <span className="truncate font-medium capitalize">{it.label || "unknown"}</span>
              <span className="tabular-nums text-muted-foreground">{formatNumber(v)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--ds-surface-2)" }}>
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${Math.max(pct, 2)}%`, background: segColor }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
