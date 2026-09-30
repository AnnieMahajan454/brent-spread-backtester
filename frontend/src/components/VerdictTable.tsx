import type { Study, StrategyResult } from '../lib/api'
import { money, signClass } from '../lib/format'

const COLUMNS: { key: string; label: string; sub: string; get: (s: StrategyResult) => number }[] = [
  { key: 'naive', label: 'Naive', sub: 'instant fill, 1 tick', get: s => s.naive.net_pnl },
  { key: 'is', label: 'In-sample', sub: 'hindsight params', get: s => s.in_sample.net_pnl },
  { key: 'oos', label: 'Walk-forward', sub: 'honest baseline', get: s => s.out_of_sample.net_pnl },
  { key: 'strict', label: 'Strict data', sub: 'same-hour prints only', get: s => s.strict_data_out_of_sample.net_pnl },
  { key: 'cost2', label: '2× costs', sub: 'walk-forward', get: s => s.net_pnl_by_cost_multiplier['2'] },
]

/** passes only if walk-forward, strict-data and 2x-cost versions all make money */
const survives = (s: StrategyResult) =>
  s.out_of_sample.net_pnl > 0 && s.strict_data_out_of_sample.net_pnl > 0 && s.net_pnl_by_cost_multiplier['2'] > 0

export function VerdictTable({ study }: { study: Study }) {
  return (
    <div className="card table-wrap" style={{ padding: 8 }}>
      <table>
        <thead>
          <tr>
            <th>Strategy</th>
            {COLUMNS.map(c => <th key={c.key}>{c.label}<small>{c.sub}</small></th>)}
            <th>WF Sharpe<small>annualised</small></th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(study.strategies).map(([name, s]) => (
            <tr key={name}>
              <td>
                {name}
                {survives(s) ? <span className="chip pass">passes</span> : <span className="chip fail">fails</span>}
              </td>
              {COLUMNS.map(c => {
                const v = c.get(s)
                return <td key={c.key} className={`money ${signClass(v)}${c.key === 'oos' ? ' hl' : ''}`}>{money(v)}</td>
              })}
              <td className="money">{s.out_of_sample.sharpe.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
