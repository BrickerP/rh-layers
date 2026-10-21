import type { RunConfig } from './types';

export const DEFAULT_CONFIG: Omit<RunConfig, 'runId'> = {
  windowWeeks: 260,
  rebalanceWeeks: 26,
  costBps: 10,
  maxAssetWeight: 0.1,
  maxClusterWeight: 0.65,
  maxCryptoWeight: 0.08,
  classCaps: {
    Equity: 0.55,
    'Fixed Income': 0.6,
    Commodity: 0.2,
    'Real Estate': 0.1,
    'Real Assets': 0.1,
    Crypto: 0.08,
  },
  minHistoryWeeks: 260,
  maxPoolSize: 150,
  buildMode: 'momentum',
  momentumTop: 20,
  momentumLookback: 52,
  momentumTrend: 40,
  classQuotas: { Equity: 100, 'Fixed Income': 22, Commodity: 10, 'Real Estate': 6, 'Real Assets': 6, Crypto: 10 },
  cashMin: 0,
  smaWindow: 200,
  momLookback: 252,
};
