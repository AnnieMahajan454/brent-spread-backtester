import { useEffect, useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, toRows } from '../lib/api'
import type { LabRequest, LabResponse } from '../lib/api'
import { useAsync, useColors } from '../lib/hooks'
import { dateTime, money, moneyK, shortDate, signClass } from '../lib/format'
import { ChartTooltip, Legend } from '../components/ChartTooltip'
import { Segmented } from '../components/Segmented'
import { ErrorState, Loading } from '../components/States'

const DEFAULTS: LabRequest = {
  strategy: 'mean_reversion', lookback: 48, entry_z: 1.5, exit_z: 0.5, threshold: 0,
  cost_mult: 1, exec_lag: 1, max_stale: 2, period: 'test', instruments: null,
}

interface SliderProps {
  id: keyof LabRequest
  label: string
  hint: string
  min: number
  max: number
  step: number
  value: number
  format?: (v: number) => string
  onChange: (v: number) => void
}

function Slider({ id, label, hint, min, max, step, value, format, onChange }: SliderProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}<output htmlFor={id}>{format ? format(value) : value}</output></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} />
      <span className="hint">{hint}</span>
    </div>
  )
}

export default function Lab() {
  const c = useColors()
  const [form, setForm] = useState<LabRequest>(DEFAULTS)
  const [selected, setSelected] = useState<string[] | null>(null)   // null = all instruments
  const [result, setResult] = useState<LabResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const spreads = useAsync(() => api.spreads(form.max_stale), [form.max_stale])
  const available = useMemo(() => (spreads.data ? Object.keys(spreads.data.legs) : []), [spreads.data])

  const set = <K extends keyof LabRequest>(k: K, v: LabRequest[K]) => setForm(f => ({ ...f, [k]: v }))

  // a different staleness rule changes which instruments exist -> reset the selection
  useEffect(() => { setSelected(null) }, [form.max_stale])

  async function run(req: LabRequest) {
    setRunning(true)
    setError(null)
    try {
      setResult(await api.runLab(req))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  // run once with the defaults so the page opens with a result
  useEffect(() => { run(DEFAULTS) }, [])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    run({ ...form, instruments: selected && selected.length ? selected : null })
  }

  function toggle(name: string) {
    const current = selected ?? available
    const next = current.includes(name) ? current.filter(n => n !== name) : [...current, name]
    setSelected(next.length === available.length ? null : next)
  }

  const eqRows = useMemo(() => (result ? toRows(result.equity) : []), [result])
  const instRows = result
    ? Object.entries(result.per_instrument).map(([name, pnl]) => ({ name, pnl }))
    : []
  const m = result?.metrics
  const isMR = form.strategy === 'mean_reversion'

  return (
    <main className="page">
      <div className="page-head">
        <span className="eyebrow">Strategy lab</span>
        <h1>Tune a strategy yourself</h1>
        <p className="lede">
          Change the parameters and costs and rerun the backtest on the server. Every run here is in-sample: you are
          choosing settings while looking at the result, which is exactly how backtests get overfit.
        </p>
      </div>

      <div className="lab">
        <form className="card lab-form" onSubmit={submit}>
          <div className="field">
            <span className="field-label">Strategy</span>
            <Segmented label="Strategy" value={form.strategy} onChange={v => set('strategy', v)}
              options={[{ value: 'mean_reversion', label: 'Mean reversion' }, { value: 'momentum', label: 'Momentum' }]} />
          </div>
          <Slider id="lookback" label="Lookback" hint="Rolling window, in hours with a fresh price" min={6} max={168} step={6}
            value={form.lookback} format={v => `${v}h`} onChange={v => set('lookback', v)} />
          {isMR ? (
            <>
              <Slider id="entry_z" label="Entry z-score" hint="Trade when the spread is this many std devs from its mean"
                min={0.5} max={3} step={0.25} value={form.entry_z} onChange={v => set('entry_z', v)} />
              <Slider id="exit_z" label="Exit z-score" hint="Close when the spread is back within this band"
                min={0} max={1.5} step={0.25} value={form.exit_z} onChange={v => set('exit_z', v)} />
            </>
          ) : (
            <Slider id="threshold" label="Signal threshold" hint="Minimum move, in volatility units, before trading"
              min={0} max={2} step={0.25} value={form.threshold} onChange={v => set('threshold', v)} />
          )}
          <Slider id="cost_mult" label="Cost multiplier" hint="Scales slippage (1–3 ticks per leg) and $2.50 fees"
            min={0} max={3} step={0.25} value={form.cost_mult} format={v => `${v}×`} onChange={v => set('cost_mult', v)} />
          <Slider id="exec_lag" label="Execution delay" hint="0 fills at the signal price, which is unrealistic"
            min={0} max={3} step={1} value={form.exec_lag} format={v => (v === 0 ? 'instant' : `${v} fresh price${v > 1 ? 's' : ''}`)}
            onChange={v => set('exec_lag', v)} />
          <Slider id="max_stale" label="Max leg staleness" hint="0 = every leg must trade in the same hour"
            min={0} max={4} step={1} value={form.max_stale} format={v => `${v}h`} onChange={v => set('max_stale', v)} />
          <div className="field">
            <label htmlFor="period">Period</label>
            <select id="period" value={form.period} onChange={e => set('period', e.target.value as LabRequest['period'])}>
              <option value="test">Test period (same as walk-forward)</option>
              <option value="full">Full two months</option>
            </select>
          </div>
          <div className="field">
            <span className="field-label">Instruments</span>
            <div className="checks">
              {available.map(n => (
                <label key={n}>
                  <input type="checkbox" id={`inst-${n}`} checked={(selected ?? available).includes(n)} onChange={() => toggle(n)} />
                  {n}
                </label>
              ))}
            </div>
          </div>
          {form.exit_z >= form.entry_z && isMR && <span className="caption neg">Exit z must be smaller than entry z.</span>}
          <button className="btn" type="submit" disabled={running || (isMR && form.exit_z >= form.entry_z)}>
            {running ? 'Running…' : 'Run backtest'}
          </button>
        </form>

        <div className="lab-results">
          {error && <ErrorState message={error} />}
          {!result && !error && <Loading what="backtest" />}
          {result && m && (
            <>
              <div className="grid-4">
                <div className="card tile"><span className="label">Net P&amp;L</span><span className={`value ${signClass(m.net_pnl)}`}>{money(m.net_pnl)}</span><span className="sub">after costs</span></div>
                <div className="card tile"><span className="label">Gross P&amp;L</span><span className="value">{money(m.gross_pnl)}</span><span className="sub">before costs</span></div>
                <div className="card tile"><span className="label">Costs</span><span className="value">${Math.round(m.costs).toLocaleString()}</span><span className="sub">{m.contracts_traded.toLocaleString()} contracts traded</span></div>
                <div className="card tile"><span className="label">Sharpe</span><span className="value">{m.sharpe.toFixed(1)}</span><span className="sub">{m.pct_days_positive}% up days, {m.n_days} days</span></div>
              </div>

              {result.request.period === 'test' && result.walk_forward_net_pnl != null && (
                <div className="callout">
                  <b>This result is in-sample.</b> You picked these settings while looking at the test period. The
                  walk-forward version of this strategy, which could only use past data, made{' '}
                  <span className={signClass(result.walk_forward_net_pnl)}>{money(result.walk_forward_net_pnl)}</span> over
                  the same weeks.
                  {result.request.exec_lag === 0 && ' Instant fills also let it trade at the same price that created the signal.'}
                </div>
              )}

              <div className="card">
                <h3>Cumulative P&amp;L</h3>
                <Legend items={[{ label: 'Net of costs', color: c['--s1'] }, { label: 'Gross (before costs)', color: c['--s-neutral'] }]} />
                <div className="chart">
                  <ResponsiveContainer>
                    <LineChart data={eqRows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={c['--grid']} vertical={false} />
                      <XAxis dataKey="t" tickFormatter={shortDate} minTickGap={48} tickLine={false} axisLine={{ stroke: c['--rule'] }} />
                      <YAxis tickFormatter={moneyK} tickLine={false} axisLine={false} width={56} />
                      <ReferenceLine y={0} stroke={c['--muted']} />
                      <Tooltip content={<ChartTooltip labelFormat={dateTime} valueFormat={money} />} />
                      <Line dataKey="gross" name="Gross" stroke={c['--s-neutral']} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      <Line dataKey="net" name="Net" stroke={c['--s1']} strokeWidth={2.25} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="card">
                <h3>Net P&amp;L per instrument</h3>
                <div className="chart sm">
                  <ResponsiveContainer>
                    <BarChart data={instRows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                      <CartesianGrid stroke={c['--grid']} horizontal={false} />
                      <XAxis type="number" tickFormatter={moneyK} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} fontSize={11} />
                      <ReferenceLine x={0} stroke={c['--muted']} />
                      <Tooltip cursor={{ fill: c['--grid'] }} content={<ChartTooltip valueFormat={money} />} />
                      <Bar dataKey="pnl" name="Net P&L" radius={4} maxBarSize={20} isAnimationActive={false}>
                        {instRows.map(r => <Cell key={r.name} fill={r.pnl >= 0 ? c['--s1'] : c['--s2']} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
