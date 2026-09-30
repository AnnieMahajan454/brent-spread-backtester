// Typed client for the FastAPI backend.
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

export type Series = { t: string[] } & Record<string, (number | null)[] | string[]>

export interface Metrics {
  net_pnl: number
  gross_pnl: number
  costs: number
  contracts_traded: number
  sharpe: number
  max_drawdown: number
  pct_days_positive: number
  n_days: number
}

export interface StrategyResult {
  naive: Metrics
  in_sample: Metrics
  out_of_sample: Metrics
  strict_data_out_of_sample: Metrics
  per_instrument: Record<string, { net_pnl: number; valid_hours: number }>
  net_pnl_by_cost_multiplier: Record<string, number>
  // rule strategies
  hindsight_params?: Record<string, number>
  walk_forward_choices?: { test_start: string; params: Record<string, number>; train_pnl: number }[]
  n_param_sets?: number
  n_profitable_param_sets?: number
  all_param_pnls?: Record<string, number>
  // ML
  in_sample_r2?: number
  folds?: { test_start: string; train_rows: number; pred_vs_actual_corr: number | null }[]
  feature_importance?: Record<string, number>
}

export interface Study {
  data: {
    source: string
    start: string
    end: string
    n_hours: number
    contracts: string[]
    bars_per_contract: Record<string, number>
    last_price: Record<string, number>
    instruments: string[]
    valid_hours: Record<string, number>
    max_stale_hours: number
    exec_lag_hours: number
    slippage_ticks: Record<string, number>
    fees_per_contract_usd: number
    test_start: string
    test_end: string
    n_folds: number
  }
  strategies: Record<string, StrategyResult>
}

export interface Market {
  source: string
  start: string
  end: string
  n_hours: number
  contracts: string[]
  last_price: Record<string, number>
  bars_per_contract: Record<string, number>
  liquid_contracts: string[]
  curve_snapshots: { date: string; prices: Record<string, number> }[]
}

export interface SpreadsResponse {
  legs: Record<string, Record<string, number>>
  valid_hours: Record<string, number>
  prices: Series
}

export interface LabRequest {
  strategy: 'mean_reversion' | 'momentum'
  lookback: number
  entry_z: number
  exit_z: number
  threshold: number
  cost_mult: number
  exec_lag: number
  max_stale: number
  period: 'test' | 'full'
  instruments?: string[] | null
}

export interface LabResponse {
  request: LabRequest
  metrics: Metrics
  instruments: string[]
  per_instrument: Record<string, number>
  equity: Series
  walk_forward_net_pnl: number | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') detail = body.detail
      else if (Array.isArray(body.detail)) detail = body.detail.map((d: { msg: string }) => d.msg).join('; ')
    } catch { /* not json */ }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => request<{ status: string; data_end: string }>('/api/health'),
  market: () => request<Market>('/api/market'),
  spreads: (maxStale = 2) => request<SpreadsResponse>(`/api/spreads?max_stale=${maxStale}`),
  study: () => request<Study>('/api/study'),
  equity: (strategy: string) => request<Series>(`/api/study/equity/${strategy}`),
  runLab: (body: LabRequest) => request<LabResponse>('/api/lab/run', { method: 'POST', body: JSON.stringify(body) }),
}

export const STRATEGY_IDS: Record<string, string> = {
  'Mean reversion': 'mean_reversion',
  Momentum: 'momentum',
  'ML ranking': 'ml_ranking',
}

/** {t: [...], a: [...]} -> [{t, a}, ...] for recharts */
export function toRows(s: Series, keys?: string[]): Record<string, number | string | null>[] {
  const cols = keys ?? Object.keys(s).filter(k => k !== 't')
  return s.t.map((t, i) => {
    const row: Record<string, number | string | null> = { t }
    for (const c of cols) row[c] = (s[c] as (number | null)[])[i]
    return row
  })
}
