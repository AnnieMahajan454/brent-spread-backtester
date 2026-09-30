"""API tests.  python -m pytest  (from backend/)"""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_market_has_11_contracts():
    r = client.get("/api/market").json()
    assert len(r["contracts"]) == 11
    assert r["curve_snapshots"]


def test_study_has_three_strategies():
    r = client.get("/api/study").json()
    assert set(r["strategies"]) == {"Mean reversion", "Momentum", "ML ranking"}


def test_equity_endpoint():
    r = client.get("/api/study/equity/ml_ranking").json()
    assert {"naive", "in_sample", "out_of_sample", "strict_data_out_of_sample"} <= set(r)
    assert client.get("/api/study/equity/nope").status_code == 404


def test_lab_run_default():
    r = client.post("/api/lab/run", json={})
    assert r.status_code == 200
    body = r.json()
    assert body["metrics"]["n_days"] > 0
    assert len(body["equity"]["t"]) == len(body["equity"]["net"])


def test_lab_instant_fills_look_better_than_delayed():
    base = {"strategy": "mean_reversion", "lookback": 48, "entry_z": 1.5, "exit_z": 0.5}
    instant = client.post("/api/lab/run", json={**base, "exec_lag": 0}).json()
    delayed = client.post("/api/lab/run", json={**base, "exec_lag": 1}).json()
    assert instant["metrics"]["gross_pnl"] > delayed["metrics"]["gross_pnl"]


def test_lab_rejects_bad_input():
    assert client.post("/api/lab/run", json={"entry_z": 1.0, "exit_z": 1.5}).status_code == 422
    assert client.post("/api/lab/run", json={"lookback": 100000}).status_code == 422
    assert client.post("/api/lab/run", json={"instruments": ["N27-Q27"]}).status_code == 422
