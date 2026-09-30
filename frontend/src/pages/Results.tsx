import { useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, STRATEGY_IDS, toRows } from '../lib/api'
import type { Metrics, Study } from '../lib/api'
import { useAsync, useColors } from '../lib/hooks'
import { dateTime, money, moneyK, shortDate, signClass } from '../lib/format'
import { ChartTooltip, Legend } from '../components/ChartTooltip'
import { Segmented } from '../components/Segmented'
import { ErrorState, Loading } from '../components/States'

const VARIANTS: { key: 'naive' | 'in_sample' | 'out_of_sample' | 'strict_data_out_of_sample'; label: string; color: string }[] = [
  { key: 'naive', label: 'Naive: instant fills, 1-tick costs', color: '--s-neutral' },
  { key: 'in_sample', label: 'In-sample: hindsight-best parameters', color: '--s2' },
  { key: 'out_of_sample', label: 'Walk-forward out-of-sample', color: '--s1' },
  { key: 'strict_data_out_of_sample', label: 'Walk-forward, strict data', color: '--s3' },
]

function MetricsTable({ rows }: { rows: { label: string; m: Metrics }[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Version</th><th>Net P&amp;L</th><th>Gross</th><th>Costs</th><th>Contracts</th>
            <th>Sharpe</th><th>Max drawdown</th><th>Up days</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, m }) => (
            <tr key={label}>
              <td>{label}</td>
              <td className={`money ${signClass(m.net_pnl)}`}>{money(m.net_pnl)}</td>
              <td className="money">{money(m.gross_pnl)}</td>
              <td className="money">${Math.round(m.costs).toLocaleString()}</td>
              <td className="money">{m.contracts_traded.toLocaleString()}</td>
              <td className="money">{m.sharpe.toFixed(1)}</td>
              <td className="money">{money(m.max_drawdown)}</td>
              <td className="money">{m.pct_days_positive}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StrategyDetail({ study, name }: { study: Study; name: string }) {
  const c = useColors()
  const s = study.strategies[name]
  const equity = useAsync(() => api.equity(STRATEGY_IDS[name]), [name])
  const eqRows = useMemo(() => (equity.data ? toRows(equity.data) : []), [equity.data])

  const inst = Object.entries(s.per_instrument)
    .sort((a, b) => b[1].valid_hours - a[1].valid_hours)
    .map(([k, v]) => ({ name: k, pnl: v.net_pnl, hours: v.valid_hours }))

  return (
    <>
      <div className="card">
        <h3>Cumulative net P&amp;L over the test period</h3>
        <Legend items={VARIANTS.map(v => ({ label: v.label, color: c[v.color as keyof typeof c] }))} />
        <div className="chart lg">
          {equity.error && <ErrorState message={equity.error} />}
          {!equity.data && !equity.error && <Loading what="equity curves" />}
          {equity.data && (
            <ResponsiveContainer>
              <LineChart data={eqRows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c['--grid']} vertical={false} />
                <XAxis dataKey="t" tickFormatter={shortDate} minTickGap={48} tickLine={false} axisLine={{ stroke: c['--rule'] }} />
                <YAxis tickFormatter={moneyK} tickLine={false} axisLine={false} width={56} />
                <ReferenceLine y={0} stroke={c['--muted']} />
                <Tooltip content={<ChartTooltip labelFormat={dateTime} valueFormat={money} />} />
                {VARIANTS.map(v => (
                  <Line key={v.key} dataKey={v.key} name={v.label.split(':')[0]} stroke={c[v.color as keyof typeof c]}
                    strokeWidth={v.key === 'out_of_sample' ? 2.5 : 1.75} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 8 }}>
        <MetricsTable rows={VARIANTS.map(v => ({ label: v.label.split(':')[0], m: s[v.key] }))} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>P&amp;L per instrument (walk-forward)</h3>
          <p className="caption">Sorted from most to least liquid. The liquid spreads at the top lose money. Profit comes from back months that trade a few hours a day.</p>
          <div className="chart">
            <ResponsiveContainer>
              <BarChart data={inst} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={c['--grid']} horizontal={false} />
                <XAxis type="number" tickFormatter={moneyK} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} fontSize={11} />
                <ReferenceLine x={0} stroke={c['--muted']} />
                <Tooltip cursor={{ fill: c['--grid'] }} content={<ChartTooltip valueFormat={money} />} />
                <Bar dataKey="pnl" name="Net P&L" radius={4} maxBarSize={22} isAnimationActive={false}>
                  {inst.map(r => <Cell key={r.name} fill={r.pnl >= 0 ? c['--s1'] : c['--s2']} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {s.all_param_pnls ? (
          <div className="card">
            <h3>Every parameter set on the test period</h3>
            <p className="caption">
              {s.n_profitable_param_sets} of {s.n_param_sets} settings made money in hindsight. Walk-forward, which could only pick
              from past data, made {money(s.out_of_sample.net_pnl)}.
            </p>
            <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table>
                <thead><tr><th>Parameters</th><th>Net P&amp;L</th></tr></thead>
                <tbody>
                  {Object.entries(s.all_param_pnls).sort((a, b) => b[1] - a[1]).map(([p, v]) => (
                    <tr key={p}>
                      <td className="num">{Object.entries(JSON.parse(p) as Record<string, number>).map(([k, x]) => `${k}=${x}`).join('  ')}</td>
                      <td className={`money ${signClass(v)}`}>{money(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : s.feature_importance && (
          <div className="card">
            <h3>Random forest feature importance</h3>
            <p className="caption">
              Model trained on the test period (in-sample R² {s.in_sample_r2?.toFixed(2)}). Volatility and z-score
              dominate, so the model mostly relearned mean reversion.
            </p>
            <div className="chart">
              <ResponsiveContainer>
                <BarChart data={Object.entries(s.feature_importance).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ k, v }))}
                  layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={c['--grid']} horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={v => Number(v).toFixed(2)} />
                  <YAxis type="category" dataKey="k" width={80} tickLine={false} axisLine={false} fontSize={11} />
                  <Tooltip cursor={{ fill: c['--grid'] }} content={<ChartTooltip valueFormat={v => v.toFixed(3)} />} />
                  <Bar dataKey="v" name="Importance" fill={c['--accent']} radius={4} maxBarSize={20} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function CostChart({ study }: { study: Study }) {
  const c = useColors()
  const names = Object.keys(study.strategies)
  const colors = [c['--s1'], c['--s2'], c['--s3']]
  const mults = Object.keys(study.strategies[names[0]].net_pnl_by_cost_multiplier).sort((a, b) => Number(a) - Number(b))
  const rows = mults.map(m => {
    const r: Record<string, number | string> = { m: `${m}×` }
    names.forEach(n => { r[n] = study.strategies[n].net_pnl_by_cost_multiplier[m] })
    return r
  })
  return (
    <div className="card">
      <h3>What if trading costs are higher?</h3>
      <p className="caption">Walk-forward net P&amp;L with all slippage and fees scaled. 1× is the base assumption. Both "profitable" strategies turn negative before costs double.</p>
      <Legend items={names.map((n, i) => ({ label: n, color: colors[i] }))} />
      <div className="chart sm">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c['--grid']} vertical={false} />
            <XAxis dataKey="m" tickLine={false} axisLine={{ stroke: c['--rule'] }} />
            <YAxis tickFormatter={moneyK} tickLine={false} axisLine={false} width={56} />
            <ReferenceLine y={0} stroke={c['--muted']} />
            <Tooltip content={<ChartTooltip labelFormat={l => `Costs ${l}`} valueFormat={money} />} />
            {names.map((n, i) => (
              <Line key={n} dataKey={n} name={n} stroke={colors[i]} strokeWidth={2}
                dot={{ r: 4, fill: colors[i], stroke: c['--surface'], strokeWidth: 2 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function FoldsTable({ study }: { study: Study }) {
  const mr = study.strategies['Mean reversion'].walk_forward_choices ?? []
  const mo = study.strategies['Momentum'].walk_forward_choices ?? []
  const ml = study.strategies['ML ranking'].folds ?? []
  return (
    <div className="card">
      <h3>What each fold picked</h3>
      <p className="caption">
        Expanding training window, then one week of testing. Rule strategies use the parameters with the best training
        P&amp;L. The random forest is retrained each fold, and the last 6 hours of training data are dropped because their
        targets overlap the test week.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Test week from</th>
              <th>Mean reversion<small>lookback / entry z / exit z</small></th>
              <th>Momentum<small>lookback / threshold</small></th>
              <th>ML training rows</th>
              <th>ML correlation<small>prediction vs actual</small></th>
            </tr>
          </thead>
          <tbody>
            {mr.map((f, i) => (
              <tr key={f.test_start}>
                <td className="num">{f.test_start}</td>
                <td className="num">{f.params.lookback}h / {f.params.entry_z} / {f.params.exit_z}</td>
                <td className="num">{mo[i]?.params.lookback}h / {mo[i]?.params.threshold}</td>
                <td className="num">{ml[i]?.train_rows.toLocaleString()}</td>
                <td className="num">{ml[i]?.pred_vs_actual_corr == null ? 'n/a' : ml[i].pred_vs_actual_corr!.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function Results() {
  const { data: study, error } = useAsync(api.study)
  const [name, setName] = useState('Mean reversion')

  return (
    <main className="page">
      <div className="page-head">
        <span className="eyebrow">Walk-forward results</span>
        <h1>Same test period, four ways of backtesting it</h1>
        <p className="lede">
          Each strategy is run four times over the same weeks. The gap between the grey line and the blue line is how
          much a careless backtest overstates the result.
        </p>
      </div>
      {error && <ErrorState message={error} />}
      {!study && !error && <Loading what="results" />}
      {study && (
        <>
          <section className="block">
            <Segmented label="Strategy" value={name} onChange={setName}
              options={Object.keys(study.strategies).map(n => ({ value: n, label: n }))} />
            <StrategyDetail study={study} name={name} />
          </section>
          <section className="block">
            <span className="eyebrow">Robustness</span>
            <CostChart study={study} />
            <FoldsTable study={study} />
          </section>
        </>
      )}
    </main>
  )
}
