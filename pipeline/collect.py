"""
collect.py — raw data pulls for the weekly market dashboard.

Each function returns a dict of DataFrames keyed by asset/series name.
All pulls cover the last 4 weeks so calculate.py has enough history
for rolling metrics (realized vol, etc.) while keeping payloads small.

Data sources:
  - yfinance        : equities, VIX, FX spot
  - FRED API        : treasury rates, TIPS yields, breakevens
  - CFTC            : Commitment of Traders (direct CSV download)
  - Polymarket API  : prediction market probabilities (no auth required)
"""

import os
import requests
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _date_range(weeks_back: int = 4) -> tuple[str, str]:
    end = datetime.today()
    start = end - timedelta(weeks=weeks_back)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def _fred(series_id: str, start: str) -> pd.Series:
    """Pull a single FRED series, return as a dated float Series."""
    resp = requests.get(
        "https://api.stlouisfed.org/fred/series/observations",
        params={
            "series_id": series_id,
            "observation_start": start,
            "api_key": os.environ["FRED_API_KEY"],
            "file_type": "json",
            "sort_order": "asc",
        },
        timeout=15,
    )
    resp.raise_for_status()
    obs = resp.json()["observations"]
    data = {o["date"]: float(o["value"]) for o in obs if o["value"] != "."}
    return pd.Series(data, dtype=float, name=series_id)


# ---------------------------------------------------------------------------
# Equities
# ---------------------------------------------------------------------------

EQUITY_TICKERS = {
    "SPY": "SPY",       # S&P 500
    "RSP": "RSP",       # Equal-weight S&P 500 (breadth check)
    "QQQ": "QQQ",       # Nasdaq
    "IWM": "IWM",       # Russell 2000 (risk appetite)
    "VIX": "^VIX",      # Implied vol
    # Sectors
    "XLK": "XLK",       # Tech
    "XLF": "XLF",       # Financials
    "XLE": "XLE",       # Energy
    "XLV": "XLV",       # Health care
    "XLI": "XLI",       # Industrials
    "XLY": "XLY",       # Consumer discretionary
    "XLP": "XLP",       # Consumer staples
    "XLU": "XLU",       # Utilities
    "XLB": "XLB",       # Materials
    "XLRE": "XLRE",     # Real estate
    "XLC": "XLC",       # Communication services
}


def collect_equities() -> dict[str, pd.DataFrame]:
    """
    Returns:
      "prices"  : DataFrame  — daily close, columns = ticker labels
    """
    start, end = _date_range(weeks_back=6)  # extra history for 21d rvol
    tickers = list(EQUITY_TICKERS.values())

    raw = yf.download(tickers, start=start, end=end, auto_adjust=True, progress=False)
    closes = raw["Close"].rename(columns={v: k for k, v in EQUITY_TICKERS.items()})

    return {"prices": closes}


# ---------------------------------------------------------------------------
# Rates
# ---------------------------------------------------------------------------

RATE_SERIES = {
    # Nominal treasuries
    "UST_2Y":  "DGS2",
    "UST_5Y":  "DGS5",
    "UST_10Y": "DGS10",
    "UST_30Y": "DGS30",
    # TIPS (real yields)
    "TIPS_5Y":  "DFII5",
    "TIPS_10Y": "DFII10",
    # Breakeven inflation (nominal − real, but FRED publishes it directly)
    "BEI_5Y":  "T5YIE",
    "BEI_10Y": "T10YIE",
    # SOFR (overnight, as a policy-rate proxy)
    "SOFR": "SOFR",
}


def collect_rates() -> dict[str, pd.Series]:
    """
    Returns dict of {label: pd.Series} for each rate series.
    Each Series is indexed by date string, values in percent.
    """
    start, _ = _date_range(weeks_back=6)
    return {label: _fred(series_id, start) for label, series_id in RATE_SERIES.items()}


# ---------------------------------------------------------------------------
# FX
# ---------------------------------------------------------------------------

FX_TICKERS = {
    "EURUSD": "EURUSD=X",
    "USDJPY": "JPY=X",
    "GBPUSD": "GBPUSD=X",
    "AUDUSD": "AUDUSD=X",
    "USDCAD": "CAD=X",
    "USDCHF": "CHF=X",
}

# Factor labels — used by calculate.py to flag misalignments
FX_FACTOR_LABELS = {
    "EURUSD": "growth_proxy",
    "USDJPY": "safe_haven",    # JPY is the safe haven (USD/JPY falls in risk-off)
    "GBPUSD": "growth_proxy",
    "AUDUSD": "growth_proxy",  # Also terms-of-trade / China proxy
    "USDCAD": "tot_play",      # Terms of trade / oil
    "USDCHF": "safe_haven",    # CHF is the safe haven
}


def collect_fx() -> dict[str, pd.DataFrame]:
    """
    Returns:
      "prices" : DataFrame — daily close, columns = pair labels (e.g. EURUSD)
    """
    start, end = _date_range(weeks_back=6)
    tickers = list(FX_TICKERS.values())

    raw = yf.download(tickers, start=start, end=end, auto_adjust=True, progress=False)
    closes = raw["Close"].rename(columns={v: k for k, v in FX_TICKERS.items()})

    return {"prices": closes}


# ---------------------------------------------------------------------------
# Positioning — CFTC Commitment of Traders
# ---------------------------------------------------------------------------

# CFTC report codes for the contracts we care about
CFTC_REPORTS = {
    "SPX_futures":  "13874+",   # S&P 500 Consolidated (CME)
    "TNotes_10Y":   "043602",   # 10-Year T-Note (CBOT)
    "EUR_futures":  "099741",   # Euro FX (CME)
}


def collect_cftc() -> dict[str, pd.DataFrame]:
    """
    Pulls the last ~10 weeks of COT data for each contract via CFTC's
    public API. Returns dict of {contract_label: DataFrame}.

    Key columns kept:
      - noncomm_positions_long_all   (speculator longs)
      - noncomm_positions_short_all  (speculator shorts)
      - net_position                 (derived: longs − shorts)
    """
    base = "https://publicreporting.cftc.gov/resource/jun7-fc8e.json"
    results = {}

    for label, report_id in CFTC_REPORTS.items():
        resp = requests.get(
            base,
            params={
                "cftc_contract_market_code": report_id,
                "$order": "report_date_as_yyyy_mm_dd DESC",
                "$limit": 12,
            },
            timeout=15,
        )
        resp.raise_for_status()
        rows = resp.json()

        if not rows:
            results[label] = pd.DataFrame()
            continue

        df = pd.DataFrame(rows)
        df["report_date"] = pd.to_datetime(df["report_date_as_yyyy_mm_dd"])
        df = df.set_index("report_date").sort_index()

        keep = [
            "noncomm_positions_long_all",
            "noncomm_positions_short_all",
        ]
        # CFTC field names vary slightly by report; grab what's available
        existing = [c for c in keep if c in df.columns]
        df = df[existing].apply(pd.to_numeric, errors="coerce")

        if "noncomm_positions_long_all" in df.columns and "noncomm_positions_short_all" in df.columns:
            df["net_position"] = (
                df["noncomm_positions_long_all"] - df["noncomm_positions_short_all"]
            )

        results[label] = df

    return results


# ---------------------------------------------------------------------------
# Prediction Markets — Polymarket
# ---------------------------------------------------------------------------

POLYMARKET_BASE = "https://gamma-api.polymarket.com"

# Tag IDs for macro-relevant categories on Polymarket
POLYMARKET_TAGS = {
    "economy":       "100328",
    "fed_decisions": "100196",
    "politics":      "100389",
}

# Markets we always want regardless of tag (by slug keyword)
POLYMARKET_PRIORITY_SLUGS = [
    "recession",
    "fed-rate",
    "federal-reserve",
    "cpi",
    "unemployment",
    "gdp",
    "tariff",
    "inflation",
]


def _fetch_tag_events(tag_id: str, limit: int = 8) -> list[dict]:
    resp = requests.get(
        f"{POLYMARKET_BASE}/events",
        params={
            "active":     "true",
            "limit":      limit,
            "order":      "volume",
            "ascending":  "false",
            "volume_num_min": "10000",
            "tag_id":     tag_id,
        },
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def _parse_event_markets(event: dict) -> list[dict]:
    """
    Flatten an event into a list of its individual markets with key fields.
    Each market gets:
      question, slug, yes_price, no_price, wow_price_change,
      volume, volume_24h, liquidity, end_date, event_title
    """
    markets = []
    for m in event.get("markets", []):
        try:
            outcomes = m.get("outcomes", [])
            prices   = m.get("outcomePrices", [])
            if isinstance(outcomes, str):
                import json as _json
                outcomes = _json.loads(outcomes)
                prices   = _json.loads(prices)

            yes_idx = next(
                (i for i, o in enumerate(outcomes) if str(o).lower() == "yes"), 0
            )
            yes_price = float(prices[yes_idx]) if prices else None

            markets.append({
                "event_title":     event.get("title", ""),
                "question":        m.get("question", ""),
                "slug":            m.get("slug", ""),
                "yes_price":       yes_price,
                "wow_price_change":m.get("oneWeekPriceChange"),
                "day_price_change":m.get("oneDayPriceChange"),
                "volume":          m.get("volumeNum") or m.get("volume"),
                "volume_24h":      m.get("volume24hr"),
                "liquidity":       m.get("liquidityNum") or m.get("liquidity"),
                "end_date":        m.get("endDate") or m.get("endDateIso"),
                "spread":          m.get("spread"),
                "active":          m.get("active", True),
                "closed":          m.get("closed", False),
            })
        except Exception:
            continue
    return markets


def collect_polymarket() -> dict[str, list[dict]]:
    """
    Returns:
      {
        "economy":       [ { question, yes_price, wow_price_change, ... }, ... ],
        "fed_decisions": [ ... ],
        "politics":      [ ... ],
      }
    """
    results: dict[str, list[dict]] = {}

    for tag_name, tag_id in POLYMARKET_TAGS.items():
        try:
            events = _fetch_tag_events(tag_id, limit=6)
            markets = []
            for event in events:
                markets.extend(_parse_event_markets(event))
            # Sort by volume descending, keep top 10 per tag
            markets.sort(key=lambda x: float(x.get("volume") or 0), reverse=True)
            results[tag_name] = markets[:10]
        except Exception as exc:
            results[tag_name] = []

    return results


# ---------------------------------------------------------------------------
# Master runner
# ---------------------------------------------------------------------------

def collect_all() -> dict:
    """
    Run all collectors and return a single nested dict:
    {
      "equities":         { "prices": DataFrame },
      "rates":            { "UST_2Y": Series, ... },
      "fx":               { "prices": DataFrame },
      "cftc":             { "SPX_futures": DataFrame, ... },
      "polymarket":       { "economy": [...], "fed_decisions": [...], ... },
      "collected_at":     "2026-04-06T18:00:00"
    }
    """
    return {
        "equities":    collect_equities(),
        "rates":       collect_rates(),
        "fx":          collect_fx(),
        "cftc":        collect_cftc(),
        "polymarket":  collect_polymarket(),
        "collected_at": datetime.utcnow().isoformat(timespec="seconds"),
    }
