"""
P&L calculation (net of costs) and performance metrics.

Convention: position[t] is decided using data up to and including the close of
hour t, and is held from t to t+1. So the P&L at hour t is
    position[t-1] * (price[t] - price[t-1])
The shift(1) is what stops us from using the future (look-ahead bias).

On top of that, EXEC_LAG_HOURS = 1 means a signal at the close of hour t is
only filled at the next hour where the spread has a fresh price. Without this delay the backtest trades
at the exact price that created the signal. With illiquid back months, that
price is often just a stale print or a trade at the bid/ask, so the "edge"
is fake. (Tried it: mean reversion P&L drops ~60-100% with a 1h delay.)
"""
import numpy as np
import pandas as pd

BARRELS_PER_CONTRACT = 1000     # BZ contract size (CME contract specs)
TICK = 0.01                     # $/bbl minimum price move = $10 per contract

EXEC_LAG_HOURS = 1

# Cost assumptions per contract, per side (entering OR exiting counts once).
#   slippage: crossing the bid/ask. Front months are very liquid (~1 tick),
#             back months trade rarely and their bid/ask is wider, so more
#             ticks. These are my assumptions, not measured quotes.
#   fees:     ~ $2.50 exchange + broker fees per contract per side
SLIPPAGE_TICKS = {"X26": 1, "Z26": 1, "F27": 2, "G27": 2, "H27": 2}
DEFAULT_SLIPPAGE_TICKS = 3
FEES_PER_CONTRACT = 2.50 / BARRELS_PER_CONTRACT   # $/bbl


def leg_cost(contract, flat_ticks=None):
    """$/bbl cost for trading one contract of this month, one side"""
    ticks = flat_ticks if flat_ticks is not None else \
        SLIPPAGE_TICKS.get(contract, DEFAULT_SLIPPAGE_TICKS)
    return ticks * TICK + FEES_PER_CONTRACT


def cost_per_unit(legs, flat_ticks=None):
    """$/bbl cost of trading 1 unit of each spread (sum over its legs)"""
    return {name: sum(abs(w) * leg_cost(c, flat_ticks) for c, w in lw.items())
            for name, lw in legs.items()}


def n_contracts(legs):
    """contracts traded per 1 unit of the spread (calendar=2, butterfly=4)"""
    return {name: sum(abs(w) for w in lw.values()) for name, lw in legs.items()}


def delay_fills(positions, valid, lag):
    """
    Move each instrument's position changes `lag` *fresh prices* later.
    Shifting by grid hours is not enough: if the legs didn't trade in the next
    hour, the forward-filled price there is the same stale print that made the
    signal, so the "delayed" fill is really an instant one.
    """
    out = {}
    for col in positions.columns:
        v = valid[col]
        out[col] = positions[col][v].shift(lag)
    return pd.DataFrame(out).reindex(positions.index).ffill().fillna(0)


def compute_pnl(positions, prices, legs, valid=None,
                exec_lag=EXEC_LAG_HOURS, flat_ticks=None, cost_mult=1.0):
    """
    positions : DataFrame (hours x instruments) with number of spread units wanted
    prices    : DataFrame of spread prices ($/bbl)
    valid     : bool DataFrame of hours with fresh prices (needed if exec_lag > 0)
    exec_lag  : fresh prices between signal and fill (0 = naive, fill at signal price)
    flat_ticks: if set, use this many ticks slippage for every leg (naive version)
    cost_mult : scale all costs (for "what if costs are 2x" checks)
    Returns DataFrame with gross, cost and net P&L in dollars per hour.
    """
    positions = positions.reindex_like(prices).fillna(0)
    if exec_lag > 0:
        positions = delay_fills(positions, valid.reindex_like(prices).fillna(False), exec_lag)
    price_change = prices.diff().fillna(0)
    gross = (positions.shift(1).fillna(0) * price_change) * BARRELS_PER_CONTRACT

    traded_units = positions.diff().abs()
    traded_units.iloc[0] = positions.iloc[0].abs()
    contracts_traded = traded_units * pd.Series(n_contracts(legs))
    costs = traded_units * pd.Series(cost_per_unit(legs, flat_ticks)) * BARRELS_PER_CONTRACT * cost_mult

    return pd.DataFrame({
        "gross": gross.sum(axis=1),
        "costs": costs.sum(axis=1),
        "net": (gross - costs).sum(axis=1),
        "contracts_traded": contracts_traded.sum(axis=1),
    })


def metrics(pnl):
    """Summary stats from an hourly P&L frame produced by compute_pnl."""
    if len(pnl) == 0:
        return {}
    daily = pnl["net"].groupby(pnl.index.date).sum()
    equity = pnl["net"].cumsum()
    drawdown = equity - equity.cummax()
    sharpe = daily.mean() / daily.std() * np.sqrt(252) if daily.std() > 0 else 0.0
    return {
        "net_pnl": round(pnl["net"].sum(), 2),
        "gross_pnl": round(pnl["gross"].sum(), 2),
        "costs": round(pnl["costs"].sum(), 2),
        "contracts_traded": int(pnl["contracts_traded"].sum()),
        "sharpe": round(sharpe, 2),
        "max_drawdown": round(drawdown.min(), 2),
        "pct_days_positive": round((daily > 0).mean() * 100, 1),
        "n_days": int(len(daily)),
    }
