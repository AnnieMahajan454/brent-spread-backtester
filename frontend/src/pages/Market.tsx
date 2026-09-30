import { useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, toRows } from '../lib/api'
import { useAsync, useColors } from '../lib/hooks'
import { contractName, dateTime, shortDate } from '../lib/format'
import { ChartTooltip, Legend } from '../components/ChartTooltip'
import { Segmented } from '../components/Segmented'
import { ErrorState, Loading } from '../components/States'

export default function MarketPage() {
  const market = useAsync(api.market)
  const spreads = useAsync(() => api.spreads(2))
  const c = useColors()
  const [kind, setKind] = useState<'cal' | 'fly'>('cal')
  const m = market.data

  // 4 weekly snapshots, oldest -> newest, drawn on a light -> dark ramp
  const snapDates = useMemo(() => {
    const all = m?.curve_snapshots.map(s => s.date) ?? []
    if (all.length <= 4) return all
    const step = (all.length - 1) / 3
    return [0, 1, 2, 3].map(i => all[Math.round(i * step)])
  }, [m])
  const ramp = [c['--seq-0'], c['--seq-1'], c['--seq-2'], c['--seq-3']]

  const curveRows = useMemo(() => {
    if (!m) return []
    return m.liquid_contracts.map(k => {
      const row: Record<string, number | string> = { contract: contractName(k) }
      m.curve_snapshots.forEach(s => { if (s.prices[k] !== undefined) row[s.date] = s.prices[k] })
      return row
    })
  }, [m])

  const liquidityRows = useMemo(
    () => (m ? m.contracts.map(k => ({ key: k, contract: contractName(k), hours: m.bars_per_contract[k] })) : []),
    [m],
  )

  const spreadCols = useMemo(
    () => (spreads.data ? Object.keys(spreads.data.legs).filter(n => (kind === 'fly') === n.includes('fly')) : []),
    [spreads.data, kind],
  )
  const spreadRows = useMemo(
    () => (spreads.data ? toRows(spreads.data.prices, spreadCols) : []),
    [spreads.data, spreadCols],
  )
  const palette = [c['--s1'], c['--s2'], c['--s3'], c['--s-neutral']]
  const err = market.error || spreads.error

  return (
    <main className="page">
      <div className="page-head">
        <span className="eyebrow">Market data</span>
        <h1>Brent curve and spreads</h1>
        <p className="lede">
          Hourly closes of NYMEX Brent Last Day Financial futures (BZ), which cash-settle against ICE Brent.
          {m && <> {m.n_hours.toLocaleString()} hourly bars from {shortDate(m.start)} to {shortDate(m.end)}.</>}
        </p>
      </div>
      {err && <ErrorState message={err} />}
      {!m && !err && <Loading what="market data" />}

      {m && (
        <section className="block">
          <div className="grid-2">
            <div className="card">
              <h3>Futures curve, weekly snapshots</h3>
              <p className="caption">$/bbl, liquid contracts only. The curve is in steep backwardation: near months cost more than later ones.</p>
              <Legend items={snapDates.map((d, i) => ({ label: shortDate(d), color: ramp[i] }))} />
              <div className="chart sm">
                <ResponsiveContainer>
                  <LineChart data={curveRows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={c['--grid']} vertical={false} />
                    <XAxis dataKey="contract" tickLine={false} axisLine={{ stroke: c['--rule'] }} />
                    <YAxis domain={['auto', 'auto']} tickFormatter={v => `$${v}`} tickLine={false} axisLine={false} width={48} />
                    <Tooltip content={<ChartTooltip valueFormat={v => `$${v.toFixed(2)}`} />} />
                    {snapDates.map((d, i) => (
                      <Line key={d} dataKey={d} name={shortDate(d)} stroke={ramp[i]} strokeWidth={i === 3 ? 2.5 : 2}
                        dot={{ r: 3, fill: ramp[i], stroke: c['--surface'], strokeWidth: 1.5 }} isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <h3>Hours with at least one trade</h3>
              <p className="caption">
                Out of {m.n_hours.toLocaleString()} hourly bars. Later contracts barely trade, so spreads that use
                them can't be priced reliably and are dropped (grey).
              </p>
              <div className="chart sm">
                <ResponsiveContainer>
                  <BarChart data={liquidityRows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={c['--grid']} vertical={false} />
                    <XAxis dataKey="contract" tickLine={false} axisLine={{ stroke: c['--rule'] }} interval={0} fontSize={10} />
                    <YAxis tickLine={false} axisLine={false} width={44} />
                    <Tooltip cursor={{ fill: c['--grid'] }} content={<ChartTooltip valueFormat={v => `${v} hours`} />} />
                    <Bar dataKey="hours" name="Hours traded" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
                      {liquidityRows.map(r => (
                        <Cell key={r.key} fill={m.liquid_contracts.includes(r.key) ? c['--accent'] : c['--s-neutral']} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </section>
      )}

      {spreads.data && (
        <section className="block">
          <span className="eyebrow">Instruments</span>
          <h2>The spreads that could be traded</h2>
          <p className="muted">
            A spread is only priced in hours where every leg traded within the last 2 hours.{' '}
            {Object.keys(spreads.data.legs).length} of 19 possible instruments (10 calendar spreads, 9 butterflies)
            had at least 150 such hours.
          </p>
          <Segmented label="Spread type" value={kind} onChange={setKind}
            options={[{ value: 'cal', label: 'Calendar spreads' }, { value: 'fly', label: 'Butterflies' }]} />
          <div className="card">
            <Legend items={spreadCols.map((n, i) => ({ label: `${n} · ${spreads.data!.valid_hours[n]} tradable hours`, color: palette[i] }))} />
            <div className="chart lg">
              <ResponsiveContainer>
                <LineChart data={spreadRows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={c['--grid']} vertical={false} />
                  <XAxis dataKey="t" tickFormatter={shortDate} minTickGap={48} tickLine={false} axisLine={{ stroke: c['--rule'] }} />
                  <YAxis tickFormatter={v => `$${Number(v).toFixed(2)}`} tickLine={false} axisLine={false} width={56} />
                  <Tooltip content={<ChartTooltip labelFormat={dateTime} valueFormat={v => `$${v.toFixed(2)}`} />} />
                  {spreadCols.map((n, i) => (
                    <Line key={n} dataKey={n} name={n} stroke={palette[i]} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="caption">Calendar spread = front − back month. Butterfly = front − 2 × middle + back. Values in $/bbl.</p>
          </div>
        </section>
      )}
    </main>
  )
}
