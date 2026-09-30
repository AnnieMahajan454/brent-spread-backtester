export default function Methodology() {
  return (
    <main className="page">
      <div className="page-head">
        <span className="eyebrow">Methodology</span>
        <h1>How the backtest works</h1>
      </div>
      <div className="prose">
        <h2>Data</h2>
        <ul>
          <li>
            Hourly OHLC bars for 11 consecutive NYMEX Brent Crude Oil Last Day Financial futures (symbol BZ, Nov-26 to
            Sep-27), downloaded from Yahoo Finance with <code>yfinance</code>. BZ cash-settles against ICE Brent futures,
            so it follows the same prices. Contract size 1,000 barrels, tick $0.01/bbl = $10 (
            <a href="https://www.cmegroup.com/markets/energy/crude-oil/brent-crude-oil.contractSpecs.html" target="_blank" rel="noreferrer">CME contract specs</a>).
          </li>
          <li>Yahoo keeps about 60 days of hourly futures history, so the dataset is a saved snapshot committed to the repo for reproducibility.</li>
          <li>Back months trade rarely. A spread only gets a price when every leg traded within the last 2 hours. With 0 hours of tolerance only 5 of 19 instruments have enough data; with 2 hours, 7 do.</li>
        </ul>

        <h2>Instruments</h2>
        <ul>
          <li>Calendar spread: front month − next month, e.g. Dec-26 − Jan-27.</li>
          <li>Butterfly: front − 2 × middle + back. It trades 4 contracts per unit, so it pays roughly twice the costs of a calendar spread.</li>
        </ul>

        <h2>Strategies</h2>
        <ol>
          <li><b>Mean reversion.</b> Rolling z-score of the spread. Sell when z &gt; entry, buy when z &lt; −entry, close when |z| &lt; exit.</li>
          <li><b>Momentum.</b> Direction of the spread's move over a lookback, scaled by its volatility. Trade only above a threshold.</li>
          <li>
            <b>ML ranking.</b> A random forest (200 trees, depth 4) predicts each spread's volatility-scaled move over the
            next 6 hours from 8 features: returns over 1/3/6/24 hours, 24h and 72h z-scores, recent volatility and a
            butterfly flag. Every 6 hours it goes long the spread with the highest prediction and short the lowest.
          </li>
        </ol>

        <h2>Execution and costs</h2>
        <ul>
          <li>A signal at an hour's close is filled at the spread's next fresh price. Shifting by a clock hour is not enough: if the legs didn't trade, the next hour's price is the same stale print.</li>
          <li>Costs per contract per side: $2.50 in fees plus slippage of 1 tick for Nov-26 and Dec-26, 2 ticks for Jan–Mar 27, 3 ticks for later months. These are assumptions, not measured quotes.</li>
          <li>P&amp;L is in dollars for one spread unit: $/bbl move × 1,000 barrels.</li>
        </ul>

        <h2>Walk-forward validation</h2>
        <ul>
          <li>The first ~400 trading hours (about 3.5 weeks) are training only. After that, each week is a test fold, and the training window grows to include every earlier week.</li>
          <li>Rule strategies: all 18 (mean reversion) or 12 (momentum) parameter sets are scored on the training window, and the best one trades the next week.</li>
          <li>ML: the model is retrained each fold. The last 6 hours of training rows are dropped (purged) because their 6-hour targets overlap the test week.</li>
          <li>For comparison, "in-sample" uses the parameter set that was best on the test period itself, and "naive" is the same thing filled instantly with 1-tick costs.</li>
        </ul>

        <h2>Robustness checks</h2>
        <ul>
          <li>Strict data: the whole walk-forward rerun with 0 hours of staleness allowed.</li>
          <li>Cost sensitivity: walk-forward P&amp;L at 0.5× to 3× the cost assumptions.</li>
          <li>P&amp;L per instrument, to see whether profit comes from liquid or illiquid spreads.</li>
        </ul>

        <h2>Limitations</h2>
        <ul>
          <li>Seven weeks of test data is short. Results would differ in another market regime.</li>
          <li>Hourly last-trade prices are not bid/ask quotes, so true execution costs for back months are unknown and probably higher than assumed.</li>
          <li>The front month (Nov-26) expired on the last day of the sample, and spreads involving it move unusually near expiry.</li>
        </ul>

        <h2>References</h2>
        <ul>
          <li>Bailey, Borwein, López de Prado &amp; Zhu (2014), <a href="https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253" target="_blank" rel="noreferrer">The Probability of Backtest Overfitting</a>.</li>
          <li>López de Prado (2018), <i>Advances in Financial Machine Learning</i>, ch. 7 (purged cross-validation) and ch. 11 (dangers of backtesting).</li>
          <li><a href="https://www.cmegroup.com/markets/energy/crude-oil/brent-crude-oil.html" target="_blank" rel="noreferrer">CME Group: Brent Crude Oil Last Day Financial futures</a>.</li>
          <li><a href="https://www.ice.com/products/219/Brent-Crude-Futures" target="_blank" rel="noreferrer">ICE Brent Crude futures</a>, the benchmark BZ settles against.</li>
        </ul>

        <h2>Run it locally</h2>
        <pre>{`# backend
cd backend
pip install -r requirements-dev.txt
python -m backtester.data      # optional: download fresh data (~60 days)
python -m backtester.study     # walk-forward study -> results/ (~30s)
uvicorn app.main:app --reload  # API on http://localhost:8000/docs

# frontend
cd frontend
npm install
npm run dev                    # http://localhost:5173`}</pre>
      </div>
    </main>
  )
}
