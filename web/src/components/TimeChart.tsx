import { useEffect, useRef, useState } from 'react';

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

interface Props {
  title: string;
  /** Optional one-line explanation under the title. */
  note?: string;
  series: Series[];
  /** Tick number for each sample, used for the x axis and the tooltip. */
  ticks: number[];
  ticksPerYear: number;
  mode?: 'line' | 'stacked';
  height?: number;
  /** Shared hover index across every chart on the page. */
  hover: number | null;
  onHover: (i: number | null) => void;
  format?: (v: number) => string;
}

const M = { left: 48, right: 14, top: 12, bottom: 22 };

const compact = (v: number): string => {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${(v / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return Math.round(v * 10) / 10 === Math.round(v) ? String(Math.round(v)) : v.toFixed(1);
};

/**
 * Width of an element's content box.
 *
 * `clientWidth` includes horizontal padding, which sizes the SVG wider than the
 * box it sits in and pushes the page into a horizontal scroll.
 */
function contentWidth(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
  return Math.max(0, Math.floor(el.clientWidth - pad));
}

/** Measure the container so one SVG unit is one CSS pixel — no text distortion. */
function useWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(contentWidth(el));
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Measure once directly: a ResizeObserver is not guaranteed to deliver an
    // initial callback, and some embedded browsers only fire on an actual
    // change — leaving the chart at zero width and rendering nothing at all.
    update();
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/**
 * A small-multiple time series chart.
 *
 * One y axis only — two measures of different scale get two charts rather than
 * a second axis. Grid and axes are recessive; the marks carry the meaning. The
 * hover index is owned by the page so a single crosshair tracks across every
 * chart at once, which is what makes cause and effect legible.
 */
export default function TimeChart({
  title, note, series, ticks, ticksPerYear, mode = 'line', height = 150,
  hover, onHover, format = compact,
}: Props) {
  const [ref, width] = useWidth();
  const n = ticks.length;
  const plotW = Math.max(10, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;

  // Stacked mode sums the series; line mode takes the largest single value.
  let max = 0;
  if (mode === 'stacked') {
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (const s of series) sum += s.values[i] ?? 0;
      if (sum > max) max = sum;
    }
  } else {
    for (const s of series) for (const v of s.values) if (v > max) max = v;
  }
  let min = 0;
  for (const s of series) for (const v of s.values) if (v < min) min = v;
  const span = max - min || 1;

  const x = (i: number) => M.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => M.top + plotH - ((v - min) / span) * plotH;

  const gridValues = [min, min + span / 2, max];

  const pick = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left - M.left;
    const i = Math.round((px / plotW) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  };

  // Year gridlines, thinned so labels never collide.
  const yearMarks: Array<{ i: number; year: number }> = [];
  if (n > 1) {
    const firstYear = Math.floor(ticks[0] / ticksPerYear);
    const lastYear = Math.floor(ticks[n - 1] / ticksPerYear);
    const step = Math.max(1, Math.ceil((lastYear - firstYear) / 6));
    for (let yr = Math.ceil(firstYear / step) * step; yr <= lastYear; yr += step) {
      const target = yr * ticksPerYear;
      let i = 0;
      while (i < n - 1 && ticks[i] < target) i++;
      yearMarks.push({ i, year: yr });
    }
  }

  return (
    <div ref={ref} className="rounded-lg border border-edge bg-surface-1 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[12px] font-semibold text-ink-primary">{title}</h3>
        {series.length > 1 && (
          <div className="flex flex-wrap gap-x-2.5 gap-y-1">
            {series.map((s) => (
              <span key={s.key} className="flex items-center gap-1 text-[10px] text-ink-secondary">
                <span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {note && <p className="mt-0.5 text-[10px] text-ink-muted">{note}</p>}

      {width > 0 && n > 0 && (
        <svg
          width={width}
          height={height}
          className="mt-1 block touch-none"
          onMouseMove={(e) => onHover(pick(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onMouseLeave={() => onHover(null)}
        >
          {/* recessive grid */}
          {gridValues.map((v, k) => (
            <g key={k}>
              <line x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} stroke="#3a3a37" strokeWidth={1} />
              <text x={M.left - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#8a8a80" fontFamily="ui-monospace, monospace">
                {format(v)}
              </text>
            </g>
          ))}
          {yearMarks.map((m) => (
            <text key={m.year} x={x(m.i)} y={height - 6} textAnchor="middle" fontSize={9} fill="#8a8a80" fontFamily="ui-monospace, monospace">
              y{m.year}
            </text>
          ))}

          {mode === 'stacked' ? <Stacked series={series} n={n} x={x} y={y} baseline={y(min)} /> : null}
          {mode === 'line'
            ? series.map((s) => (
                <path
                  key={s.key}
                  d={linePath(s.values, x, y)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ))
            : null}

          {hover !== null && hover < n && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + plotH} stroke="#c3c2b7" strokeWidth={1} strokeDasharray="3 3" />
              {mode === 'line' &&
                series.map((s) => (
                  <circle
                    key={s.key}
                    cx={x(hover)}
                    cy={y(s.values[hover] ?? 0)}
                    r={3.5}
                    fill={s.color}
                    stroke="#1a1a19"
                    strokeWidth={1.5}
                  />
                ))}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

function linePath(values: number[], x: (i: number) => number, y: (v: number) => number): string {
  let d = '';
  for (let i = 0; i < values.length; i++) {
    d += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(values[i] ?? 0).toFixed(1)}`;
  }
  return d;
}

/** Stacked bands, drawn top-most first so earlier series stay visible. */
function Stacked({
  series, n, x, y, baseline,
}: {
  series: Series[];
  n: number;
  x: (i: number) => number;
  y: (v: number) => number;
  baseline: number;
}) {
  const cum = new Array(n).fill(0);
  const bands: Array<{ key: string; color: string; d: string }> = [];
  for (const s of series) {
    const lower = [...cum];
    for (let i = 0; i < n; i++) cum[i] += s.values[i] ?? 0;
    let d = '';
    for (let i = 0; i < n; i++) d += `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(cum[i]).toFixed(1)}`;
    for (let i = n - 1; i >= 0; i--) d += `L${x(i).toFixed(1)},${y(lower[i]).toFixed(1)}`;
    d += 'Z';
    bands.push({ key: s.key, color: s.color, d });
  }
  void baseline;
  return (
    <g>
      {bands.map((b) => (
        // A thin surface-coloured edge gives the 2px separation between fills.
        <path key={b.key} d={b.d} fill={b.color} fillOpacity={0.85} stroke="#1a1a19" strokeWidth={1} />
      ))}
    </g>
  );
}
