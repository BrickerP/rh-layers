import React from 'react';
import type { RunArtifact } from '@rh-layers/core';

export default function Timeline({
  run,
  vt,
  total,
  playing,
  speed,
  onSeek,
  onToggle,
  onSpeed,
  onReset,
}: {
  run: RunArtifact;
  vt: number;
  total: number;
  playing: boolean;
  speed: number;
  onSeek: (v: number) => void;
  onToggle: () => void;
  onSpeed: (v: number) => void;
  onReset: () => void;
}) {
  const ends = run.layers
    .map((l) => ({ id: l.id, t: Math.max(0, ...l.events.map((e) => e.t)) }))
    .filter((e) => e.t > 0);

  return (
    <div className="timeline">
      <button className="play" onClick={onToggle} title={playing ? 'pause' : 'play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button className="ghost-btn" onClick={onReset} title="restart">
        ↺
      </button>
      <div className="track">
        <input
          type="range"
          min={0}
          max={total}
          value={vt}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="replay position"
        />
        <div className="markers">
          {ends.map((e) => (
            <span key={e.id} className="marker" style={{ left: `${(e.t / total) * 100}%` }} title={e.id} />
          ))}
        </div>
      </div>
      <div className="speed">
        {[2, 6, 14].map((s) => (
          <button key={s} className={speed === s ? 'on' : ''} onClick={() => onSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
      <div className="clock mono">
        {Math.round(vt)} / {Math.round(total)} ms
      </div>
    </div>
  );
}
