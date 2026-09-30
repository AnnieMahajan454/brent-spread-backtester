"""
REST API for the Brent spread backtester.

    uvicorn app.main:app --reload        (from the backend/ folder)
    -> interactive docs at http://localhost:8000/docs

The full walk-forward study (incl. the random forest) takes ~30s, so it is
run offline with `python -m backtester.study` and served from results/.
The strategy lab endpoint runs the two rule-based strategies live (<1s).
"""
import json
import os
from functools import lru_cache

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from backtester import RESULTS_DIR
from backtester.data import load_panel
from backtester.engine import compute_pnl, metrics
from backtester.spreads import build_instruments
from backtester.strategies import mean_reversion, momentum

from .schemas import LabRequest, LabResponse

app = FastAPI(
    title="Brent Spread Backtester API",
    version="1.0.0",
    description="Calendar spreads and butterflies on hourly Brent futures: "
                "data, walk-forward results and a live strategy lab.",
)

origins = os.getenv("ALLOWED_ORIGINS", "*").split(",")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in origins],
                   allow_methods=["GET", "POST"], allow_headers=["*"])

# ---------------------------------------------------------------- data loading
PANEL = load_panel()
with open(os.path.join(RESULTS_DIR, "summary.json")) as f:
    SUMMARY = json.load(f)
EQUITY = pd.read_csv(os.path.join(RESULTS_DIR, "equity_curves.csv"), index_col=0, parse_dates=True)
TEST_PERIOD = slice(pd.Timestamp(SUMMARY["data"]["test_start"]), pd.Timestamp(SUMMARY["data"]["test_end"]))
STRATEGY_KEYS = {"mean_reversion": "Mean reversion", "momentum": "Momentum", "ml_ranking": "ML ranking"}


@lru_cache(maxsize=8)
def instruments_for(max_stale):
    return build_instruments(PANEL, max_stale=max_stale, verbose=False)


def series_json(df, decimals=2):
    """DataFrame -> {"t": [...], col: [...]} with None for missing values"""
    out = {"t": [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in df.index]}
    for c in df.columns:
        out[c] = [None if pd.isna(v) else round(float(v), decimals) for v in df[c]]
    return out


# ---------------------------------------------------------------- endpoints
@app.get("/")
def root():
    return {"name": app.title, "docs": "/docs", "health": "/api/health"}


@app.get("/api/health")
def health():
    return {"status": "ok", "data_end": SUMMARY["data"]["end"]}


@app.get("/api/market")
def market():
    """Contract-level info: forward curve, liquidity, weekly curve snapshots."""
    d = SUMMARY["data"]
    filled = PANEL.ffill()
    # last real hour of each week (so the final snapshot is dated by the data, not the calendar)
    weekly = filled.groupby(filled.index.tz_localize(None).to_period("W-FRI")).tail(1)
    liquid = [c for c in PANEL.columns if d["bars_per_contract"][c] >= 150]
    snapshots = [{"date": t.strftime("%Y-%m-%d"),
                  "prices": {c: round(float(row[c]), 2) for c in liquid if pd.notna(row[c])}}
                 for t, row in weekly.iterrows()]
    return {
        "source": d["source"], "start": d["start"], "end": d["end"], "n_hours": d["n_hours"],
        "contracts": d["contracts"], "last_price": d["last_price"],
        "bars_per_contract": d["bars_per_contract"], "liquid_contracts": liquid,
        "curve_snapshots": snapshots,
    }


@app.get("/api/spreads")
def spreads(max_stale: int = Query(2, ge=0, le=4)):
    """Hourly spread prices plus the hours in which each spread was tradable."""
    prices, valid, legs = instruments_for(max_stale)
    return {"legs": legs, "valid_hours": {c: int(valid[c].sum()) for c in valid},
            "prices": series_json(prices, 3)}


@app.get("/api/study")
def study():
    """Precomputed walk-forward study: metrics, folds, robustness checks."""
    return SUMMARY


@app.get("/api/study/equity/{strategy}")
def study_equity(strategy: str):
    if strategy not in STRATEGY_KEYS:
        raise HTTPException(404, f"unknown strategy, use one of {list(STRATEGY_KEYS)}")
    name = STRATEGY_KEYS[strategy]
    cols = [c for c in EQUITY.columns if c.startswith(name + "|")]
    df = EQUITY[cols].rename(columns=lambda c: c.split("|")[1])
    return series_json(df, 0)


@app.post("/api/lab/run", response_model=LabResponse)
def lab_run(req: LabRequest):
    """Run one rule-based strategy with your own settings (in-sample!)."""
    prices, valid, legs = instruments_for(req.max_stale)
    names = req.instruments or list(legs)
    unknown = [n for n in names if n not in legs]
    if unknown:
        raise HTTPException(422, f"not available with max_stale={req.max_stale}: {unknown}")
    prices, valid = prices[names], valid[names]
    legs = {n: legs[n] for n in names}

    if req.strategy == "mean_reversion":
        if req.exit_z >= req.entry_z:
            raise HTTPException(422, "exit_z must be smaller than entry_z")
        pos = mean_reversion(prices, valid, req.lookback, req.entry_z, req.exit_z)
    else:
        pos = momentum(prices, valid, req.lookback, req.threshold)

    period = TEST_PERIOD if req.period == "test" else slice(None)
    pnl = compute_pnl(pos, prices, legs, valid, exec_lag=req.exec_lag,
                      cost_mult=req.cost_mult).loc[period]
    per_inst = {c: round(float(compute_pnl(pos[[c]], prices[[c]], {c: legs[c]}, valid[[c]],
                                           exec_lag=req.exec_lag, cost_mult=req.cost_mult)
                               .loc[period, "net"].sum()), 2) for c in names}
    equity = pnl[["net", "gross"]].cumsum()
    equity = equity.iloc[::2] if len(equity) > 800 else equity   # keep the payload small

    wf = SUMMARY["strategies"][STRATEGY_KEYS[req.strategy]]["out_of_sample"]["net_pnl"]
    return LabResponse(request=req, metrics=metrics(pnl), instruments=names,
                       per_instrument=per_inst, equity=series_json(equity, 0),
                       walk_forward_net_pnl=wf)
