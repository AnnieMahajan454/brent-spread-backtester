"""
Download hourly prices for 11 consecutive Brent futures contracts.

Source: Yahoo Finance (via yfinance), NYMEX Brent Crude Oil Last Day
Financial futures (symbol BZ). BZ is cash-settled against ICE Brent, so its
prices track ICE Brent futures closely.
Contract specs: https://www.cmegroup.com/markets/energy/crude-oil/brent-crude-oil.contractSpecs.html

Yahoo only keeps ~60 days of hourly (1h) history for futures, so running
this script on a different day gives a different 2-month window. The CSVs
used for the results in the README are saved in backend/data/.

    python -m backtester.data        (from the backend/ folder)
"""
import os

import pandas as pd

from . import DATA_DIR, PANEL_CSV

# CME month codes: F=Jan G=Feb H=Mar J=Apr K=May M=Jun N=Jul Q=Aug U=Sep V=Oct X=Nov Z=Dec
CONTRACTS = ["X26", "Z26", "F27", "G27", "H27", "J27",
             "K27", "M27", "N27", "Q27", "U27"]



def download_contract(code):
    import yfinance as yf   # only needed for downloading, not by the API server

    ticker = f"BZ{code}.NYM"
    df = yf.download(ticker, period="60d", interval="1h",
                     progress=False, auto_adjust=False)
    if df.empty:
        print(f"  {ticker}: no data")
        return None
    # yfinance returns MultiIndex columns (field, ticker) -> flatten
    df.columns = [c[0] if isinstance(c, tuple) else c for c in df.columns]
    df = df[["Open", "High", "Low", "Close", "Volume"]]
    df.index = df.index.tz_convert("UTC")
    df.index.name = "timestamp"
    print(f"  {ticker}: {len(df)} hourly bars "
          f"({df.index.min():%Y-%m-%d} -> {df.index.max():%Y-%m-%d})")
    return df


def main():
    os.makedirs(os.path.join(DATA_DIR, "raw"), exist_ok=True)
    closes = {}
    print("Downloading hourly Brent futures from Yahoo Finance...")
    for code in CONTRACTS:
        df = download_contract(code)
        if df is None:
            continue
        df.to_csv(os.path.join(DATA_DIR, "raw", f"BZ{code}.csv"))
        closes[code] = df["Close"]

    # one wide table: rows = hours, columns = contracts (NaN = no trade that hour)
    panel = pd.DataFrame(closes)[CONTRACTS]
    panel.to_csv(PANEL_CSV)
    print(f"Saved panel with {len(panel)} rows to {PANEL_CSV}")


def load_panel():
    """hours x contracts table of hourly closes (NaN = no trade that hour)"""
    return pd.read_csv(PANEL_CSV, index_col=0, parse_dates=True)


if __name__ == "__main__":
    main()
