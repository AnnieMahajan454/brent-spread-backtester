"""
Build calendar spreads and butterflies from the hourly contract prices.

Calendar spread (front - back):   S = F1 - F2          legs (+1, -1)
Butterfly:                       B = F1 - 2*F2 + F3    legs (+1, -2, +1)

Back-month Brent contracts don't trade every hour, so a spread price is only
"valid" in hours where every leg traded recently (within MAX_STALE_HOURS).
Otherwise we'd be subtracting a fresh price from a stale one and inventing
fake moves. With 0 hours of tolerance only 5 of 19 instruments survive,
with 2 hours it's 7 - a compromise between realism and having data.
"""
import pandas as pd

MAX_STALE_HOURS = 2     # a leg's last trade can be at most this many hours old
MIN_VALID_HOURS = 150   # drop instruments with less data than this


def build_instruments(panel, max_stale=MAX_STALE_HOURS,
                      min_valid_hours=MIN_VALID_HOURS, verbose=True):
    """
    panel: DataFrame (hours x contracts) of closes, NaN when no trade.
    Returns
      prices  : DataFrame of spread prices, forward-filled (for marking P&L)
      valid   : bool DataFrame, True where all legs traded recently
      legs    : dict name -> {contract: weight}
    """
    contracts = list(panel.columns)
    recent = panel.ffill(limit=max_stale) if max_stale > 0 else panel
    defs = {}
    for i in range(len(contracts) - 1):
        a, b = contracts[i], contracts[i + 1]
        defs[f"{a}-{b}"] = {a: 1, b: -1}
    for i in range(len(contracts) - 2):
        a, b, c = contracts[i], contracts[i + 1], contracts[i + 2]
        defs[f"{a}/{b}/{c} fly"] = {a: 1, b: -2, c: 1}

    prices, valid, legs, dropped = {}, {}, {}, []
    for name, w in defs.items():
        raw = sum(recent[c] * wt for c, wt in w.items())   # NaN if any leg missing
        n_valid = raw.notna().sum()
        if n_valid < min_valid_hours:
            dropped.append((name, int(n_valid)))
            continue
        valid[name] = raw.notna()
        prices[name] = raw.ffill()
        legs[name] = w

    prices = pd.DataFrame(prices)
    valid = pd.DataFrame(valid)
    if verbose:
        print(f"Kept {len(legs)} instruments, dropped {len(dropped)} "
              f"(fewer than {min_valid_hours} hours with all legs trading):")
        for name, n in dropped:
            print(f"   dropped {name:<18} only {n} valid hours")
    return prices, valid, legs
