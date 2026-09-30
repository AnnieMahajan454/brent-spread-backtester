"""
Static PNG charts for the README.   python -m backtester.charts
(run python -m backtester.study first)
"""
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt   # noqa: E402
import pandas as pd               # noqa: E402


from . import BACKEND_DIR, RESULTS_DIR as RES

IMG = os.path.join(BACKEND_DIR, "..", "docs", "images")
COLORS = {"naive": "#9aa3ab", "in_sample": "#eb6834",
          "out_of_sample": "#2a78d6", "strict_data_out_of_sample": "#1baf7a"}
LABELS = {"naive": "naive (instant fills, 1 tick)", "in_sample": "in-sample (hindsight params)",
          "out_of_sample": "walk-forward OOS", "strict_data_out_of_sample": "walk-forward, strict data"}

plt.rcParams.update({"font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.alpha": 0.3})


def forward_curve(summary):
    last = summary["data"]["last_price"]
    fig, ax = plt.subplots(figsize=(7, 3))
    ax.plot(list(last), list(last.values()), marker="o", color="#0f5c6e")
    ax.set_title(f"Brent futures curve on {summary['data']['end'][:10]} (last trade per contract)")
    ax.set_ylabel("$/bbl")
    fig.tight_layout()
    fig.savefig(os.path.join(IMG, "forward_curve.png"), dpi=130)


def spreads():
    prices = pd.read_csv(os.path.join(RES, "spread_prices.csv"), index_col=0, parse_dates=True)
    cal = [c for c in prices.columns if "fly" not in c]
    fly = [c for c in prices.columns if "fly" in c]
    fig, axes = plt.subplots(2, 1, figsize=(8, 5), sharex=True)
    prices[cal].plot(ax=axes[0], lw=1)
    axes[0].set_title("Calendar spreads ($/bbl)")
    prices[fly].plot(ax=axes[1], lw=1)
    axes[1].set_title("Butterflies ($/bbl)")
    for a in axes:
        a.legend(fontsize=7, ncol=4, loc="upper left")
        a.set_xlabel("")
    fig.tight_layout()
    fig.savefig(os.path.join(IMG, "spreads.png"), dpi=130)


def equity(summary):
    eq = pd.read_csv(os.path.join(RES, "equity_curves.csv"), index_col=0, parse_dates=True)
    names = list(summary["strategies"])
    fig, axes = plt.subplots(1, len(names), figsize=(12, 3.5), sharey=True)
    for ax, name in zip(axes, names):
        for kind, color in COLORS.items():
            s = eq[f"{name}|{kind}"]
            ax.plot(s.index, s / 1000, color=color, lw=1.4, label=LABELS[kind])
        ax.axhline(0, color="black", lw=0.8)
        ax.set_title(name)
        ax.tick_params(axis="x", rotation=30)
    axes[0].set_ylabel("cumulative net P&L ($ thousands)")
    axes[0].legend(fontsize=7)
    fig.suptitle("Same test period, four ways of backtesting it")
    fig.tight_layout()
    fig.savefig(os.path.join(IMG, "equity_curves.png"), dpi=130)


def main():
    os.makedirs(IMG, exist_ok=True)
    with open(os.path.join(RES, "summary.json")) as f:
        summary = json.load(f)
    forward_curve(summary)
    spreads()
    equity(summary)
    print(f"saved charts to {os.path.abspath(IMG)}")


if __name__ == "__main__":
    main()
