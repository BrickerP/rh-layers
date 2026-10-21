import React from 'react';
import type { LayerId, RunArtifact } from '@rh-layers/core';
import { LAYERS } from '../lib/meta';
import type { StageStatus } from './FlowGraph';

const TONE: Record<StageStatus, string> = {
  idle: '#475569',
  running: '#38bdf8',
  done: '#34d399',
  warn: '#fbbf24',
  fail: '#f472b6',
};

export default function StageRail({
  run,
  status,
  progress,
  selected,
  onSelect,
}: {
  run: RunArtifact;
  status: Record<LayerId, StageStatus>;
  progress: Record<LayerId, number>;
  selected: LayerId;
  onSelect: (id: LayerId) => void;
}) {
  return (
    <nav className="rail">
      <div className="rail-title">
        layers <span className="dim">/ governance</span>
      </div>
      {LAYERS.map((meta, i) => {
        const layer = run.layers.find((l) => l.id === meta.id);
        const st = status[meta.id];
        return (
          <button key={meta.id} className={`rail-item ${selected === meta.id ? 'active' : ''}`} onClick={() => onSelect(meta.id)}>
            <span className="rail-idx">{String(i + 1).padStart(2, '0')}</span>
            <span className="rail-dot" style={{ background: TONE[st], boxShadow: st === 'running' ? `0 0 10px ${TONE[st]}` : undefined }} />
            <span className="rail-body">
              <span className="rail-label">
                {meta.label}
                <span className="rail-ms">{layer?.ms ? `${layer.ms}ms` : ''}</span>
              </span>
              <span className="rail-sub">{meta.input}</span>
              <span className="rail-bar">
                <span style={{ width: `${(progress[meta.id] ?? 0) * 100}%`, background: meta.color }} />
              </span>
              <span className="rail-checks">
                {layer?.gate.checks.map((c) => (
                  <span key={c.name} className={`check-dot ${c.ok ? 'ok' : 'bad'}`} title={`${c.name}: ${c.detail}`} />
                ))}
              </span>
            </span>
          </button>
        );
      })}
      <div className="rail-foot">
        <div className="mono dim">{run.config.windowWeeks}w window · {run.config.rebalanceWeeks}w rebalance</div>
        <div className="mono dim">cost {run.config.costBps}bp · caps {Math.round(run.config.maxAssetWeight * 100)}%/{Math.round(run.config.maxClusterWeight * 100)}%</div>
      </div>
    </nav>
  );
}
