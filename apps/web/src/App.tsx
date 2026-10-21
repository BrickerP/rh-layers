import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LayerEvent, LayerId, RunArtifact } from '@rh-layers/core';
import FlowGraph, { type StageStatus } from './components/FlowGraph';
import Timeline from './components/Timeline';
import { AssetPassport, LayerView } from './components/LayerViews';
import { LAYERS, LAYER_BY_ID } from './lib/meta';

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

function statusAt(layer: RunArtifact['layers'][number], vt: number): StageStatus {
  const seen = layer.events.filter((e) => e.t <= vt);
  if (!seen.length) return 'idle';
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
          <div className="kicker">RH LAYERS</div>
          <h1>No run artifact</h1>
          <p>
            Generate one with <code>pnpm discover && pnpm fetch:broad && pnpm pipeline</code>. The UI only replays the recorded event log.
          </p>
          {error && <div className="callout warn">{error}</div>}
        </div>
      </div>
    );
  }

  const virtual = replay.virtual;
  const status = Object.fromEntries(run.layers.map((l) => [l.id, statusAt(l, replay.vt)])) as Record<LayerId, StageStatus>;
  const progress = Object.fromEntries(
    run.layers.map((l) => [l.id, l.events.filter((e) => e.t <= replay.vt).length / Math.max(1, l.events.length)]),
  ) as Record<LayerId, number>;

  const order: LayerId[] = ['backtest', 'build', 'corr', 'signal', 'screen', 'metrics', 'clean', 'sources'];
  const active = order.find((id) => status[id] === 'running') ?? order.find((id) => status[id] !== 'idle');
  const focus: LayerId = pinned ?? active ?? 'sources';
  const meta = LAYER_BY_ID.get(focus)!;
  const layer = run.layers.find((l) => l.id === focus)!;
  const hrp = run.backtest.stats['HRP core'];
  const positions = Object.keys(run.weights).length;
  const gatesPassed = run.layers.filter((l) => l.gate.level === 'pass').length;
  const discovery = run.discovery ?? { discovered: run.universe.length, candidates: run.universe.length, fetched: run.universe.length, pool: run.screen.pool.length, stocks: 0, etfs: 0, crypto: 0 };

  const metric: Record<LayerId, string> = {
    sources: discovery.discovered.toLocaleString(),
    clean: `${run.weekly.dates.length}w`,
    metrics: String(Object.keys(run.metrics).length),
    screen: String(run.screen.pool.length),
    signal: String(Object.keys(run.signals).length),
    corr: String(run.corr.clusters.length),
    build: String(positions),
    backtest: pct(hrp.cagr, 1),
  };

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="mark">◧</span>
          <div>
            <h1>
              RH <span>LAYERS</span>
            </h1>
            <p>asset pipeline · replayable run</p>
          </div>
        </div>

        <div className="funnel">
          <div className="f-step">
            <span>discovered</span>
            <b>{discovery.discovered.toLocaleString()}</b>
          </div>
          <i>→</i>
          <div className="f-step">
            <span>candidates</span>
            <b>{discovery.candidates}</b>
          </div>
          <i>→</i>
          <div className="f-step">
            <span>history</span>
            <b>{discovery.fetched}</b>
          </div>
          <i>→</i>
          <div className="f-step">
            <span>pool</span>
            <b>{run.screen.pool.length}</b>
          </div>
          <i>→</i>
          <div className="f-step accent">
            <span>positions</span>
            <b>{positions}</b>
          </div>
        </div>

        <div className="head-right">
          <div className="head-stat">
            <span>HRP CAGR</span>
            <b className="pos">{pct(hrp.cagr)}</b>
          </div>
          <div className="head-stat">
            <span>max DD</span>
            <b className="neg">{pct(hrp.maxDD)}</b>
          </div>
          <div className="head-stat">
            <span>gates</span>
            <b>
              {gatesPassed} pass · {run.layers.filter((l) => l.gate.level === 'warn').length} warn
            </b>
          </div>
          <div className="head-stat">
            <span>run</span>
            <b className="mono-sm">{run.runId}</b>
          </div>
        </div>
      </header>

      <div className="main">
        <section className="canvas">
          <FlowGraph
            layers={run.layers}
            status={status}
            progress={progress}
            vt={replay.vt}
            events={virtual}
            selected={focus}
            onSelect={setPinned}
            metric={metric}
          />

          <div className="strip">
            <div>
              <span>window</span>
              <b className="mono-sm">
                {run.weekly.dates[0]} → {run.weekly.dates.at(-1)}
              </b>
            </div>
            <div>
              <span>universe</span>
              <b className="mono-sm">
                {discovery.stocks.toLocaleString()} stocks · {discovery.etfs.toLocaleString()} ETFs · {discovery.crypto} crypto
              </b>
            </div>
            <div>
              <span>cash</span>
              <b className="mono-sm">{pct(run.cash)}</b>
            </div>
            <div>
              <span>costs</span>
              <b className="mono-sm">{run.config.costBps}bp · {run.config.rebalanceWeeks}w rebalance</b>
            </div>
          </div>

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
              <span className="mono-sm">
                {virtual.filter((e) => e.t <= replay.vt).length} / {virtual.length}
              </span>
            </div>
            <div className="log-rows">
              {virtual
                .filter((e) => e.t <= replay.vt)
                .slice(-18)
                .reverse()
                .map((e, i) => (
                  <div key={`${e.t}-${i}`} className="log-row">
                    <span className="log-t">{(e.t / 1000).toFixed(2)}s</span>
                    <span className="log-dot" style={{ background: LAYER_BY_ID.get(e.layer)?.color }} />
                    <span className="log-layer">{e.layer}</span>
                    <span className="log-msg">{e.msg}</span>
                  </div>
                ))}
            </div>
          </div>
        </section>

        <aside className="inspector">
          <div className="insp-head">
            <div>
              <div className="kicker">
                stage {String(LAYERS.findIndex((l) => l.id === focus) + 1).padStart(2, '0')} / 08
              </div>
              <h2 style={{ color: meta.color }}>{meta.label}</h2>
              <p>
                {meta.input} <span>→</span> {meta.output}
              </p>
            </div>
            <span className={`pill ${layer.gate.level}`}>{layer.gate.level}</span>
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
