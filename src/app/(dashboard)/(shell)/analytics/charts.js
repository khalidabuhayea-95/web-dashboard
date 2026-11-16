"use client";

/**
 * Chart primitives for the analytics panel.
 *
 * Hand-rolled rather than pulling in a charting library: the project ships
 * none, these are the only shapes the panel needs, and rendering them directly
 * lets every colour come from the existing design tokens so light/dark and the
 * brand palette work without a theme adapter.
 */

const numberFormat = new Intl.NumberFormat("en-US");
const compactFormat = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatNumber(value) {
  return numberFormat.format(Math.round(Number(value) || 0));
}

export function formatCompact(value) {
  const numeric = Number(value) || 0;
  return Math.abs(numeric) >= 10000 ? compactFormat.format(numeric) : formatNumber(numeric);
}

export function formatPercent(ratio, digits = 1) {
  const numeric = Number(ratio) || 0;
  return `${(numeric * 100).toFixed(digits)}%`;
}

/** Seconds → "2h 5m" / "5m 12s" / "42s". */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function formatDayLabel(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Pick a gridline step of 1/2/5 × 10ⁿ and size the axis to four of them, so
 * labels read 0/5/10/15/20 rather than whatever the raw maximum happens to be.
 * The step floors at 1 because every metric plotted here is a whole count.
 */
export function niceScale(maxValue) {
  const rough = Math.max(1, maxValue) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  const step = Math.max(1, multiplier * magnitude);
  return { max: step * 4, step };
}

/** Inline trend line for a KPI tile. No axes — shape only. */
export function Sparkline({ values, className = "" }) {
  const points = (values || []).map((v) => Number(v) || 0);
  if (points.length < 2) return null;

  const width = 120;
  const height = 32;
  const max = Math.max(1, ...points);
  const step = width / (points.length - 1);
  const line = points
    .map((value, i) => `${i === 0 ? "M" : "L"}${i * step},${height - (value / max) * (height - 4) - 2}`)
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`h-8 w-full ${className}`}
      aria-hidden="true"
    >
      <path d={`${line} L${width},${height} L0,${height} Z`} fill="var(--primary)" opacity="0.10" />
      <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * Main time series: filled area for the selected metric, with the previous
 * period drawn behind it as a dashed line for comparison.
 */
export function TrendChart({ data, previous, metricKey, label }) {
  const width = 1000;
  const height = 280;
  const padding = { top: 16, right: 16, bottom: 30, left: 52 };

  const points = Array.isArray(data) ? data : [];
  if (points.length < 2) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
        Not enough data to plot yet.
      </div>
    );
  }

  const prior = Array.isArray(previous) ? previous : [];
  const current = points.map((p) => Number(p[metricKey]) || 0);
  const compare = prior.map((p) => Number(p[metricKey]) || 0);
  const { max, step } = niceScale(Math.max(...current, ...compare));

  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const baseline = height - padding.bottom;
  const xAt = (index) => padding.left + (index * innerWidth) / (points.length - 1);
  const yAt = (value) => baseline - ((Number(value) || 0) / max) * innerHeight;

  const pathFor = (values) =>
    values.map((value, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(value)}`).join(" ");
  const areaPath = `${pathFor(current)} L${xAt(points.length - 1)},${baseline} L${xAt(0)},${baseline} Z`;
  const gridValues = [0, 1, 2, 3, 4].map((i) => i * step);
  const labelIndexes = [0, Math.floor((points.length - 1) / 2), points.length - 1];

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[280px] w-full min-w-[460px]"
        role="img"
        aria-label={`${label} over time`}
      >
        <defs>
          <linearGradient id="trend-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yAt(value)}
              y2={yAt(value)}
              stroke="var(--border)"
              strokeWidth="1"
            />
            <text
              x={padding.left - 10}
              y={yAt(value) + 6}
              textAnchor="end"
              className="fill-muted-foreground"
              style={{ fontSize: 19 }}
            >
              {formatCompact(value)}
            </text>
          </g>
        ))}

        {compare.length === current.length ? (
          <path
            d={pathFor(compare)}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth="2"
            strokeDasharray="6 6"
            opacity="0.65"
            strokeLinejoin="round"
          />
        ) : null}

        <path d={areaPath} fill="url(#trend-area)" />
        <path
          d={pathFor(current)}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {labelIndexes.map((index) => (
          <text
            key={index}
            x={xAt(index)}
            y={height - 6}
            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
            className="fill-muted-foreground"
            style={{ fontSize: 19 }}
          >
            {formatDayLabel(points[index].date)}
          </text>
        ))}
      </svg>

      <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-5 rounded bg-[var(--primary)]" />
          {label}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-0.5 w-5 rounded border-t-2 border-dashed border-[var(--muted-foreground)] opacity-70" />
          Previous period
        </span>
      </div>
    </div>
  );
}

/** Share-of-total donut for a small set of categories. */
export function DonutChart({ rows, valueKey = "users" }) {
  const entries = (rows || []).filter((row) => (Number(row[valueKey]) || 0) > 0);
  const total = entries.reduce((sum, row) => sum + (Number(row[valueKey]) || 0), 0);

  if (!total) {
    return <p className="text-sm text-muted-foreground">No data for this period.</p>;
  }

  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  // Opacity ramp keeps every slice on-brand instead of introducing a second hue.
  const opacityFor = (index) => Math.max(0.25, 1 - index * 0.22);

  const segments = entries.map((row, index) => {
    const value = Number(row[valueKey]) || 0;
    const fraction = value / total;
    // The ring is one circle per slice, so each arc has to start where the
    // previous ended — derive that from the preceding rows rather than carrying
    // a running total, which would be a render-time mutation.
    const preceding =
      entries.slice(0, index).reduce((sum, prev) => sum + (Number(prev[valueKey]) || 0), 0) / total;
    return {
      name: row.name,
      value,
      fraction,
      dash: `${fraction * circumference} ${circumference}`,
      offset: -preceding * circumference,
      opacity: opacityFor(index),
    };
  });

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg viewBox="0 0 160 160" className="h-36 w-36 shrink-0 -rotate-90" role="img" aria-label="Share by category">
        {segments.map((segment) => (
          <circle
            key={segment.name}
            cx="80"
            cy="80"
            r={radius}
            fill="none"
            stroke="var(--primary)"
            strokeOpacity={segment.opacity}
            strokeWidth="26"
            strokeDasharray={segment.dash}
            strokeDashoffset={segment.offset}
          />
        ))}
      </svg>
      <ul className="min-w-[140px] flex-1 space-y-2 text-sm">
        {segments.map((segment) => (
          <li key={segment.name} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-foreground">
              <span
                className="h-2.5 w-2.5 rounded-full bg-[var(--primary)]"
                style={{ opacity: segment.opacity }}
              />
              {segment.name}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {formatPercent(segment.fraction, 0)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Ranked list with the bar drawn behind the label — reads faster than a plain
 * table for "which of these is biggest", which is what every one of these
 * breakdowns is asking.
 */
export function BarList({ rows, primaryKey, secondaryKey, secondaryLabel, emptyLabel }) {
  const entries = rows || [];
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const max = Math.max(1, ...entries.map((row) => Number(row[primaryKey]) || 0));

  return (
    <ul className="space-y-1.5">
      {entries.map((row, index) => {
        const value = Number(row[primaryKey]) || 0;
        return (
          // Names are merged server-side, but index-qualify so a repeated label
          // can never collide.
          <li key={`${row.name}-${index}`} className="relative">
            <div
              className="absolute inset-y-0 start-0 rounded-md bg-primary/10"
              style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
              aria-hidden="true"
            />
            <div className="relative flex items-center justify-between gap-3 px-2.5 py-1.5 text-sm">
              <span className="truncate text-foreground" title={row.name}>
                {row.name}
              </span>
              <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                <span className="font-medium">{formatNumber(value)}</span>
                {secondaryKey ? (
                  <span className="text-xs text-muted-foreground">
                    {formatNumber(row[secondaryKey])} {secondaryLabel}
                  </span>
                ) : null}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Weekday × hour activity grid — shows when people actually use the product. */
export function Heatmap({ cells }) {
  const grid = new Map();
  let max = 0;
  for (const cell of cells || []) {
    grid.set(`${cell.day}:${cell.hour}`, cell.users);
    if (cell.users > max) max = cell.users;
  }

  if (!max) {
    return <p className="text-sm text-muted-foreground">No activity recorded for this period.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px]">
        <div className="flex">
          <div className="w-9 shrink-0" />
          <div className="grid flex-1 grid-cols-[repeat(24,minmax(0,1fr))] gap-[2px]">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="text-center text-[9px] leading-4 text-muted-foreground">
                {hour % 6 === 0 ? hour : ""}
              </div>
            ))}
          </div>
        </div>
        {DAY_LABELS.map((label, day) => (
          <div key={label} className="flex items-center">
            <div className="w-9 shrink-0 pe-1 text-end text-[10px] text-muted-foreground">{label}</div>
            <div className="grid flex-1 grid-cols-[repeat(24,minmax(0,1fr))] gap-[2px] py-[1px]">
              {Array.from({ length: 24 }, (_, hour) => {
                const users = grid.get(`${day}:${hour}`) || 0;
                return (
                  <div
                    key={hour}
                    title={`${label} ${String(hour).padStart(2, "0")}:00 — ${formatNumber(users)} users`}
                    className="aspect-square rounded-[2px] bg-primary"
                    // Floor the visible steps so a single user still registers.
                    style={{ opacity: users ? 0.15 + (users / max) * 0.85 : 0.05 }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
