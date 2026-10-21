import type { RunConfig } from './types';

export const DEFAULT_CONFIG: Omit<RunConfig, 'runId'> = {
  windowWeeks: 260,
  rebalanceWeeks: 13,
  costBps: 10,
  maxAssetWeight: 0.2,
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
  cashMin: 0,
  smaWindow: 200,
  momLookback: 252,
};
