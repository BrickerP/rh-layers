const DEFAULT_URL = 'https://agent.robinhood.com/mcp/trading';

interface RpcResponse {
  jsonrpc: '2.0';
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface RhBar {
  begins_at: string;
  open_price: string;
  close_price: string;
  high_price: string;
  low_price: string;
  volume: number;
  session: string;
}

/**
 * Minimal streamable-HTTP MCP client. Read-only tools only.
 * The token comes from the environment (GitHub secret in CI); nothing is persisted.
 */
export class RhClient {
  private id = 0;

  constructor(private readonly token: string, private readonly url = DEFAULT_URL) {}

  private async post(body: Record<string, unknown>): Promise<RpcResponse> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`mcp: HTTP ${res.status} ${text.slice(0, 160)}`);
    if (!text.trim()) return { jsonrpc: '2.0' };
    const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
    const payload = (dataLine ? dataLine.slice(6) : text).trim();
    return JSON.parse(payload) as RpcResponse;
  }

  async init(): Promise<void> {
    const res = await this.post({
      jsonrpc: '2.0',
      id: ++this.id,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'rh-layers', version: '0.1.0' },
      },
    });
    if (res.error) throw new Error(`mcp init: ${res.error.message}`);
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => undefined);
  }

  async call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const res = await this.post({
      jsonrpc: '2.0',
      id: ++this.id,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    if (res.error) throw new Error(`mcp ${name}: ${res.error.message}`);
    const result = res.result as { isError?: boolean; content?: { type: string; text?: string }[] } | undefined;
    const text = result?.content?.find((c) => c.type === 'text')?.text;
    if (result?.isError) throw new Error(`mcp ${name}: ${text ?? 'tool error'}`);
    if (!text) throw new Error(`mcp ${name}: empty result`);
    return JSON.parse(text) as T;
  }

  async equityBars(symbols: string[], start: string, interval = 'day', adjustment = 'split'): Promise<Record<string, RhBar[]>> {
    const payload = await this.call<{ data: { results: { symbol: string; bars: RhBar[] }[] } }>('get_equity_historicals', {
      symbols,
      start_time: start,
      interval,
      adjustment_type: adjustment,
      bounds: 'regular',
    });
    const out: Record<string, RhBar[]> = {};
    for (const r of payload.data.results ?? []) out[r.symbol] = r.bars ?? [];
    return out;
  }

  /** Current trailing distribution yield, used to approximate total return on split-only prices. */
  async dividendYields(symbols: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    try {
      const payload = await this.call<{ data: { results: { symbol: string; dividend_yield?: string | null }[] } }>('get_equity_fundamentals', {
        symbols,
      });
      for (const r of payload.data.results ?? []) {
        const y = Number(r.dividend_yield ?? 0);
        if (Number.isFinite(y) && y > 0) out[r.symbol] = y / 100;
      }
    } catch {
      /* yield enrichment is best-effort */
    }
    return out;
  }
}

