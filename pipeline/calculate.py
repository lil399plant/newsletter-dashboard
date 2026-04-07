"""
calculate.py — derives the trader-style metrics from raw collected data.

Input:  the dict returned by collect.collect_all()
Output: a clean, JSON-serialisable dict of metrics that interpret.py
        feeds to Claude and the frontend renders directly.

Structure of output dict
------------------------
{
  "equities": {
    "levels":      { SPY: float, RSP: float, QQQ: float, IWM: float, VIX: float },
    "week_chg_pct":{ ... same keys ... },
    "realized_vol_21d": float,           # SPY annualised %
    "vix_rv_spread":    float,           # VIX − RVol  (+ = fear premium)
    "equal_weight_ratio": float,         # RSP/SPY — breadth proxy
    "ew_ratio_chg_wow":   float,
    "sector_returns_wow": { XLK: float, ... },
    "top_sector":   str,
    "bot_sector":   str,
  },
  "rates": {
    "levels":       { UST_2Y: float, UST_5Y: float, UST_10Y: float, UST_30Y: float },
    "week_chg_bp":  { ... same keys ... },
    "curve_2s10s":  float,               # 10Y − 2Y in bps
    "curve_5s30s":  float,
    "curve_chg_wow_bp": float,           # 2s10s WoW change
    "real_10y":     float,               # TIPS 10Y
    "breakeven_10y":float,
    "real_vs_nominal_split": float,      # what % of 10Y move was real rates
    "sofr_latest":  float,
  },
  "fx": {
    "week_chg_pct": { EURUSD: float, ... },
    "levels":       { ... },
    "factor_labels":{ EURUSD: "growth_proxy", ... },
    "misalignments":[ { pair: str, label: str, reason: str }, ... ],
    "carry_winners":[ str, ... ],        # pairs that moved with their carry direction
  },
  "positioning": {
    "SPX_futures_net": float,
    "SPX_futures_chg": float,
    "TNotes_10Y_net":  float,
    "TNotes_10Y_chg":  float,
    "EUR_futures_net": float,
    "EUR_futures_chg": float,
  },
  "as_of_date": str,
}
"""

import math
import numpy as np
import pandas as pd
from pipeline.collect import FX_FACTOR_LABELS

ANNUALISE = math.sqrt(252)

SECTOR_TICKERS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _last_n_fridays(df: pd.DataFrame, n: int = 2) -> list[pd.Timestamp]:
    """Return the last n Friday closes available in the index."""
    fridays = df.index[df.index.dayofweek == 4]
    return list(fridays[-n:]) if len(fridays) >= n else list(df.index[-n:])


def _wow_pct(series: pd.Series) -> float:
    """Week-over-week % change between the two most recent Fridays."""
    prices = series.dropna()
    fridays = prices.index[prices.index.dayofweek == 4]
    if len(fridays) >= 2:
        prev, curr = fridays[-2], fridays[-1]
    else:
        prev, curr = prices.index[-2], prices.index[-1]
    return round(((prices[curr] / prices[prev]) - 1) * 100, 2)


def _realized_vol_21d(series: pd.Series) -> float:
    """21-day annualised realised vol in percent."""
    rets = series.dropna().pct_change().dropna()
    if len(rets) < 10:
        return float("nan")
    rv = rets.tail(21).std() * ANNUALISE * 100
    return round(rv, 1)


def _latest(series: pd.Series) -> float:
    return round(float(series.dropna().iloc[-1]), 4)


def _prev_week(series: pd.Series) -> float:
    """Value from ~5 trading days ago."""
    s = series.dropna()
    idx = max(len(s) - 6, 0)
    return round(float(s.iloc[idx]), 4)


# ---------------------------------------------------------------------------
# Equities
# ---------------------------------------------------------------------------

def calc_equities(raw: dict) -> dict:
    prices: pd.DataFrame = raw["prices"]
    prices.index = pd.to_datetime(prices.index)

    levels = {t: _latest(prices[t]) for t in ["SPY", "RSP", "QQQ", "IWM", "VIX"] if t in prices}
    week_chg = {t: _wow_pct(prices[t]) for t in ["SPY", "RSP", "QQQ", "IWM", "VIX"] if t in prices}

    # Realized vol (SPY)
    rv = _realized_vol_21d(prices["SPY"]) if "SPY" in prices else float("nan")
    vix_latest = _latest(prices["VIX"]) if "VIX" in prices else float("nan")
    vix_rv_spread = round(vix_latest - rv, 1) if not math.isnan(rv) else float("nan")

    # Breadth: RSP/SPY ratio
    ew_ratio = round(
        _latest(prices["RSP"]) / _latest(prices["SPY"]), 4
    ) if "RSP" in prices and "SPY" in prices else float("nan")
    ew_ratio_prev = round(
        _prev_week(prices["RSP"]) / _prev_week(prices["SPY"]), 4
    ) if "RSP" in prices and "SPY" in prices else float("nan")
    ew_ratio_chg = round((ew_ratio - ew_ratio_prev) * 100, 3)

    # Sector week returns
    sector_rets = {}
    for t in SECTOR_TICKERS:
        if t in prices:
            sector_rets[t] = _wow_pct(prices[t])

    top = max(sector_rets, key=sector_rets.get) if sector_rets else None
    bot = min(sector_rets, key=sector_rets.get) if sector_rets else None

    return {
        "levels": levels,
        "week_chg_pct": week_chg,
        "realized_vol_21d": rv,
        "vix_rv_spread": vix_rv_spread,
        "equal_weight_ratio": ew_ratio,
        "ew_ratio_chg_wow": ew_ratio_chg,
        "sector_returns_wow": sector_rets,
        "top_sector": top,
        "bot_sector": bot,
    }


# ---------------------------------------------------------------------------
# Rates
# ---------------------------------------------------------------------------

def calc_rates(raw: dict) -> dict:
    def _series_latest(label):
        s = raw.get(label)
        return _latest(s) if s is not None and len(s.dropna()) > 0 else float("nan")

    def _series_prev(label):
        s = raw.get(label)
        return _prev_week(s) if s is not None and len(s.dropna()) > 1 else float("nan")

    nominals = ["UST_2Y", "UST_5Y", "UST_10Y", "UST_30Y"]
    levels    = {k: _series_latest(k) for k in nominals}
    prev      = {k: _series_prev(k)   for k in nominals}
    chg_bp    = {k: round((levels[k] - prev[k]) * 100, 1) for k in nominals}

    curve_2s10s      = round((levels["UST_10Y"] - levels["UST_2Y"]) * 100, 1)
    curve_2s10s_prev = round((_series_prev("UST_10Y") - _series_prev("UST_2Y")) * 100, 1)
    curve_5s30s      = round((levels["UST_30Y"] - levels["UST_5Y"]) * 100, 1)
    curve_chg_wow_bp = round(curve_2s10s - curve_2s10s_prev, 1)

    real_10y      = _series_latest("TIPS_10Y")
    bei_10y       = _series_latest("BEI_10Y")
    real_10y_prev = _series_prev("TIPS_10Y")
    bei_10y_prev  = _series_prev("BEI_10Y")

    # What fraction of the 10Y nominal move was driven by real rates vs inflation?
    nom_move  = chg_bp["UST_10Y"]
    real_move = round((real_10y - real_10y_prev) * 100, 1)
    bei_move  = round((bei_10y - bei_10y_prev) * 100, 1)
    total_decomp = abs(real_move) + abs(bei_move)
    real_split = (
        round(abs(real_move) / total_decomp * 100, 0)
        if total_decomp > 0 else float("nan")
    )

    return {
        "levels":              levels,
        "week_chg_bp":         chg_bp,
        "curve_2s10s":         curve_2s10s,
        "curve_5s30s":         curve_5s30s,
        "curve_chg_wow_bp":    curve_chg_wow_bp,
        "real_10y":            real_10y,
        "breakeven_10y":       bei_10y,
        "real_vs_nominal_split": real_split,   # % of 10Y move that was real
        "sofr_latest":         _series_latest("SOFR"),
    }


# ---------------------------------------------------------------------------
# FX
# ---------------------------------------------------------------------------

# Rough carry ranking: pairs where USD has higher rates = USD carry (lower score = better carry vs USD)
# This is a directional heuristic, not a precise carry calc
CARRY_DIRECTION = {
    # If USD rates > foreign rates, holding USD earns carry → pair should be bid for USD
    # (i.e., USDXXX goes up, XXXUSD goes down)
    "EURUSD": -1,   # EUR typically lower rates → long USD = carry
    "USDJPY": +1,   # JPY near zero → long USD (USDJPY up) = carry
    "GBPUSD": -1,
    "AUDUSD": -1,   # flips when RBA aggressive
    "USDCAD": +1,
    "USDCHF": +1,
}


def calc_fx(raw: dict) -> dict:
    prices: pd.DataFrame = raw["prices"]
    prices.index = pd.to_datetime(prices.index)

    pairs = list(FX_FACTOR_LABELS.keys())
    levels   = {p: _latest(prices[p]) for p in pairs if p in prices}
    week_chg = {p: _wow_pct(prices[p]) for p in pairs if p in prices}

    # Misalignment detection
    # For safe-haven pairs: expect them to strengthen in risk-off (VIX up)
    # For growth proxies:   expect them to strengthen when SPY up
    # We flag when the move is in the OPPOSITE direction of what the factor predicts
    misalignments = []
    for pair, label in FX_FACTOR_LABELS.items():
        if pair not in week_chg:
            continue
        chg = week_chg[pair]
        # We'll let interpret.py do the full narrative — here we just flag direction
        # A "misalignment" is noted in the metrics; Claude fills in the why
        if label == "safe_haven":
            # JPY and CHF should strengthen (USDJPY falls, USDCHF falls) in risk-off
            # We can't know risk sentiment here without SPY change, so we pass both
            pass  # handled in interpret.py context
        if label == "tot_play":
            pass  # oil correlation checked in interpret.py

    # Carry winners: pairs that moved in the direction of carry
    carry_winners = []
    for pair, direction in CARRY_DIRECTION.items():
        if pair not in week_chg:
            continue
        if (direction > 0 and week_chg[pair] > 0) or (direction < 0 and week_chg[pair] < 0):
            carry_winners.append(pair)

    return {
        "levels":        levels,
        "week_chg_pct":  week_chg,
        "factor_labels": FX_FACTOR_LABELS,
        "carry_winners": carry_winners,
    }


# ---------------------------------------------------------------------------
# CFTC positioning
# ---------------------------------------------------------------------------

def calc_positioning(raw: dict) -> dict:
    result = {}
    for label, df in raw.items():
        if df.empty or "net_position" not in df.columns:
            result[f"{label}_net"] = float("nan")
            result[f"{label}_chg"] = float("nan")
            continue
        net = df["net_position"].dropna()
        result[f"{label}_net"] = round(float(net.iloc[-1]), 0)
        result[f"{label}_chg"] = round(float(net.diff().iloc[-1]), 0) if len(net) > 1 else float("nan")
    return result


# ---------------------------------------------------------------------------
# Prediction Markets
# ---------------------------------------------------------------------------

def calc_polymarket(raw: dict[str, list[dict]]) -> dict:
    """
    Curates the raw Polymarket pull into a clean metrics dict.

    Returns:
      {
        "top_markets": [
          {
            "question":    str,
            "yes_price":   float,   # 0-1 probability
            "wow_chg":     float,   # week-over-week change in probability
            "day_chg":     float,
            "volume":      float,
            "volume_24h":  float,
            "liquidity":   float,
            "end_date":    str,
            "tag":         str,
          }, ...
        ],
        "biggest_movers": [  # top 3 by abs(wow_chg) ]
        "fed_markets":    [  # economy + fed_decisions filtered to Fed topics ]
        "total_volume_24h": float,
      }
    """
    all_markets: list[dict] = []
    for tag, markets in raw.items():
        for m in markets:
            all_markets.append({**m, "tag": tag})

    # Deduplicate by slug
    seen: set[str] = set()
    unique: list[dict] = []
    for m in all_markets:
        slug = m.get("slug", "")
        if slug and slug not in seen:
            seen.add(slug)
            unique.append(m)

    # Clean numeric fields
    for m in unique:
        for field in ("yes_price", "wow_chg", "day_chg", "volume", "volume_24h", "liquidity", "spread"):
            raw_val = m.pop(field, None) or m.get(
                "wow_price_change" if field == "wow_chg" else
                "day_price_change" if field == "day_chg" else field, None
            )
            try:
                m[field] = round(float(raw_val), 4) if raw_val is not None else None
            except (TypeError, ValueError):
                m[field] = None

        # Ensure wow_chg and day_chg use the right source keys
        if m.get("wow_chg") is None:
            m["wow_chg"] = m.pop("wow_price_change", None)
        if m.get("day_chg") is None:
            m["day_chg"] = m.pop("day_price_change", None)

    # Sort by 24h volume
    top = sorted(unique, key=lambda x: float(x.get("volume_24h") or 0), reverse=True)[:15]

    # Biggest absolute movers WoW
    movers = sorted(
        [m for m in unique if m.get("wow_chg") is not None],
        key=lambda x: abs(float(x["wow_chg"] or 0)),
        reverse=True,
    )[:3]

    # Fed-specific markets
    fed_keywords = ("fed", "rate", "fomc", "cut", "hike", "powell", "basis point")
    fed_markets = [
        m for m in unique
        if any(kw in (m.get("question") or "").lower() for kw in fed_keywords)
    ][:6]

    total_vol_24h = sum(float(m.get("volume_24h") or 0) for m in unique)

    return {
        "top_markets":    top,
        "biggest_movers": movers,
        "fed_markets":    fed_markets,
        "total_volume_24h": round(total_vol_24h, 0),
    }


# ---------------------------------------------------------------------------
# Master runner
# ---------------------------------------------------------------------------

def calculate_all(collected: dict) -> dict:
    """
    Takes the output of collect.collect_all() and returns a clean metrics dict.
    """
    return {
        "equities":         calc_equities(collected["equities"]),
        "rates":            calc_rates(collected["rates"]),
        "fx":               calc_fx(collected["fx"]),
        "positioning":      calc_positioning(collected["cftc"]),
        "prediction_markets": calc_polymarket(collected.get("polymarket", {})),
        "as_of_date":       collected["collected_at"],
    }
