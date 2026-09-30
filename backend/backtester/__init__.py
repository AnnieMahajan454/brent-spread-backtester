"""Brent futures spread backtester."""
import os

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
RESULTS_DIR = os.path.join(BACKEND_DIR, "results")
PANEL_CSV = os.path.join(DATA_DIR, "brent_hourly_closes.csv")
