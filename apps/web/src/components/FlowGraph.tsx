import React from 'react';
import type { LayerId, LayerEvent, RunArtifact } from '@rh-layers/core';
import { LAYERS, LAYER_BY_ID } from '../lib/meta';

export type StageStatus = 'idle' | 'running' | 'done' | 'warn' | 'fail';

const POS: Record<LayerId, { x: number; y: number }> = {
  sources: { x: 110, y: 100 },
  clean: { x: 340, y: 100 },
  metrics: { x: 570, y: 100 },
  screen: { x: 800, y: 100 },
  signal: { x: 800, y: 310 },
  corr: { x: 570, y: 310 },
  build: { x: 340, y: 310 },
  backtest: { x: 110, y: 310 },
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

const STATUS_COLOR: Record<StageStatus, string> = {
  idle: '#334155',
  running: '#38bdf8',
  done: '#34d399',
  warn: '#fbbf24',
  fail: '#f472b6',
};

function Glyph({ id, color }: { id: LayerId; color: string }) {
  const stroke = color;
  switch (id) {
    case 'sources':
      return (
        <g stroke={stroke} strokeWidth="1.4" fill="none">
          <ellipse cx="12" cy="6" rx="8" ry="3" />
          <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
          <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
        </g>
      );
    case 'clean':
      return (
        <g stroke={stroke} strokeWidth="1.4" fill="none">
          <path d="M3 4h18l-6.5 7.2v8L9.5 22v-10.8L3 4z" />
        </g>
      );
    case 'metrics':
      return (
        <g stroke={stroke} strokeWidth="1.4" fill="none">
          <path d="M4 20V9M10 20V4M16 20v-7M22 20v-11" />
          <path d="M3 21h19" />
        </g>
      );
    case 'screen':
      return (
        <g stroke={stroke} strokeWidth="1.4" fill="none">
          <path d="M4 5h16M7 10h10M10 15h4M12 15v6" />
        </g>
      );
    case 'signal':
      return (
        <g stroke={stroke} strokeWidth="1.4" fill="none">
          <path d="M3 14l4-6 4 9 4-12 4 9 3-5" />
          <path d="M3 21h18" opacity="0.4" />
        </g>
      );
    case 'corr':
      return (
        <g stroke={stroke} strokeWidth="1.2" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18M15 3v18M3 9h18M3 15h18" opacity="0.65" />
        </g>
      );
    case 'build':
      return (
        <g stroke={stroke} strokeWidth="1.3" fill="none">
          <rect x="3" y="13" width="8" height="8" rx="1" />
          <rect x="13" y="8" width="8" height="13" rx="1" />
          <rect x="3" y="3" width="8" height="8" rx="1" />
        </g>
      );
    case 'backtest':
      return (
        <g stroke={stroke} strokeWidth="1.4" fill="none">
          <path d="M3 18l5-5 4 3 8-11" />
          <path d="M15 5h5v5" />
        </g>
      );
  }
}

function edgePath(a: LayerId, b: LayerId): { d: string; from: { x: number; y: number }; to: { x: number; y: number } } {
  const p0 = POS[a];
  const p1 = POS[b];
  if (Math.abs(p0.y - p1.y) < 1) {
    const dir = p1.x > p0.x ? 1 : -1;
    return { d: `M${p0.x + 95 * dir},${p0.y} L${p1.x - 95 * dir},${p1.y}`, from: { x: p0.x + 95 * dir, y: p0.y }, to: { x: p1.x - 95 * dir, y: p1.y } };
  }
  const dir = p1.y > p0.y ? 1 : -1;
  return { d: `M${p0.x},${p0.y + 46 * dir} L${p1.x},${p1.y - 46 * dir}`, from: { x: p0.x, y: p0.y + 46 * dir }, to: { x: p1.x, y: p1.y - 46 * dir } };
}

function lerp(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function bezier(p0: { x: number; y: number }, c: { x: number; y: number }, p1: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
}

export default function FlowGraph({
  layers,
  status,
  progress,
  vt,
  events,
  onSelect,
  selected,
  short,
}: {
  layers: RunArtifact['layers'];
  status: Record<LayerId, StageStatus>;
  progress: Record<LayerId, number>;
  vt: number;
  events: LayerEvent[];
  onSelect: (id: LayerId) => void;
  selected: LayerId;
  short: Record<LayerId, string>;
}) {
  const pulses = events.filter((e) => e.kind !== 'gate' && vt - e.t >= 0 && vt - e.t < 1000);

  return (
    <svg viewBox="0 0 1000 430" className="flow">
      <defs>
        <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {LAYERS.filter((l) => PREV[l.id]).map((l) => {
        const from = PREV[l.id]!;
        const { d } = edgePath(from, l.id);
        const active = status[from] !== 'idle' && status[l.id] !== 'idle';
        return (
          <g key={`${from}-${l.id}`}>
            <path d={d} className="flow-edge" stroke={active ? LAYER_BY_ID.get(l.id)!.color : '#1e293b'} opacity={active ? 0.55 : 0.28} />
          </g>
        );
      })}

      {pulses.map((e, i) => {
        const from = PREV[e.layer];
        if (!from) return null;
        const t = Math.min(1, Math.max(0, (vt - e.t) / 1000));
        const { from: a, to: b } = edgePath(from, e.layer);
        const pt = lerp(a, b, t);
        const color = LAYER_BY_ID.get(e.layer)!.color;
        return <circle key={`${e.t}-${i}`} cx={pt.x} cy={pt.y} r={t > 0.85 ? 2 : 3.2} fill={color} filter="url(#glow)" opacity={1 - t * 0.5} />;
      })}

      {LAYERS.map((meta) => {
        const p = POS[meta.id];
        const st = status[meta.id];
        const color = STATUS_COLOR[st];
        const layer = layers.find((l) => l.id === meta.id);
        const isSel = selected === meta.id;
        const w = 190;
        const h = 92;
        return (
          <g key={meta.id} transform={`translate(${p.x},${p.y})`} onClick={() => onSelect(meta.id)} className="flow-node">
            <rect
              x={-w / 2}
              y={-h / 2}
              width={w}
              height={h}
              rx="12"
              fill={st === 'idle' ? 'rgba(148,163,184,0.03)' : 'rgba(15,23,42,0.72)'}
              stroke={isSel ? meta.color : color}
              strokeWidth={isSel ? 2 : 1.2}
              opacity={st === 'idle' ? 0.55 : 1}
              filter={st === 'running' ? 'url(#glow)' : undefined}
            />
            <g transform="translate(12,-30)">
              <Glyph id={meta.id} color={st === 'idle' ? '#475569' : meta.color} />
            </g>
            <text x="46" y="-18" className="node-title" opacity={st === 'idle' ? 0.5 : 1}>
              {meta.label}
            </text>
            <text x="46" y="-3" className="node-sub">
              {meta.sub}
            </text>
            <text x="12" y="18" className="node-sum">
              {(short[meta.id] ?? '· waiting').slice(0, 24)}
            </text>
            <text x={w - 12} y="18" textAnchor="end" className="node-ms">
              {layer?.ms ? `${layer.ms}ms` : ''}
            </text>
            <rect x="12" y="30" width={w - 24} height="4" rx="2" fill="#1e293b" />
            <rect x="12" y="30" width={(w - 24) * (progress[meta.id] ?? 0)} height="4" rx="2" fill={meta.color} opacity="0.9" />
            <circle cx={w - 14} cy={-34} r="4" fill={color} className={st === 'running' ? 'pulse' : ''} />
          </g>
        );
      })}

      <g>
        <rect x="18" y="398" width="150" height="22" rx="11" fill="rgba(148,163,184,0.06)" stroke="#1e293b" />
        <circle cx="34" cy="409" r="4" fill={STATUS_COLOR.done} />
        <text x="44" y="413" className="legend-sm">
          gate passed
        </text>
        <rect x="178" y="398" width="130" height="22" rx="11" fill="rgba(148,163,184,0.06)" stroke="#1e293b" />
        <circle cx="194" cy="409" r="4" fill={STATUS_COLOR.warn} />
        <text x="204" y="413" className="legend-sm">
          warn
        </text>
        <rect x="318" y="398" width="130" height="22" rx="11" fill="rgba(148,163,184,0.06)" stroke="#1e293b" />
        <circle cx="334" cy="409" r="4" fill={STATUS_COLOR.fail} />
        <text x="344" y="413" className="legend-sm">
          blocked
        </text>
        <text x="982" y="413" textAnchor="end" className="legend-sm">
          click a stage · replay below
        </text>
      </g>
    </svg>
  );
}
