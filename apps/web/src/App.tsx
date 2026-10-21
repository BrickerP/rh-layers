import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LayerEvent, LayerId, RunArtifact } from '@rh-layers/core';
import FlowGraph, { type StageStatus } from './components/FlowGraph';
import Timeline from './components/Timeline';
import { AssetPassport, LayerView } from './components/LayerViews';
import ResultView from './components/ResultView';
import DataView from './components/DataView';
import PortfolioView from './components/PortfolioView';
import { LAYERS, LAYER_BY_ID } from './lib/meta';

type Tab = 'portfolio' | 'result' | 'process' | 'data';

function useReplay(events: LayerEvent[]) {
  const maxT = Math.max(1, ...events.map((e) => e.t));
  const scale = 9000 / maxT;
  const total = Math.max(2000, Math.round(maxT * scale));
  const virtual = useMemo(() => events.map((e) => ({ ...e, t: Math.round(e.t * scale) })), [events, scale]);

  const [vt, setVt] = useState(total);
  const [playing, setPlaying] = useState(false);
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
  const [tab, setTab] = useState<Tab>('portfolio');
  const [focus, setFocus] = useState<LayerId>('backtest');
  const [symbol, setSymbol] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

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
            Generate one with <code>pnpm refresh</code>, then reload.
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
  const layer = run.layers.find((l) => l.id === focus)!;
  const meta = LAYER_BY_ID.get(focus)!;
  const hrp = run.backtest.stats['HRP core'];

  const metric: Record<LayerId, string> = {
    sources: run.discovery.discovered.toLocaleString(),
    clean: `${run.weekly.dates.length}w`,
    metrics: String(Object.keys(run.metrics).length),
    screen: String(run.screen.pool.length),
    signal: String(Object.keys(run.signals).length),
    corr: String(run.corr.clusters.length),
    build: String(Object.keys(run.weights).length),
    backtest: `${(hrp.cagr * 100).toFixed(1)}%`,
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
            <p>asset pipeline</p>
          </div>
        </div>

        <nav className="tabs">
          {(['portfolio', 'result', 'process', 'data'] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>

        <div className="head-right">
          <div className="head-stat">
            <span>as of</span>
            <b className="mono-sm">{run.weekly.dates.at(-1)}</b>
          </div>
          <div className="head-stat">
            <span>run</span>
            <b className="mono-sm">{run.runId}</b>
          </div>
        </div>
      </header>

      {tab === 'portfolio' && (
        <main className="page">
          <PortfolioView />
        </main>
      )}

      {tab === 'result' && (
        <main className="page result-page">
          <ResultView
            run={run}
            onStage={(id) => {
              setFocus(id);
              setTab('process');
            }}
            onSymbol={setSymbol}
          />
        </main>
      )}

      {tab === 'data' && (
        <main className="page data-page">
          <DataView run={run} />
        </main>
      )}

      {tab === 'process' && (
        <main className="process-page">
          <section className="canvas">
            <FlowGraph
              layers={run.layers}
              status={status}
              progress={progress}
              vt={replay.vt}
              events={virtual}
              selected={focus}
              onSelect={setFocus}
              metric={metric}
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
            <button className="log-toggle" onClick={() => setShowLog((v) => !v)}>
              {showLog ? 'hide event log' : 'show event log'} · {virtual.length} events
            </button>
            {showLog && (
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
            )}
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
        </main>
      )}

      {tab !== 'process' && symbol && (
        <div className="drawer">
          <button className="close" onClick={() => setSymbol(null)}>
            ✕
          </button>
          <AssetPassport run={run} symbol={symbol} />
        </div>
      )}
    </div>
  );
}
