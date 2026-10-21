import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LayerEvent, LayerId, RunArtifact } from '@rh-layers/core';
import FlowGraph, { type StageStatus } from './components/FlowGraph';
import StageRail from './components/StageRail';
import Timeline from './components/Timeline';
import { AssetPassport, LayerView } from './components/LayerViews';
import { LAYERS, LAYER_BY_ID } from './lib/meta';
import { Badge } from './components/charts';

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

function useReplay(events: LayerEvent[]) {
  const maxT = Math.max(1, ...events.map((e) => e.t));
  const scale = 9000 / maxT;
  const total = Math.max(2000, Math.round(maxT * scale));
  const virtual = useMemo(() => events.map((e) => ({ ...e, t: Math.round(e.t * scale) })), [events, scale]);
  const end = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('t') === 'end';

  const [vt, setVt] = useState(end ? total : 0);
  const [playing, setPlaying] = useState(!end);
  const [speed, setSpeed] = useState(1);

  const vtRef = useRef(vt);
  useEffect(() => {
    vtRef.current = vt;
  }, [vt]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = now - prev;
      prev = now;
      const next = Math.min(total, vtRef.current + dt * speed);
      vtRef.current = next;
      setVt(next);
      if (next >= total) setPlaying(false);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, total]);

  return {
    vt,
    virtual,
    total,
    playing,
    speed,
    seek: (v: number) => {
      setPlaying(false);
      vtRef.current = v;
      setVt(v);
    },
    toggle: () => setPlaying((p) => !p),
    setSpeed,
    reset: () => {
      vtRef.current = 0;
      setVt(0);
      setPlaying(true);
    },
  };
}

function statusAt(layer: RunArtifact['layers'][number], vt: number, events: LayerEvent[]): StageStatus {
  const seen = layer.events.filter((e) => e.t <= vt);
  if (!seen.length) return 'idle';
  if (seen.some((e) => e.kind === 'error')) return 'fail';
  const last = seen[seen.length - 1];
  if (last.kind === 'end') return layer.gate.level === 'pass' ? 'done' : layer.gate.level === 'warn' ? 'warn' : 'fail';
  return 'running';
}

export default function App() {
  const [run, setRun] = useState<RunArtifact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pinned, setPinned] = useState<LayerId | null>(null);
  const [symbol, setSymbol] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}runs/latest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`run artifact not found (${r.status})`);
        return r.json() as Promise<RunArtifact>;
      })
      .then(setRun)
      .catch((e: Error) => setError(e.message));
  }, []);

  const rawEvents = useMemo(() => (run ? run.layers.flatMap((l) => l.events).sort((a, b) => a.t - b.t) : []), [run]);
  const replay = useReplay(rawEvents);

  if (error || !run) {
    return (
      <div className="empty">
        <div className="empty-card">
          <div className="empty-kicker">RH LAYERS</div>
          <h1>No run artifact yet</h1>
          <p>
            Generate one with <code>pnpm fetch && pnpm pipeline</code>, then reload. The UI replays the recorded event log; it does not call
            market data at runtime.
          </p>
          {error && <div className="callout warn">{error}</div>}
        </div>
      </div>
    );
  }

  const virtual = replay.virtual;
  const status = Object.fromEntries(
    run.layers.map((l) => [l.id, statusAt(l, replay.vt, virtual)]),
  ) as Record<LayerId, StageStatus>;
  const progress = Object.fromEntries(
    run.layers.map((l) => {
      const total = Math.max(1, l.events.length);
      return [l.id, l.events.filter((e) => e.t <= replay.vt).length / total];
    }),
  ) as Record<LayerId, number>;

  const active = (['backtest', 'build', 'corr', 'signal', 'screen', 'metrics', 'clean', 'sources'] as LayerId[]).find(
    (id) => status[id] === 'running',
  ) ?? (['backtest', 'build', 'corr', 'signal', 'screen', 'metrics', 'clean', 'sources'] as LayerId[]).find((id) => status[id] !== 'idle');
  const focus: LayerId = pinned ?? active ?? 'sources';
  const meta = LAYER_BY_ID.get(focus)!;
  const layer = run.layers.find((l) => l.id === focus)!;
  const gatesPassed = run.layers.filter((l) => l.gate.level === 'pass').length;

  const hrp = run.backtest.stats['HRP core'];

  const short: Record<LayerId, string> = {
    sources: `${run.screen.pool.length} assets`,
    clean: `${run.weekly.dates.length} weeks`,
    metrics: `${Object.keys(run.metrics).length} series`,
    screen: `${run.screen.pool.length} kept`,
    signal: `${Object.keys(run.signals).length} signals`,
    corr: `${run.corr.clusters.length} clusters`,
    build: `${Object.entries(run.weights).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'} ${pct(Object.entries(run.weights).sort((a, b) => b[1] - a[1])[0]?.[1] ?? 0, 0)}`,
    backtest: `${pct(hrp.cagr)} CAGR`,
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">◧</span>
          <div>
            <h1>
              RH <span className="brand-thin">LAYERS</span>
            </h1>
            <p>eight governed stages · one replayable run</p>
          </div>
        </div>
        <div className="head-stats">
          <div className="head-stat">
            <span>run</span>
            <b className="mono">{run.runId}</b>
          </div>
          <div className="head-stat">
            <span>assets</span>
            <b className="mono">{run.screen.pool.length}/{run.universe.length}</b>
          </div>
          <div className="head-stat">
            <span>clusters</span>
            <b className="mono">{run.corr.clusters.length}</b>
          </div>
          <div className="head-stat">
            <span>HRP CAGR</span>
            <b className="mono pos">{pct(hrp.cagr)}</b>
          </div>
          <div className="head-stat">
            <span>max DD</span>
            <b className="mono neg">{pct(hrp.maxDD)}</b>
          </div>
          <div className="head-stat">
            <span>gates</span>
            <b className="mono">
              {gatesPassed}/{run.layers.length}
            </b>
          </div>
          <Badge tone={gatesPassed === run.layers.length ? 'ok' : 'warn'}>{gatesPassed === run.layers.length ? 'all gates passed' : 'review gates'}</Badge>
        </div>
      </header>

      <div className="body">
        <StageRail run={run} status={status} progress={progress} selected={focus} onSelect={(id) => setPinned(id)} />

        <main className="center">
          <FlowGraph
            layers={run.layers}
            status={status}
            progress={progress}
            vt={replay.vt}
            events={virtual}
            onSelect={(id) => setPinned(id)}
            selected={focus}
            short={short}
          />
          <Timeline
            run={{ ...run, layers: run.layers.map((l) => ({ ...l, events: virtual.filter((e) => e.layer === l.id) })) }}
            vt={replay.vt}
            total={replay.total}
            playing={replay.playing}
            speed={replay.speed}
            onSeek={replay.seek}
            onToggle={replay.toggle}
            onSpeed={replay.setSpeed}
            onReset={replay.reset}
          />
          <div className="log">
            <div className="log-head">
              <span>event stream</span>
              <span className="mono">{virtual.filter((e) => e.t <= replay.vt).length} / {virtual.length}</span>
            </div>
            <div className="log-rows">
              {virtual
                .filter((e) => e.t <= replay.vt)
                .slice(-14)
                .reverse()
                .map((e, i) => (
                  <div key={`${e.t}-${i}`} className="log-row">
                    <span className="log-t mono">{(e.t / 1000).toFixed(2)}s</span>
                    <span className="log-dot" style={{ background: LAYER_BY_ID.get(e.layer)?.color }} />
                    <span className="log-layer">{e.layer}</span>
                    <span className="log-msg">{e.msg}</span>
                  </div>
                ))}
            </div>
          </div>
          <div className="center-foot">
            <span className="mono dim">
              {run.weekly.dates[0]} → {run.weekly.dates.at(-1)} · {run.weekly.dates.length} weeks · costs {run.config.costBps}bp
            </span>
            <span className="mono dim">data: public series · no live trading · not investment advice</span>
          </div>
        </main>

        <aside className="inspector">
          <div className="insp-head">
            <div>
              <div className="insp-kicker">
                stage {String(LAYERS.findIndex((l) => l.id === focus) + 1).padStart(2, '0')} / 08
              </div>
              <h2 style={{ color: meta.color }}>{meta.label}</h2>
              <p>
                {meta.input} <span className="arrow">→</span> {meta.output}
              </p>
            </div>
            <span className={`pill pill-${layer.gate.level}`}>{layer.gate.level}</span>
          </div>
          <div className="gate-row">
            {layer.gate.checks.map((c) => (
              <span key={c.name} className={`gate ${c.ok ? 'ok' : 'bad'}`} title={c.detail}>
                {c.ok ? '✓' : '✕'} {c.name}
              </span>
            ))}
          </div>
          <div className="insp-body">
            <LayerView run={run} layer={focus} selectedSymbol={symbol} onSelect={setSymbol} />
          </div>
          {symbol && (
            <div className="passport-wrap">
              <button className="close" onClick={() => setSymbol(null)}>
                ✕
              </button>
              <AssetPassport run={run} symbol={symbol} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
