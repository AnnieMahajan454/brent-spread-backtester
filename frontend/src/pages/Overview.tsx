import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAsync } from '../lib/hooks'
import { longDate, money, signClass } from '../lib/format'
import { ErrorState, Loading } from '../components/States'
import { VerdictTable } from '../components/VerdictTable'

export default function Overview() {
  const { data: study, error } = useAsync(api.study)
  const mr = study?.strategies['Mean reversion']
  const ml = study?.strategies['ML ranking']

  return (
    <main className="page">
      <div className="page-head">
        <span className="eyebrow">Python · FastAPI · pandas · scikit-learn · React</span>
        <h1>Brent Futures Spread Backtester</h1>
        <p className="lede">
          Calendar spreads and butterflies built from two months of hourly Brent futures prices across 11 contract
          months, traded with mean-reversion, momentum and a machine-learning ranking model. Everything is tested
          walk-forward and net of trading costs. The first version of the backtest looked very profitable. None of the
          strategies survived once the test was made realistic.
        </p>
      </div>

      {error && <ErrorState message={error} />}
      {!study && !error && <Loading what="results" />}
      {study && mr && ml && (
        <>
          <section className="block">
            <span className="eyebrow">How one strategy's profit disappeared</span>
            <div className="grid-4">
              {[
                { label: 'Naive backtest', v: mr.naive.net_pnl, sub: 'filled at the signal price, 1-tick costs' },
                { label: 'Walk-forward', v: mr.out_of_sample.net_pnl, sub: 'params from past data only, delayed fills, tiered costs' },
                { label: 'Strict data', v: mr.strict_data_out_of_sample.net_pnl, sub: 'only hours where every leg traded' },
                { label: 'At 2× costs', v: mr.net_pnl_by_cost_multiplier['2'], sub: 'walk-forward with double slippage and fees' },
              ].map(t => (
                <div className="card tile" key={t.label}>
                  <span className="label">Mean reversion · {t.label}</span>
                  <span className={`value ${signClass(t.v)}`}>{money(t.v)}</span>
                  <span className="sub">{t.sub}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="block">
            <span className="eyebrow">Result</span>
            <h2>Every strategy fails once the backtest is realistic</h2>
            <p className="muted">
              Net P&amp;L in dollars over the test period {longDate(study.data.test_start)} to {longDate(study.data.test_end)},
              trading one spread unit (1,000 bbl per leg). Each column fixes one more mistake than the column to its
              left, and the last two stress-test the honest result.
            </p>
            <VerdictTable study={study} />
          </section>

          <section className="block">
            <span className="eyebrow">Findings</span>
            <div className="grid-2">
              <div className="card">
                <h3>The profit lived in illiquid spreads</h3>
                <p className="caption">
                  On the three most liquid instruments (Nov/Dec, Dec/Jan and the Nov/Dec/Jan fly), mean reversion
                  and the ML model both lost money. All of the paper profit came from back months that trade a few
                  hours a day, where prices are mostly stale prints and bid/ask bounce.
                </p>
              </div>
              <div className="card">
                <h3>Execution timing was most of the edge</h3>
                <p className="caption">
                  Filling at the exact price that created the signal is impossible in practice. Waiting for the next
                  fresh price cut mean-reversion profit by more than half before any other fix.
                </p>
              </div>
              <div className="card">
                <h3>Hindsight parameters flatter results</h3>
                <p className="caption">
                  {mr.n_profitable_param_sets} of {mr.n_param_sets} mean-reversion settings were profitable on the test
                  period, which looks robust. Choosing settings only from past data made {money(mr.out_of_sample.net_pnl)}{' '}
                  against {money(mr.in_sample.net_pnl)} for the best setting picked in hindsight.
                </p>
              </div>
              <div className="card">
                <h3>The ML model relearned the same noise</h3>
                <p className="caption">
                  The random forest's top features were volatility and z-score, so it mostly rediscovered mean
                  reversion. With strict data it made {money(ml.strict_data_out_of_sample.net_pnl)}.
                </p>
              </div>
            </div>
            <p>
              Explore the <Link to="/results">walk-forward results</Link>, or tune a strategy yourself in the{' '}
              <Link to="/lab">strategy lab</Link> and see how easy it is to overfit.
            </p>
          </section>
        </>
      )}
    </main>
  )
}
