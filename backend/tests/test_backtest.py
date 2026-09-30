"""Small sanity tests for the backtest engine.  Run with:  python -m pytest  (from backend/)"""
import numpy as np
import pandas as pd

from backtester.engine import compute_pnl, cost_per_unit
from backtester.spreads import build_instruments
from backtester.strategies import mean_reversion, momentum

IDX = pd.date_range("2026-01-01", periods=6, freq="h", tz="UTC")
LEGS = {"A-B": {"A": 1, "B": -1}}


def test_calendar_and_fly_prices():
    panel = pd.DataFrame({"A": [80.0, 81.0], "B": [79.0, 79.5], "C": [78.5, 78.0]},
                         index=IDX[:2])
    prices, valid, legs = build_instruments(panel, min_valid_hours=1, verbose=False)
    assert prices["A-B"].tolist() == [1.0, 1.5]
    assert prices["A/B/C fly"].tolist() == [80 - 2 * 79 + 78.5, 81 - 2 * 79.5 + 78]
    assert legs["A/B/C fly"] == {"A": 1, "B": -2, "C": 1}


def test_stale_leg_makes_spread_invalid():
    panel = pd.DataFrame({"A": [80.0, 81, 82, 83], "B": [79.0, np.nan, np.nan, np.nan]},
                         index=IDX[:4])
    _, valid, _ = build_instruments(panel, max_stale=2, min_valid_hours=1, verbose=False)
    # B last traded at hour 0: ok for 2 more hours, then invalid
    assert valid["A-B"].tolist() == [True, True, True, False]


def test_no_lookahead_pnl():
    # go long at hour 1, price jumps at hour 1 -> must NOT earn that jump
    prices = pd.DataFrame({"A-B": [1.0, 2.0, 2.0, 3.0, 3.0, 3.0]}, index=IDX)
    pos = pd.DataFrame({"A-B": [0, 1, 1, 1, 1, 1]}, index=IDX)
    pnl = compute_pnl(pos, prices, LEGS, exec_lag=0, flat_ticks=0)
    # only the hour-3 move (+1.0 $/bbl = $1000) counts, minus fees
    fees = cost_per_unit(LEGS, flat_ticks=0)["A-B"] * 1000
    assert np.isclose(pnl["gross"].sum(), 1000)
    assert np.isclose(pnl["costs"].sum(), fees)


def test_exec_lag_delays_fill():
    prices = pd.DataFrame({"A-B": [1.0, 1.0, 2.0, 2.0, 2.0, 2.0]}, index=IDX)
    valid = pd.DataFrame({"A-B": [True] * 6}, index=IDX)
    pos = pd.DataFrame({"A-B": [0, 1, 1, 1, 1, 1]}, index=IDX)
    instant = compute_pnl(pos, prices, LEGS, exec_lag=0, flat_ticks=0)
    delayed = compute_pnl(pos, prices, LEGS, valid, exec_lag=1, flat_ticks=0)
    assert np.isclose(instant["gross"].sum(), 1000)   # caught the jump
    assert np.isclose(delayed["gross"].sum(), 0)      # filled after the jump


def test_exec_lag_skips_stale_hours():
    # hour 2 is not valid (stale price) -> fill must wait for hour 3
    prices = pd.DataFrame({"A-B": [1.0, 1.0, 1.0, 5.0, 5.0, 5.0]}, index=IDX)
    valid = pd.DataFrame({"A-B": [True, True, False, True, True, True]}, index=IDX)
    pos = pd.DataFrame({"A-B": [0, 1, 1, 1, 1, 1]}, index=IDX)
    pnl = compute_pnl(pos, prices, LEGS, valid, exec_lag=1, flat_ticks=0)
    assert np.isclose(pnl["gross"].sum(), 0)


def test_butterfly_costs_more_than_calendar():
    c = cost_per_unit({"cal": {"X26": 1, "Z26": -1},
                       "fly": {"X26": 1, "Z26": -2, "F27": 1}})
    assert c["fly"] > c["cal"]


def test_strategies_output_shape():
    rng = np.random.default_rng(0)
    idx = pd.date_range("2026-01-01", periods=300, freq="h", tz="UTC")
    prices = pd.DataFrame({"A-B": 2 + rng.normal(0, 0.1, 300).cumsum() * 0.1}, index=idx)
    valid = pd.DataFrame({"A-B": True}, index=idx)
    for pos in (mean_reversion(prices, valid), momentum(prices, valid)):
        assert pos.shape == prices.shape
        assert set(np.unique(pos.values)) <= {-1, 0, 1}
