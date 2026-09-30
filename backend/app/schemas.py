from typing import Literal, Optional

from pydantic import BaseModel, Field


class LabRequest(BaseModel):
    """Parameters for one backtest run in the strategy lab."""
    strategy: Literal["mean_reversion", "momentum"] = "mean_reversion"
    lookback: int = Field(48, ge=4, le=240, description="rolling window, in tradable hours")
    entry_z: float = Field(1.5, ge=0.25, le=4.0, description="mean reversion: enter when |z| > entry_z")
    exit_z: float = Field(0.5, ge=0.0, le=2.0, description="mean reversion: exit when |z| < exit_z")
    threshold: float = Field(0.0, ge=0.0, le=3.0, description="momentum: min move in volatility units")
    cost_mult: float = Field(1.0, ge=0.0, le=5.0, description="scale all slippage and fees")
    exec_lag: int = Field(1, ge=0, le=3, description="fresh prices between signal and fill (0 = instant)")
    max_stale: int = Field(2, ge=0, le=4, description="max age of a leg's last trade, in hours")
    period: Literal["test", "full"] = "test"
    instruments: Optional[list[str]] = Field(None, description="subset of instruments, default all")


class Metrics(BaseModel):
    net_pnl: float
    gross_pnl: float
    costs: float
    contracts_traded: int
    sharpe: float
    max_drawdown: float
    pct_days_positive: float
    n_days: int


class LabResponse(BaseModel):
    request: LabRequest
    metrics: Metrics
    instruments: list[str]
    per_instrument: dict[str, float]
    equity: dict[str, list]
    walk_forward_net_pnl: Optional[float] = None
