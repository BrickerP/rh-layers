import React from 'react';
import type { LayerId, LayerEvent, RunArtifact } from '@rh-layers/core';
import { LAYERS } from '../lib/meta';

export type StageStatus = 'idle' | 'running' | 'done' | 'warn' | 'fail';

const W = 214;
const H = 84;
const POS: Record<LayerId, { x: number; y: number }> = {
  sources: { x: 160, y: 92 },
  clean: { x: 466, y: 92 },
  metrics: { x: 772, y: 92 },
  screen: { x: 1078, y: 92 },
  signal: { x: 1078, y: 288 },
  corr: { x: 772, y: 288 },
  build: { x: 466, y: 288 },
  backtest: { x: 160, y: 288 },
};
const PREV: Record<LayerId, LayerId | null> = {
  sources: null,
  clean: 'sources',
  metrics: 'clean',
  screen: 'metrics',
  signal: 'screen',
  corr: 'signal',
  build: 'corr',
  backtest: 'build',
};

const STATUS: Record<StageStatus, { color: string; label: string }> = {
  idle: { color: '#334155', label: 'waiting' },
  running: { color: '#5eead4', label: 'running' },
  done: { color: '#34d399', label: 'pass' },
  warn: { color: '#fbbf24', label: 'warn' },
  fail: { color: '#fb7185', label: 'blocked' },
};

function edge(a: LayerId, b: LayerId): { x1: number; y1: number; x2: number; y2: number } {
  const p0 = POS[a];
  const p1 = POS[b];
  if (Math.abs(p0.y - p1.y) < 1) {
    const dir = p1.x > p0.x ? 1 : -1;
    return { x1: p0.x + (W / 2) * dir, y1: p0.y, x2: p1.x - (W / 2) * dir, y2: p1.y };
  }
  const dir = p1.y > p0.y ? 1 : -1;
  return { x1: p0.x, y1: p0.y + (H / 2) * dir, x2: p1.x, y2: p1.y - (H / 2) * dir };
}

export default function FlowGraph({
  layers,
  status,
  progress,
  vt,
  events,
  selected,
  onSelect,
  metric,
}: {
  layers: RunArtifact['layers'];
  status: Record<LayerId, StageStatus>;
  progress: Record<LayerId, number>;
  vt: number;
  events: LayerEvent[];
  selected: LayerId;
  onSelect: (id: LayerId) => void;
  metric: Record<LayerId, string>;
}) {
  const packets = events.filter((e) => e.kind !== 'gate' && vt - e.t >= 0 && vt - e.t < 820);

  return (
    <svg viewBox="0 0 1240 380" className="graph">
      <defs>
        <linearGradient id="lane" x1="0" x2="1">
          <stop offset="0" stopColor="#0e1724" stopOpacity="0.9" />
          <stop offset="1" stopColor="#0b1220" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <rect x="40" y="40" width="1160" height="104" rx="14" fill="url(#lane)" />
      <rect x="40" y="236" width="1160" height="104" rx="14" fill="url(#lane)" />
      <text x="40" y="30" className="lane-label">
        01–04 · ingest &amp; qualify
      </text>
      <text x="1200" y="366" textAnchor="end" className="lane-label">
        05–08 · size &amp; prove
      </text>

      {LAYERS.filter((l) => PREV[l.id]).map((l) => {
        const from = PREV[l.id]!;
        const e = edge(from, l.id);
        const on = status[from] !== 'idle' && status[l.id] !== 'idle';
        const color = on ? '#2dd4bf' : '#1e293b';
        const dirX = e.x2 > e.x1 ? 1 : e.x2 < e.x1 ? -1 : 0;
        const dirY = e.y2 > e.y1 ? 1 : e.y2 < e.y1 ? -1 : 0;
        return (
          <g key={`${from}-${l.id}`} opacity={on ? 0.8 : 0.35}>
            <path d={`M${e.x1},${e.y1} L${e.x2},${e.y2}`} stroke={color} strokeWidth="1.4" fill="none" />
            <polygon
              points={
                dirX
                  ? `${e.x2},${e.y2} ${e.x2 - 8 * dirX},${e.y2 - 4} ${e.x2 - 8 * dirX},${e.y2 + 4}`
                  : `${e.x2},${e.y2} ${e.x2 - 4},${e.y2 - 8 * dirY} ${e.x2 + 4},${e.y2 - 8 * dirY}`
              }
              fill={color}
            />
          </g>
        );
      })}

      {packets.map((e, i) => {
        const from = PREV[e.layer];
        if (!from) return null;
        const seg = edge(from, e.layer);
        const t = Math.min(1, Math.max(0, (vt - e.t) / 820));
        const x = seg.x1 + (seg.x2 - seg.x1) * t;
        const y = seg.y1 + (seg.y2 - seg.y1) * t;
        return <circle key={`${e.t}-${i}`} cx={x} cy={y} r="3" fill="#5eead4" opacity={1 - t * 0.55} />;
      })}

      {LAYERS.map((meta, i) => {
        const p = POS[meta.id];
        const st = status[meta.id];
        const s = STATUS[st];
        const layer = layers.find((l) => l.id === meta.id);
        const sel = selected === meta.id;
        return (
          <g key={meta.id} transform={`translate(${p.x},${p.y})`} onClick={() => onSelect(meta.id)} className="node">
            <rect
              x={-W / 2}
              y={-H / 2}
              width={W}
              height={H}
              rx="10"
              fill="#0b1220"
              stroke={sel ? '#5eead4' : '#1c2940'}
              strokeWidth={sel ? 1.8 : 1}
            />
            <rect x={-W / 2} y={-H / 2} width="3" height={H} rx="1.5" fill={s.color} opacity={st === 'idle' ? 0.25 : 1} />
            <text x={-W / 2 + 14} y={-H / 2 + 20} className="n-idx">
              {String(i + 1).padStart(2, '0')}
            </text>
            <text x={-W / 2 + 40} y={-H / 2 + 20} className="n-label">
              {meta.label}
            </text>
            <circle cx={W / 2 - 16} cy={-H / 2 + 15} r="3.5" fill={s.color} className={st === 'running' ? 'pulse' : ''} />
            <text x={W / 2 - 26} y={-H / 2 + 19} textAnchor="end" className="n-status">
              {s.label}
            </text>
            <text x={-W / 2 + 14} y={-H / 2 + 50} className="n-metric">
              {metric[meta.id]}
            </text>
            <text x={W / 2 - 14} y={-H / 2 + 50} textAnchor="end" className="n-ms">
              {layer?.ms ? `${layer.ms}ms` : ''}
            </text>
            <rect x={-W / 2 + 14} y={H / 2 - 14} width={W - 28} height="3" rx="1.5" fill="#162234" />
            <rect x={-W / 2 + 14} y={H / 2 - 14} width={(W - 28) * (progress[meta.id] ?? 0)} height="3" rx="1.5" fill={s.color} />
          </g>
        );
      })}
    </svg>
  );
}
