"use client";

/**
 * Lightweight SVG charts for the dashboard redesign.
 * No external dependencies — pure SVG with CSS styling.
 */

/* ─── Donut Chart (win/loss/tie record) ─── */
export function DonutChart({
  segments,
  size = 120,
  strokeWidth = 14,
  centerLabel,
  centerSub,
}: {
  segments: { value: number; color: string; label: string }[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="vt-chart-donut" style={{ width: size, height: size, position: "relative" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--vt-line-soft)"
          strokeWidth={strokeWidth}
        />
        {segments.map((seg, i) => {
          const len = (seg.value / total) * circumference;
          const dash = `${len} ${circumference - len}`;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      {centerLabel && (
        <div className="vt-chart-donut-center">
          <span className="vt-chart-donut-label">{centerLabel}</span>
          {centerSub && <span className="vt-chart-donut-sub">{centerSub}</span>}
        </div>
      )}
    </div>
  );
}

/* ─── Bar Chart (EPA breakdown or similar) ─── */
export function BarChart({
  data,
  height = 140,
  formatValue,
}: {
  data: { label: string; value: number; color: string }[];
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="vt-chart-bar" style={{ height }}>
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        return (
          <div key={i} className="vt-chart-bar-col">
            <div className="vt-chart-bar-track">
              <div
                className="vt-chart-bar-fill"
                style={{ height: `${pct}%`, background: d.color }}
              >
                <span className="vt-chart-bar-value">{formatValue ? formatValue(d.value) : d.value}</span>
              </div>
            </div>
            <span className="vt-chart-bar-label">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Line Chart (points trend over matches) ─── */
export function LineChart({
  data,
  height = 120,
  color = "var(--vt-blue)",
  fillFrom = "rgba(37, 99, 235, .15)",
  fillTo = "rgba(37, 99, 235, 0)",
}: {
  data: { label: string; value: number }[];
  height?: number;
  color?: string;
  fillFrom?: string;
  fillTo?: string;
}) {
  if (data.length === 0) return null;
  const width = 280;
  const pad = 8;
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = max - min || 1;
  const stepX = (width - pad * 2) / Math.max(data.length - 1, 1);

  const points = data.map((d, i) => ({
    x: pad + i * stepX,
    y: pad + (1 - (d.value - min) / range) * (height - pad * 2),
  }));

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${height - pad} L ${points[0].x.toFixed(1)} ${height - pad} Z`;
  const gradId = `vt-line-grad-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <div className="vt-chart-line">
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillFrom} />
            <stop offset="100%" stopColor={fillTo} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="#fff" stroke={color} strokeWidth="2" />
        ))}
      </svg>
      <div className="vt-chart-line-labels">
        {data.map((d, i) => (
          <span key={i}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

/* ─── Progress Ring (single metric) ─── */
export function ProgressRing({
  value,
  max = 100,
  size = 64,
  strokeWidth = 6,
  color = "var(--vt-blue)",
  label,
}: {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(value / max, 1);
  const dash = `${pct * circumference} ${circumference}`;

  return (
    <div className="vt-chart-ring" style={{ width: size, height: size, position: "relative" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--vt-line)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={dash}
          strokeLinecap="round"
        />
      </svg>
      {label && (
        <span className="vt-chart-ring-label">{label}</span>
      )}
    </div>
  );
}
