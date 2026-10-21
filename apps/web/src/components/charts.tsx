import React from 'react';

export const PALETTE = ['#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#f97316', '#e879f9', '#22d3ee'];

export function Sparkline({ values, w = 130, h = 30, color = '#38bdf8' }: { values: number[]; w?: number; h?: number; color?: string }) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} className="spark">
      <path d={d} fill="none" stroke={color} strokeWidth="1.4" />
    </svg>
  );
}

function toCumulative(values: number[]): number[] {
  let v = 1;
  return values.map((r) => (v *= 1 + r));
}

export function LineChart({
  dates,
  series,
  height = 230,
}: {
  dates: string[];
  series: { label: string; values: number[]; color: string; width?: number; dashed?: boolean }[];
  height?: number;
}) {
  const w = 760;
  const h = height;
  const pad = { l: 44, r: 12, t: 14, b: 24 };
  const cumulative = series.map((s) => ({ ...s, cum: toCumulative(s.values) }));
  const all = cumulative.flatMap((s) => s.cum);
  const min = Math.min(...all, 0.9);
  const max = Math.max(...all, 1.1);
  const x = (i: number) => pad.l + (i / Math.max(1, dates.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} className="grid" />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="axis">
            {t.toFixed(2)}x
          </text>
        </g>
      ))}
      {[0, Math.floor(dates.length / 2), dates.length - 1].map((i) => (
        <text key={i} x={x(i)} y={h - 6} textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'} className="axis">
          {dates[i]}
        </text>
      ))}
      {cumulative.map((s) => (
        <path
          key={s.label}
          d={s.cum.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ')}
          fill="none"
          stroke={s.color}
          strokeWidth={s.width ?? 1.8}
          strokeDasharray={s.dashed ? '4 3' : undefined}
          opacity={0.95}
        />
      ))}
      <g transform={`translate(${pad.l + 6},${pad.t + 4})`}>
        {cumulative.map((s, i) => (
          <g key={s.label} transform={`translate(0,${i * 14})`}>
            <rect width="8" height="3" y="5" fill={s.color} rx="1.5" />
            <text x="12" y="9" className="legend">
              {s.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

export function DrawdownChart({ values, height = 110 }: { values: number[]; height?: number }) {
  const w = 760;
  const h = height;
  const pad = { l: 44, r: 12, t: 8, b: 14 };
  const min = Math.min(...values, -0.02);
  const x = (i: number) => pad.l + (i / Math.max(1, values.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (v / min) * (h - pad.t - pad.b);
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart">
      <line x1={pad.l} x2={w - pad.r} y1={pad.t} y2={pad.t} className="grid" />
      <path d={`${d} L${x(values.length - 1)},${pad.t} L${x(0)},${pad.t} Z`} fill="rgba(244,114,182,0.16)" stroke="#f472b6" strokeWidth="1.2" />
      <text x={pad.l - 6} y={pad.t + 8} textAnchor="end" className="axis">
        0%
      </text>
      <text x={pad.l - 6} y={h - 2} textAnchor="end" className="axis">
        {(min * 100).toFixed(0)}%
      </text>
    </svg>
  );
}

function heatColor(v: number): string {
  const t = Math.max(-1, Math.min(1, v));
  if (t >= 0) return `rgba(244, 114, 182, ${0.08 + t * 0.72})`;
  return `rgba(56, 189, 248, ${0.08 + Math.abs(t) * 0.72})`;
}

export function Heatmap({
  order,
  matrix,
  onSelect,
  cell = 22,
}: {
  order: string[];
  matrix: number[][];
  onSelect?: (s: string) => void;
  cell?: number;
}) {
  const label = 54;
  const w = label + order.length * cell;
  return (
    <svg viewBox={`0 0 ${w} ${w}`} className="heatmap">
      {order.map((s, i) => (
        <text key={`r${s}`} x={label - 6} y={label + i * cell + cell * 0.7} textAnchor="end" className="hm-label">
          {s}
        </text>
      ))}
      {order.map((s, i) => (
        <text
          key={`c${s}`}
          x={label + i * cell + cell * 0.5}
          y={label - 6}
          textAnchor="start"
          transform={`rotate(-60, ${label + i * cell + cell * 0.5}, ${label - 6})`}
          className="hm-label"
        >
          {s}
        </text>
      ))}
      {matrix.map((row, i) =>
        row.map((v, j) => (
          <rect
            key={`${i}-${j}`}
            x={label + j * cell}
            y={label + i * cell}
            width={cell - 1}
            height={cell - 1}
            fill={heatColor(v)}
            rx="2"
            onClick={() => onSelect?.(order[i])}
            className="hm-cell"
          >
            <title>{`${order[i]} / ${order[j]}: ${v.toFixed(2)}`}</title>
          </rect>
        )),
      )}
    </svg>
  );
}

export function Treemap({
  weights,
  clusters,
  colors,
  onSelect,
}: {
  weights: Record<string, number>;
  clusters: string[][];
  colors?: Record<string, string>;
  onSelect?: (s: string) => void;
}) {
  const w = 720;
  const h = 300;
  const colorOf = new Map<string, string>();
  if (colors) for (const [s, c] of Object.entries(colors)) colorOf.set(s, c);
  else clusters.forEach((c, i) => c.forEach((s) => colorOf.set(s, PALETTE[i % PALETTE.length])));
  const items = Object.entries(weights).sort((a, b) => b[1] - a[1]);

  type Rect = { s: string; v: number; x: number; y: number; w: number; h: number };
  const rects: Rect[] = [];
  const layout = (list: [string, number][], x: number, y: number, width: number, height: number, horizontal: boolean) => {
    if (!list.length) return;
    if (list.length === 1) {
      rects.push({ s: list[0][0], v: list[0][1], x, y, w: width, h: height });
      return;
    }
    const total = list.reduce((a, b) => a + b[1], 0);
    let acc = 0;
    let split = 0;
    for (let i = 0; i < list.length; i++) {
      acc += list[i][1];
      if (acc >= total / 2) {
        split = i + 1;
        break;
      }
    }
    const head = list.slice(0, split);
    const tail = list.slice(split);
    const headSum = head.reduce((a, b) => a + b[1], 0);
    const ratio = headSum / total;
    if (horizontal) {
      layout(head, x, y, width * ratio, height, false);
      layout(tail, x + width * ratio, y, width * (1 - ratio), height, false);
    } else {
      layout(head, x, y, width, height * ratio, true);
      layout(tail, x, y + height * ratio, width, height * (1 - ratio), true);
    }
  };
  layout(items, 0, 0, w, h, false);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="treemap">
      {rects.map((r) => (
        <g key={r.s} onClick={() => onSelect?.(r.s)} className="tm-cell">
          <rect
            x={r.x + 2}
            y={r.y + 2}
            width={Math.max(2, r.w - 4)}
            height={Math.max(2, r.h - 4)}
            rx="5"
            fill={colorOf.get(r.s) ?? '#64748b'}
            opacity="0.22"
            stroke={colorOf.get(r.s) ?? '#64748b'}
            strokeWidth="1"
          />
          {r.w > 46 && r.h > 26 && (
            <>
              <text x={r.x + 9} y={r.y + 20} className="tm-sym">
                {r.s}
              </text>
              <text x={r.x + 9} y={r.y + 36} className="tm-val">
                {(r.v * 100).toFixed(1)}%
              </text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'fail' | 'muted' | 'info'; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
