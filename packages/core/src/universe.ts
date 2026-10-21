import type { AssetSpec } from './types';

export const UNIVERSE: AssetSpec[] = [
  { symbol: 'SPY', name: 'US Large Cap', cls: 'Equity', role: 'core', rationale: 'US earnings growth + buyback bid; the global risk anchor.' },
  { symbol: 'QQQ', name: 'US Growth / Tech', cls: 'Equity', role: 'satellite', rationale: 'AI capex cycle concentrates in large-cap tech.' },
  { symbol: 'IWM', name: 'US Small Cap', cls: 'Equity', role: 'satellite', rationale: 'Domestic cyclical beta; diversifies mega-cap concentration.' },
  { symbol: 'EFA', name: 'Developed ex-US', cls: 'Equity', role: 'core', rationale: 'Cheaper valuations, different sector mix than the US.' },
  { symbol: 'EEM', name: 'Emerging Markets', cls: 'Equity', role: 'satellite', rationale: 'Growth and commodity beta, with political risk.' },
  { symbol: 'EWJ', name: 'Japan', cls: 'Equity', role: 'satellite', rationale: 'Corporate governance reform and reflation.' },
  { symbol: 'VGK', name: 'Europe', cls: 'Equity', role: 'satellite', rationale: 'Fiscal expansion and defense/industrial capex.' },
  { symbol: 'AGG', name: 'US Aggregate Bonds', cls: 'Fixed Income', role: 'core', rationale: 'Investment-grade duration; the 60/40 ballast.' },
  { symbol: 'SHY', name: 'US 1-3y Treasuries', cls: 'Fixed Income', role: 'core', rationale: 'Cash-like duration for liquidity and dry powder.' },
  { symbol: 'IEF', name: 'US 7-10y Treasuries', cls: 'Fixed Income', role: 'core', rationale: 'Intermediate duration; recession hedge.' },
  { symbol: 'TLT', name: 'US 20y+ Treasuries', cls: 'Fixed Income', role: 'satellite', rationale: 'Long duration; powerful but fiscal-risk sensitive.' },
  { symbol: 'TIP', name: 'US TIPS', cls: 'Fixed Income', role: 'core', rationale: 'Explicit inflation compensation.' },
  { symbol: 'LQD', name: 'US IG Credit', cls: 'Fixed Income', role: 'core', rationale: 'Spread carry over Treasuries.' },
  { symbol: 'HYG', name: 'US High Yield', cls: 'Fixed Income', role: 'satellite', rationale: 'Equity-like carry; credit cycle risk.' },
  { symbol: 'EMB', name: 'EM USD Debt', cls: 'Fixed Income', role: 'satellite', rationale: 'EM sovereign spread and dollar sensitivity.' },
  { symbol: 'GLD', name: 'Gold', cls: 'Commodity', role: 'core', rationale: 'Monetary debasement and real-rate hedge.' },
  { symbol: 'SLV', name: 'Silver', cls: 'Commodity', role: 'satellite', rationale: 'Monetary + industrial demand; higher beta than gold.' },
  { symbol: 'DBC', name: 'Broad Commodities', cls: 'Commodity', role: 'satellite', rationale: 'Supply-shock and inflation hedge.' },
  { symbol: 'VNQ', name: 'US REITs', cls: 'Real Estate', role: 'satellite', rationale: 'Real-asset income, rate sensitive.' },
  { symbol: 'IGF', name: 'Global Infrastructure', cls: 'Real Assets', role: 'satellite', rationale: 'Regulated cash flows and capex cycle exposure.' },
  { symbol: 'BTC-USD', name: 'Bitcoin', cls: 'Crypto', role: 'satellite', rationale: 'Scarce digital asset; unstable correlation, size carefully.' },
  { symbol: 'ETH-USD', name: 'Ethereum', cls: 'Crypto', role: 'satellite', rationale: 'Smart-contract platform beta.' },
  { symbol: 'SOL-USD', name: 'Solana', cls: 'Crypto', role: 'satellite', rationale: 'High-beta crypto; short history, likely screened out.' },
];

/** Event contracts are modelled separately: binary, terminal payoff, no covariance role. */
export const EVENT_UNIVERSE: AssetSpec[] = [
  { symbol: 'EVENT.SLEEVE', name: 'Event contracts sleeve', cls: 'Event', role: 'overlay', rationale: 'Capped sleeve, priced as probabilities, never in the covariance matrix.' },
];

export const BY_SYMBOL = new Map([...UNIVERSE, ...EVENT_UNIVERSE].map((a) => [a.symbol, a]));
