"""
Main script: build spreads, run all strategies, walk-forward test, save results.

    python -m backtester.study        (from the backend/ folder, takes ~30s)

Walk-forward setup (expanding window):
    |---- train (first ~3 weeks) ----|- test wk1 -|
    |---------- train ---------------------------|- test wk2 -|
    ...
Parameters / the ML model are chosen using ONLY the train part, then run on
the next unseen week. The out-of-sample result is all test weeks stitched
together.

Three versions of every result, all over the same test period:
  naive         - hindsight-best params, filled instantly at the signal price,
                  1 tick costs. (What my first version of this backtest did.)
  in-sample     - hindsight-best params, but with realistic fills + costs
  out-of-sample - walk-forward, realistic fills + costs  <- the honest number

Then some robustness checks on the out-of-sample result:
  - P&L per instrument (does the profit come from liquid or illiquid spreads?)
  - higher trading costs
  - strict data: only use hours where every leg traded in that same hour
"""
import itertools
import json
import os

import pandas as pd

from . import RESULTS_DIR
from .data import load_panel
from .engine import (compute_pnl, metrics, EXEC_LAG_HOURS, SLIPPAGE_TICKS,
                      DEFAULT_SLIPPAGE_TICKS, FEES_PER_CONTRACT)
from .spreads import build_instruments, MAX_STALE_HOURS
from .strategies import (mean_reversion, momentum, make_features, new_model,
                        rank_to_positions, FEATURES, HOLD_HOURS)

FIRST_TRAIN_HOURS = 400     # ~3.5 weeks of trading hours before first test
TEST_HOURS = 120            # ~1 week per test block
COST_MULTIPLIERS = [0.5, 1, 1.5, 2, 3]

PARAM_GRIDS = {
    "Mean reversion": (mean_reversion, {
        "lookback": [24, 48, 96],
        "entry_z": [1.0, 1.5, 2.0],
        "exit_z": [0.0, 0.5],
    }),
    "Momentum": (momentum, {
        "lookback": [6, 12, 24, 48],
        "threshold": [0.0, 0.5, 1.0],
    }),
}


def make_folds(index):
    folds = []
    start = FIRST_TRAIN_HOURS
    while start < len(index):
        end = min(start + TEST_HOURS, len(index))
        folds.append((index[0], index[start - 1], index[start], index[end - 1]))
        start = end
    return folds


def all_param_sets(grid):
    keys = list(grid)
    return [dict(zip(keys, vals)) for vals in itertools.product(*grid.values())]


def run_rule_strategy(func, grid, prices, valid, legs, folds, test_period, log):
    param_sets = all_param_sets(grid)
    # signals only use past data, so each param set can be run once on the full history
    positions = {json.dumps(ps): func(prices, valid, **ps) for ps in param_sets}
    pnls = {k: compute_pnl(pos, prices, legs, valid) for k, pos in positions.items()}

    # walk-forward: pick best params on the train window, use them on the next test week
    oos_parts, chosen = [], []
    for tr_start, tr_end, te_start, te_end in folds:
        train_scores = {k: p.loc[tr_start:tr_end, "net"].sum() for k, p in pnls.items()}
        best = max(train_scores, key=train_scores.get)
        chosen.append({"test_start": str(te_start.date()), "params": json.loads(best),
                       "train_pnl": round(train_scores[best], 2)})
        oos_parts.append(positions[best].loc[te_start:te_end])
        log(f"  fold test {te_start:%m-%d}: params {best}  train P&L ${train_scores[best]:,.0f}")
    oos_pos = pd.concat(oos_parts).reindex(prices.index).fillna(0)

    # hindsight: best params judged on the test period itself (cheating on purpose)
    test_scores = {k: p.loc[test_period, "net"].sum() for k, p in pnls.items()}
    best_is = max(test_scores, key=test_scores.get)
    n_profitable = sum(v > 0 for v in test_scores.values())
    log(f"  hindsight best {best_is}: ${test_scores[best_is]:,.0f}")
    log(f"  {n_profitable}/{len(test_scores)} parameter sets profitable over test period")

    return {
        "is_pos": positions[best_is], "oos_pos": oos_pos,
        "extra": {
            "hindsight_params": json.loads(best_is),
            "walk_forward_choices": chosen,
            "n_param_sets": len(param_sets),
            "n_profitable_param_sets": int(n_profitable),
            "all_param_pnls": {k: round(v, 2) for k, v in test_scores.items()},
        },
    }


def run_ml_strategy(prices, valid, legs, folds, test_period, log):
    feats = make_features(prices, valid)
    labelled = feats.dropna(subset=["target"])

    # in-sample: train on the test period and predict the same period (cheating on purpose)
    ins_rows = labelled.loc[test_period]
    model = new_model().fit(ins_rows[FEATURES], ins_rows["target"])
    preds = feats.loc[test_period, ["instrument"]].copy()
    preds["pred"] = model.predict(feats.loc[test_period, FEATURES])
    is_pos = rank_to_positions(preds, prices)
    ins_r2 = model.score(ins_rows[FEATURES], ins_rows["target"])

    # walk-forward: retrain each week on everything before it
    all_preds, fold_info = [], []
    for tr_start, tr_end, te_start, te_end in folds:
        # purge: the last HOLD_HOURS rows' targets look into the test week -> drop them
        purge_cutoff = prices.index[prices.index.get_loc(tr_end) - HOLD_HOURS]
        train = labelled.loc[tr_start:purge_cutoff]
        m = new_model().fit(train[FEATURES], train["target"])
        test = feats.loc[te_start:te_end]
        p = test[["instrument"]].copy()
        p["pred"] = m.predict(test[FEATURES])
        all_preds.append(p)
        test_lab = test.dropna(subset=["target"])
        if len(test_lab) < 10:      # last fold can be too short to have future targets
            corr = float("nan")
        else:
            corr = pd.Series(m.predict(test_lab[FEATURES])).corr(
                test_lab["target"].reset_index(drop=True))
        fold_info.append({"test_start": str(te_start.date()), "train_rows": len(train),
                          "pred_vs_actual_corr": None if pd.isna(corr) else round(float(corr), 3)})
        log(f"  fold test {te_start:%m-%d}: trained on {len(train)} rows, "
            f"corr(pred, actual) = {corr:+.3f}")
    # run the ranking once over all predictions so positions carry across fold edges
    oos_pos = rank_to_positions(pd.concat(all_preds), prices)

    log(f"  in-sample R^2 {ins_r2:.3f}")
    return {
        "is_pos": is_pos, "oos_pos": oos_pos,
        "extra": {"in_sample_r2": round(ins_r2, 3), "folds": fold_info,
                  "feature_importance": {k: round(float(v), 3) for k, v
                                         in zip(FEATURES, model.feature_importances_)}},
    }


def run_all(panel, max_stale, verbose=True):
    log = print if verbose else (lambda *a: None)
    prices, valid, legs = build_instruments(panel, max_stale=max_stale, verbose=verbose)
    folds = make_folds(prices.index)
    test_period = slice(folds[0][2], folds[-1][3])
    log(f"{len(folds)} walk-forward folds, test period "
        f"{folds[0][2]:%Y-%m-%d} to {folds[-1][3]:%Y-%m-%d}")

    results = {}
    for name, (func, grid) in PARAM_GRIDS.items():
        log(f"\n=== {name} ===")
        results[name] = run_rule_strategy(func, grid, prices, valid, legs,
                                          folds, test_period, log)
    log("\n=== ML ranking (random forest) ===")
    results["ML ranking"] = run_ml_strategy(prices, valid, legs, folds, test_period, log)

    for r in results.values():
        r["naive"] = compute_pnl(r["is_pos"], prices, legs, exec_lag=0, flat_ticks=1).loc[test_period]
        r["in_sample"] = compute_pnl(r["is_pos"], prices, legs, valid).loc[test_period]
        r["out_of_sample"] = compute_pnl(r["oos_pos"], prices, legs, valid).loc[test_period]
    return results, prices, valid, legs, folds, test_period


def robustness(r, prices, valid, legs, test_period):
    pos = r["oos_pos"]
    per_instrument = {}
    for c in prices.columns:
        p = compute_pnl(pos[[c]], prices[[c]], {c: legs[c]}, valid[[c]]).loc[test_period]
        per_instrument[c] = {"net_pnl": round(p["net"].sum(), 2),
                             "valid_hours": int(valid[c].sum())}
    by_cost = {str(m): round(compute_pnl(pos, prices, legs, valid, cost_mult=m)
                             .loc[test_period, "net"].sum(), 2)
               for m in COST_MULTIPLIERS}
    return {"per_instrument": per_instrument, "net_pnl_by_cost_multiplier": by_cost}


def main():
    os.makedirs(RESULTS_DIR, exist_ok=True)
    panel = load_panel()
    print(f"Loaded {panel.shape[0]} hours x {panel.shape[1]} contracts "
          f"({panel.index.min():%Y-%m-%d} to {panel.index.max():%Y-%m-%d})")

    results, prices, valid, legs, folds, test_period = run_all(panel, MAX_STALE_HOURS)

    print("\nRe-running everything with strict data (legs must trade in the same hour)...")
    strict, *_ = run_all(panel, max_stale=0, verbose=False)

    summary = {
        "data": {
            "source": "Yahoo Finance hourly bars, NYMEX Brent Last Day Financial futures (BZ)",
            "start": str(panel.index.min()), "end": str(panel.index.max()),
            "n_hours": int(len(panel)),
            "contracts": list(panel.columns),
            "bars_per_contract": {c: int(n) for c, n in panel.notna().sum().items()},
            "last_price": {c: round(float(panel[c].dropna().iloc[-1]), 2) for c in panel.columns},
            "instruments": list(legs),
            "valid_hours": {c: int(n) for c, n in valid.sum().items()},
            "max_stale_hours": MAX_STALE_HOURS,
            "exec_lag_hours": EXEC_LAG_HOURS,
            "slippage_ticks": {**SLIPPAGE_TICKS, "other": DEFAULT_SLIPPAGE_TICKS},
            "fees_per_contract_usd": round(FEES_PER_CONTRACT * 1000, 2),
            "test_start": str(folds[0][2]), "test_end": str(folds[-1][3]),
            "n_folds": len(folds),
        },
        "strategies": {},
    }
    equity = {}
    for name, r in results.items():
        summary["strategies"][name] = {
            "naive": metrics(r["naive"]),
            "in_sample": metrics(r["in_sample"]),
            "out_of_sample": metrics(r["out_of_sample"]),
            "strict_data_out_of_sample": metrics(strict[name]["out_of_sample"]),
            **robustness(r, prices, valid, legs, test_period),
            **r["extra"],
        }
        for kind in ("naive", "in_sample", "out_of_sample"):
            equity[f"{name}|{kind}"] = r[kind]["net"].cumsum()
        equity[f"{name}|strict_data_out_of_sample"] = strict[name]["out_of_sample"]["net"].cumsum()

    with open(os.path.join(RESULTS_DIR, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2, default=str)
    pd.DataFrame(equity).ffill().fillna(0).round(2).to_csv(os.path.join(RESULTS_DIR, "equity_curves.csv"))
    prices.round(4).to_csv(os.path.join(RESULTS_DIR, "spread_prices.csv"))

    print("\n=== Summary: test period only, net of costs ($ per 1 spread unit) ===")
    rows = []
    for name, s in summary["strategies"].items():
        rows.append([name, s["naive"]["net_pnl"], s["in_sample"]["net_pnl"],
                     s["out_of_sample"]["net_pnl"], s["out_of_sample"]["sharpe"],
                     s["strict_data_out_of_sample"]["net_pnl"],
                     s["net_pnl_by_cost_multiplier"]["2"]])
    table = pd.DataFrame(rows, columns=["strategy", "naive", "in-sample", "walk-fwd OOS",
                                        "OOS sharpe", "OOS strict data", "OOS 2x costs"])
    print(table.to_string(index=False))
    table.to_csv(os.path.join(RESULTS_DIR, "summary_table.csv"), index=False)


if __name__ == "__main__":
    main()
