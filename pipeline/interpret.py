"""
interpret.py — feeds the calculated metrics to Gemini Flash and returns
structured commentary in your newsletter's trader-note voice.

Each section gets:
  - one tight "level + vol + breadth + flow" summary line
  - one "so what" sentence
  - one soft actionable

Output is a dict that maps directly onto the frontend dashboard sections.
"""

import os
import json
import urllib.request

GEMINI_API_KEY = os.environ["GEMINI_API_KEY"]
MODEL = "gemini-2.0-flash"
GEMINI_URL = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{MODEL}:generateContent?key={GEMINI_API_KEY}"
)

SYSTEM_PROMPT = """You write the markets section of a professional financial newsletter.

Voice: tight, trader-note style. No fluff. One strong sentence beats three weak ones.
Frame everything as "what changed in the distribution of outcomes" not "here's what happened."
When numbers are ambiguous, say so. When something is mispriced vs narrative, name it.

Format rules:
- Each section: 2-3 sentences max
- Always end with a "so what" that gives the reader one thing to hold in their head
- One soft actionable per section (not financial advice — a framing or positioning implication)
- Never use filler phrases like "it's worth noting" or "as we can see"
- Numbers in the output should match exactly what's in the metrics provided"""


def _fmt_metrics(metrics: dict) -> str:
    """Compact JSON block passed as user context."""
    return json.dumps(metrics, indent=2, default=str)


def _call(prompt: str) -> str:
    """Call Gemini Flash via REST — no SDK needed."""
    full_prompt = SYSTEM_PROMPT + "\n\n" + prompt
    body = json.dumps({
        "contents": [{"parts": [{"text": full_prompt}]}],
        "generationConfig": {"maxOutputTokens": 600, "temperature": 0.3},
    }).encode()

    req = urllib.request.Request(
        GEMINI_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())

    return result["candidates"][0]["content"]["parts"][0]["text"].strip()


# ---------------------------------------------------------------------------
# Section prompts
# ---------------------------------------------------------------------------

def interpret_equities(eq: dict, pos: dict) -> dict:
    spx_chg  = eq["week_chg_pct"].get("SPY", "n/a")
    vix      = eq["levels"].get("VIX", "n/a")
    rv       = eq["realized_vol_21d"]
    spread   = eq["vix_rv_spread"]
    ew_chg   = eq["ew_ratio_chg_wow"]
    top_s    = eq["top_sector"]
    bot_s    = eq["bot_sector"]
    top_ret  = eq["sector_returns_wow"].get(top_s, "n/a") if top_s else "n/a"
    bot_ret  = eq["sector_returns_wow"].get(bot_s, "n/a") if bot_s else "n/a"
    spx_net  = pos.get("SPX_futures_net", "n/a")
    spx_chg_ = pos.get("SPX_futures_chg", "n/a")

    prompt = f"""
Write the EQUITIES section of this week's market dashboard.

Metrics:
{_fmt_metrics({
    "SPY_week_chg_pct": spx_chg,
    "VIX": vix,
    "realized_vol_21d_pct": rv,
    "vix_minus_rvol_spread": spread,
    "equal_weight_ratio_chg_wow_pct": ew_chg,
    "top_sector": top_s, "top_sector_ret_pct": top_ret,
    "bot_sector": bot_s, "bot_sector_ret_pct": bot_ret,
    "SPX_futures_net_spec_position": spx_net,
    "SPX_futures_chg_wow": spx_chg_,
})}

Write three things:
1. "summary": one sentence covering level + vol + breadth (use the numbers)
2. "tape_vs_story": a "Narrative / Tape / Read" 3-line block that captures
   whether the price action confirms or contradicts the dominant story this week.
   Format exactly as:
   Narrative: [dominant market narrative]
   Tape: [what price/vol/breadth actually shows]
   Read: [your one-line interpretation of the gap]
3. "so_what": one sentence — the single most important implication for someone
   positioned in US equities right now
4. "actionable": one soft framing idea (not financial advice)

Return as JSON with keys: summary, tape_vs_story, so_what, actionable
"""
    raw = _call(prompt)
    try:
        # Strip markdown code fences if present
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {"summary": raw, "tape_vs_story": "", "so_what": "", "actionable": ""}


def interpret_rates(rates: dict) -> dict:
    prompt = f"""
Write the RATES section of this week's market dashboard.

Metrics:
{_fmt_metrics(rates)}

Write four things:
1. "summary": one sentence — front-end / belly / long-end moves + curve shape change
   (use bps numbers exactly from the data)
2. "policy_pricing": one sentence on what the market is pricing for Fed cuts/hikes
   and how that changed vs last week. Infer from SOFR and front-end moves.
3. "real_vs_nominal": one sentence decomposing whether the 10Y move was real rates
   or inflation expectations (use the real_vs_nominal_split field — e.g.
   "X% of the move was real rates, Y% was breakevens")
4. "so_what": the single most important implication for someone with duration exposure

Return as JSON with keys: summary, policy_pricing, real_vs_nominal, so_what
"""
    raw = _call(prompt)
    try:
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {"summary": raw, "policy_pricing": "", "real_vs_nominal": "", "so_what": ""}


def interpret_fx(fx: dict, rates: dict) -> dict:
    # Pass rate differentials as context (2Y levels as a carry proxy)
    ust_2y = rates["levels"].get("UST_2Y", "n/a")

    prompt = f"""
Write the FX section of this week's market dashboard.

Metrics:
{_fmt_metrics({**fx, "USD_2Y_yield_pct": ust_2y})}

For context: factor_labels tells you what macro factor should be driving each pair.
carry_winners are pairs that moved in the direction consistent with USD carry.

Write three things:
1. "grid": for each of the 6 pairs, write ONE sentence tying the move to a driver.
   Format as a list of objects: [{{"pair": "EURUSD", "move_pct": X, "driver": "..."}}]
2. "cross_section_theme": one sentence on whether a factor is dominating
   (e.g. "carry outperforming despite risk-off" = late-cycle signal)
3. "misalignment": identify the ONE pair whose move most contradicts its factor label
   this week, and say why that's interesting. If none, say "No notable misalignments."
4. "so_what": one sentence implication for anyone with FX or international exposure

Return as JSON with keys: grid, cross_section_theme, misalignment, so_what
"""
    raw = _call(prompt)
    try:
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {"grid": [], "cross_section_theme": raw, "misalignment": "", "so_what": ""}


# ---------------------------------------------------------------------------
# Prediction Markets
# ---------------------------------------------------------------------------

def interpret_prediction_markets(pm: dict, eq: dict, rates: dict) -> dict:
    spx_chg = eq["week_chg_pct"].get("SPY", "n/a")
    curve    = rates.get("curve_2s10s", "n/a")
    fed_cuts = rates.get("sofr_latest", "n/a")

    prompt = f"""
Write the PREDICTION MARKETS section of this week's market dashboard.

This section covers Polymarket — a liquid prediction market where real money trades
on macro/political outcomes. Think of it as the "market's probability distribution"
over discrete events, which often diverges from what financial markets are pricing.

Metrics:
{_fmt_metrics({
    "top_markets_by_24h_volume": pm.get("top_markets", [])[:8],
    "biggest_movers_wow":        pm.get("biggest_movers", []),
    "fed_specific_markets":      pm.get("fed_markets", []),
    "total_prediction_mkt_volume_24h": pm.get("total_volume_24h"),
    "SPY_week_chg_pct":          spx_chg,
    "rates_curve_2s10s_bp":      curve,
})}

Notes on field values:
- yes_price is a 0-1 probability (e.g. 0.72 = 72% chance of YES)
- wow_chg is the week-over-week change in yes probability (e.g. -0.08 = fell 8pp)

Write four things:
1. "summary": one sentence on the overall prediction market activity this week
   — what's getting traded, where the money is flowing
2. "fed_read": one sentence specifically on what prediction markets imply about
   Fed policy over the next 6-12 months, and whether that aligns or conflicts
   with what rates markets are pricing
3. "divergence": identify the single most interesting divergence between
   prediction market probability and conventional financial market narrative.
   (e.g. prediction markets say 65% recession but equities only down 2%)
4. "so_what": one sentence for someone with macro exposure

Return as JSON with keys: summary, fed_read, divergence, so_what
"""
    raw = _call(prompt)
    try:
        cleaned = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(cleaned)
    except json.JSONDecodeError:
        return {"summary": raw, "fed_read": "", "divergence": "", "so_what": ""}


# ---------------------------------------------------------------------------
# Master runner
# ---------------------------------------------------------------------------

def interpret_all(metrics: dict) -> dict:
    """
    Takes the output of calculate.calculate_all() and returns
    a dict of human-readable commentary per section.
    """
    eq   = metrics["equities"]
    rt   = metrics["rates"]
    fx   = metrics["fx"]
    pos  = metrics["positioning"]

    pm = metrics.get("prediction_markets", {})

    return {
        "equities":           interpret_equities(eq, pos),
        "rates":              interpret_rates(rt),
        "fx":                 interpret_fx(fx, rt),
        "prediction_markets": interpret_prediction_markets(pm, eq, rt),
        "as_of_date":         metrics["as_of_date"],
    }
