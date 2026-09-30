"""
Trading strategies. Each one returns a positions DataFrame
(hours x instruments) with values in {-1, 0, +1} spread units.

Rules used by all strategies:
  - signals are only computed from hours where the spread is valid
    (all legs traded recently), and positions only change in those hours
  - everything uses data up to hour t only (rolling windows look backwards)
"""
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor


def _on_valid_hours(prices, valid, col):
    """spread series using only the hours where it was actually tradable"""
    return prices[col][valid[col]]


def _to_grid(signal_dict, prices):
    """put per-instrument signals back on the full hourly grid, hold between updates"""
    pos = pd.DataFrame(signal_dict).reindex(prices.index)
    return pos.ffill().fillna(0)


# ---------------------------------------------------------------------------
# 1) Mean reversion: spread far from its recent average -> bet it comes back
# ---------------------------------------------------------------------------
def mean_reversion(prices, valid, lookback=48, entry_z=1.5, exit_z=0.5):
    out = {}
    for col in prices.columns:
        s = _on_valid_hours(prices, valid, col)
        z = (s - s.rolling(lookback).mean()) / s.rolling(lookback).std()
        pos = np.zeros(len(s))
        current = 0
        for i, zi in enumerate(z.values):
            if np.isnan(zi):
                current = 0
            elif current == 0:
                if zi > entry_z:
                    current = -1        # spread rich -> sell it
                elif zi < -entry_z:
                    current = 1         # spread cheap -> buy it
            elif abs(zi) < exit_z:
                current = 0             # back near the mean -> take profit
            pos[i] = current
        out[col] = pd.Series(pos, index=s.index)
    return _to_grid(out, prices)


# ---------------------------------------------------------------------------
# 2) Momentum: spread has been widening -> bet it keeps widening
# ---------------------------------------------------------------------------
def momentum(prices, valid, lookback=24, threshold=0.0):
    out = {}
    for col in prices.columns:
        s = _on_valid_hours(prices, valid, col)
        move = s - s.shift(lookback)
        vol = s.diff().rolling(lookback).std() * np.sqrt(lookback)
        strength = move / vol               # move measured in "typical moves"
        pos = np.sign(strength).where(strength.abs() > threshold, 0)
        out[col] = pos.fillna(0)
    return _to_grid(out, prices)


# ---------------------------------------------------------------------------
# 3) ML ranking: predict each spread's next move, long the best, short the worst
# ---------------------------------------------------------------------------
HOLD_HOURS = 6      # rebalance every 6 hours (hourly rebalancing = way too many costs)


def make_features(prices, valid):
    """
    One row per (hour, instrument) where the instrument is valid.
    All features are scaled by the spread's recent volatility so a calendar
    spread and a butterfly can be compared in the same model.
    """
    rows = []
    for col in prices.columns:
        s = _on_valid_hours(prices, valid, col)
        vol = s.diff().rolling(24).std()
        f = pd.DataFrame(index=s.index)
        for h in (1, 3, 6, 24):
            f[f"ret_{h}h"] = (s - s.shift(h)) / vol
        for w in (24, 72):
            f[f"z_{w}h"] = (s - s.rolling(w).mean()) / s.rolling(w).std()
        f["vol_24h"] = vol
        f["is_fly"] = int("fly" in col)
        # target: vol-scaled move over the next HOLD_HOURS on the hourly grid
        grid = prices[col]
        future = grid.shift(-HOLD_HOURS).reindex(s.index)
        f["target"] = (future - s) / vol
        f["instrument"] = col
        rows.append(f)
    feats = pd.concat(rows).replace([np.inf, -np.inf], np.nan)
    feats = feats.dropna(subset=[c for c in feats.columns if c != "target"])
    return feats.sort_index()


FEATURES = ["ret_1h", "ret_3h", "ret_6h", "ret_24h", "z_24h", "z_72h", "vol_24h", "is_fly"]


def new_model():
    return RandomForestRegressor(n_estimators=200, max_depth=4,
                                 min_samples_leaf=20, random_state=42, n_jobs=-1)


def rank_to_positions(preds, prices, top_k=1):
    """
    preds: DataFrame with columns [instrument, pred], index = timestamp.
    Every HOLD_HOURS: long top_k predicted, short bottom_k, hold until next rebalance.
    Instruments that aren't valid at a rebalance keep their old position
    (we can't trade them at a real price, so we don't pretend to).
    """
    rebal_times = prices.index[::HOLD_HOURS]
    pos = pd.DataFrame(np.nan, index=prices.index, columns=prices.columns)
    row = pd.Series(0.0, index=prices.columns)
    for t in rebal_times:
        if t not in preds.index:
            continue
        p = preds.loc[[t]].set_index("instrument")["pred"].sort_values()
        row = row.copy()
        row[p.index] = 0                    # only tradable instruments get reset
        if len(p) >= 2 * top_k:
            row[p.index[-top_k:]] = 1       # expected to rise the most
            row[p.index[:top_k]] = -1       # expected to fall the most
        pos.loc[t] = row
    return pos.ffill().fillna(0)
