"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** The jobs pages' figures, drawn quietly so the numbers lead: stat tiles, meters
 * against a target, one-series columns (the latest or chosen one in leaf, the
 * rest a quieter leaf), and sparklines. Every chart answers on hover and on
 * keyboard focus, and can be read as a table. */

export function StatTile({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return <div className="jobs-tile">
    <p className="jobs-tile-label">{label}</p>
    <p className="jobs-tile-value">{value}</p>
    {detail && <p className="jobs-tile-detail">{detail}</p>}
  </div>;
}

/** Progress against a target: the fill is leaf on a track of the same hue. No target, no meter. */
export function Meter({ value, target, label, compact }: { value: number; target: number | null; label: string; compact?: boolean }) {
  if (target === null) return <span className="jobs-meter-text">{value}{!compact && <span className="jobs-meter-of"> · no target</span>}</span>;
  const share = target > 0 ? Math.min(1, value / target) : 1;
  const done = value >= target;
  return <span className="jobs-meter" data-done={done || undefined} data-compact={compact || undefined}>
    <span className="jobs-meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={target} aria-valuenow={value}
      aria-valuetext={`${value} of ${target}${done ? ", target reached" : ""}`}>
      <span className="jobs-meter-fill" style={{ width: `${share * 100}%` }} />
    </span>
    <span className="jobs-meter-text">{value}<span className="jobs-meter-of"> / {target}</span>{done && <span className="jobs-meter-done" aria-hidden="true"> ✓</span>}</span>
  </span>;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const watch = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    watch.observe(box);
    return () => watch.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A round top for the scale: 1, 2, 5 × 10ⁿ. */
function niceTop(max: number) {
  if (max <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].map(step => step * power).find(step => step >= max) ?? 10 * power;
}

export type Column = { key: string; label: string; value: number; long?: string };

/** One measure over time or hours, as columns. `accent`: the column in leaf
 * (today, now). `max`: a top shared with other charts (small multiples, each
 * on the same scale). `compact`: a small one, with its top and zero only. */
export function Columns({ items, accent, title, unit, height = 170, every = 1, max: shared, compact }: {
  items: Column[]; accent?: string; title: string; unit: string; height?: number; every?: number; max?: number; compact?: boolean;
}) {
  const [box, width] = useWidth<HTMLDivElement>();
  const [shown, setShown] = useState<number | null>(null);
  const left = compact ? 26 : 34, right = 6, top = 10, bottom = 22;
  const plot = Math.max(0, width - left - right), tall = height - top - bottom;
  const max = niceTop(Math.max(0, shared ?? 0, ...items.map(item => item.value)));
  const band = items.length ? plot / items.length : 0;
  const bar = Math.max(2, Math.min(24, band * 0.62));
  const y = (value: number) => top + tall - (value / max) * tall;
  const ticks = compact ? [0, max] : [0, max / 2, max];
  const point = shown === null ? null : items[shown];
  // Every few columns a label, and the leaf one's always; a label too near it steps aside.
  const lit = items.findIndex(item => item.key === accent);
  const labelled = (index: number) => index === lit || (index % every === 0 && (lit < 0 || Math.abs(index - lit) >= Math.ceil(every / 2)));

  return <figure className="jobs-chart">
    <div ref={box} className="jobs-chart-plot" style={{ height }} onPointerLeave={() => setShown(null)}>
      {width > 0 && <svg width={width} height={height} role="img" aria-label={`${title}. ${items.length} values; the table below lists them.`}>
        {ticks.map(tick => <g key={tick}>
          <line className={tick === 0 ? "jobs-chart-axis" : "jobs-chart-grid"} x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
          <text className="jobs-chart-tick" x={left - 6} y={y(tick)} dy="0.32em" textAnchor="end">{Number.isInteger(tick) ? tick : tick.toFixed(1)}</text>
        </g>)}
        {items.map((item, index) => {
          const x = left + index * band + (band - bar) / 2;
          const h = Math.max(0, y(0) - y(item.value));
          const r = Math.min(4, h, bar / 2);
          const base = y(0), lid = base - h;
          return <g key={item.key}>
            {h > 0 && <path className="jobs-chart-bar" data-accent={item.key === accent || undefined} data-shown={shown === index || undefined}
              d={`M${x},${base} V${lid + r} Q${x},${lid} ${x + r},${lid} H${x + bar - r} Q${x + bar},${lid} ${x + bar},${lid + r} V${base} Z`} />}
            {labelled(index) && <text className="jobs-chart-label" data-accent={item.key === accent || undefined}
              x={x + bar / 2} y={height - 7} textAnchor="middle">{item.label}</text>}
            {/* The whole band answers, not only the column. */}
            <rect className="jobs-chart-hit" x={left + index * band} y={top} width={band} height={tall} tabIndex={0}
              aria-label={`${item.long ?? item.label}: ${item.value} ${unit}`}
              onPointerEnter={() => setShown(index)} onFocus={() => setShown(index)} onBlur={() => setShown(null)} />
          </g>;
        })}
      </svg>}
      {point && shown !== null && <div className="jobs-chart-tip" role="status"
        style={{ left: Math.min(Math.max(left + shown * band + band / 2, 60), width - 60), top: Math.max(0, y(point.value) - 8) }}>
        <strong>{point.value.toLocaleString()}</strong> <span>{unit}</span>
        <span className="jobs-chart-tip-label">{point.long ?? point.label}</span>
      </div>}
    </div>
    <details className="jobs-chart-table">
      <summary>Show as a table</summary>
      <table>
        <thead><tr><th scope="col">When</th><th scope="col">{unit[0].toUpperCase() + unit.slice(1)}</th></tr></thead>
        <tbody>{items.map(item => <tr key={item.key}><th scope="row">{item.long ?? item.label}</th><td>{item.value.toLocaleString()}</td></tr>)}</tbody>
      </table>
    </details>
  </figure>;
}

/** A small trend in a table's row: the quiet line, and the latest value marked in leaf. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const width = 96, height = 28, pad = 4;
  const max = Math.max(1, ...values);
  const x = (index: number) => pad + (index / Math.max(1, values.length - 1)) * (width - pad * 2);
  const y = (value: number) => height - pad - (value / max) * (height - pad * 2);
  const last = values.length - 1;
  return <svg className="jobs-spark" width={width} height={height} role="img" aria-label={`${label}: ${values.join(", ")}`}>
    <polyline className="jobs-spark-line" points={values.map((value, index) => `${x(index)},${y(value)}`).join(" ")} />
    {last >= 0 && <circle className="jobs-spark-dot" cx={x(last)} cy={y(values[last])} r={3.5} />}
  </svg>;
}
