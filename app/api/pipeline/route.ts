/**
 * app/api/pipeline/route.ts
 *
 * Weekly market dashboard pipeline — runs entirely in Next.js serverless.
 * No Python needed: everything is fetch() + math.
 *
 * Triggered by Vercel Cron (Friday 18:00 UTC) or manually via GET.
 * Stores result in Upstash Redis under "dashboard:latest".
 */

import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────

const EQUITY_TICKERS: Record<string, string> = {
  SPY: "SPY", RSP: "RSP", QQQ: "QQQ", IWM: "IWM", VIX: "^VIX",
  XLK: "XLK", XLF: "XLF", XLE: "XLE", XLV: "XLV", XLI: "XLI",
  XLY: "XLY", XLP: "XLP", XLU: "XLU", XLB: "XLB", XLRE: "XLRE", XLC: "XLC",
};

const FX_TICKERS: Record<string, string> = {
  EURUSD: "EURUSD=X", USDJPY: "JPY=X", GBPUSD: "GBPUSD=X",
  AUDUSD: "AUDUSD=X", USDCAD: "CAD=X", USDCHF: "CHF=X",
};

const FX_FACTOR_LABELS: Record<string, string> = {
  EURUSD: "growth_proxy", USDJPY: "safe_haven", GBPUSD: "growth_proxy",
  AUDUSD: "growth_proxy", USDCAD: "tot_play",   USDCHF: "safe_haven",
};

const CARRY_DIRECTION: Record<string, number> = {
  EURUSD: -1, USDJPY: 1, GBPUSD: -1, AUDUSD: -1, USDCAD: 1, USDCHF: 1,
};

const FRED_SERIES: Record<string, string> = {
  UST_2Y: "DGS2", UST_5Y: "DGS5", UST_10Y: "DGS10", UST_30Y: "DGS30",
  TIPS_10Y: "DFII10", BEI_10Y: "T10YIE", SOFR: "SOFR",
};

const POLYMARKET_TAGS: Record<string, string> = {
  economy: "100328", fed_decisions: "100196", politics: "100389",
};

const SECTORS = ["XLK","XLF","XLE","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC"];

// ─────────────────────────────────────────────────────────────
// MATH HELPERS
// ─────────────────────────────────────────────────────────────

function stdDev(arr: number[]): number {
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
}

function realizedVol21d(closes: number[]): number {
  const slice = closes.slice(-22);
  if (slice.length < 5) return NaN;
  const rets: number[] = [];
  for (let i = 1; i < slice.length; i++) rets.push(Math.log(slice[i] / slice[i - 1]));
  return Math.round(stdDev(rets) * Math.sqrt(252) * 100 * 10) / 10;
}

function wowPct(closes: number[]): number {
  if (closes.length < 6) return NaN;
  const curr = closes[closes.length - 1];
  const prev = closes[closes.length - 6];
  return Math.round(((curr / prev) - 1) * 100 * 100) / 100;
}

function last(arr: number[]): number {
  return arr.filter(x => x != null && !isNaN(x)).at(-1) ?? NaN;
}

function prevWeek(arr: number[]): number {
  const f = arr.filter(x => x != null && !isNaN(x));
  return f[Math.max(0, f.length - 6)] ?? NaN;
}

// ─────────────────────────────────────────────────────────────
// DATA COLLECTION
// ─────────────────────────────────────────────────────────────

interface Prices { closes: number[] }

async function fetchYahoo(ticker: string): Promise<Prices> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=3mo`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return { closes: [] };
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { closes: [] };
    const raw: (number | null)[] =
      result.indicators?.adjclose?.[0]?.adjclose ??
      result.indicators?.quote?.[0]?.close ?? [];
    return { closes: raw.filter((x): x is number => x != null && !isNaN(x)) };
  } catch {
    return { closes: [] };
  }
}

async function collectEquities(): Promise<Record<string, Prices>> {
  const result: Record<string, Prices> = {};
  const entries = Object.entries(EQUITY_TICKERS);
  for (let i = 0; i < entries.length; i += 5) {
    const batch = entries.slice(i, i + 5);
    const fetched = await Promise.all(
      batch.map(([label, ticker]) => fetchYahoo(ticker).then(p => ({ label, p })))
    );
    fetched.forEach(({ label, p }) => { result[label] = p; });
    if (i + 5 < entries.length) await new Promise(r => setTimeout(r, 300));
  }
  return result;
}

async function collectRates(): Promise<Record<string, { date: string; value: number }[]>> {
  const start = new Date(Date.now() - 56 * 86400000).toISOString().split("T")[0];
  const key = process.env.FRED_API_KEY ?? "";
  const result: Record<string, { date: string; value: number }[]> = {};
  await Promise.all(
    Object.entries(FRED_SERIES).map(async ([label, id]) => {
      try {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&observation_start=${start}&api_key=${key}&file_type=json&sort_order=asc`;
        const res = await fetch(url);
        if (!res.ok) { result[label] = []; return; }
        const data = await res.json();
        result[label] = (data.observations ?? [])
          .filter((o: { value: string }) => o.value !== ".")
          .map((o: { date: string; value: string }) => ({ date: o.date, value: parseFloat(o.value) }));
      } catch { result[label] = []; }
    })
  );
  return result;
}

async function collectFX(): Promise<Record<string, Prices>> {
  const result: Record<string, Prices> = {};
  await Promise.all(
    Object.entries(FX_TICKERS).map(async ([label, ticker]) => {
      result[label] = await fetchYahoo(ticker);
    })
  );
  return result;
}

interface PolyMarket {
  question: string; slug: string; tag: string;
  yes_price: number | null; wow_chg: number | null; day_chg: number | null;
  volume: number | null; volume_24h: number | null; end_date: string | null;
}

async function collectPolymarket(): Promise<PolyMarket[]> {
  const all: PolyMarket[] = [];
  await Promise.all(
    Object.entries(POLYMARKET_TAGS).map(async ([tag, tagId]) => {
      try {
        const url = `https://gamma-api.polymarket.com/events?active=true&limit=6&order=volume&ascending=false&volume_num_min=10000&tag_id=${tagId}`;
        const events: any[] = await (await fetch(url)).json();
        for (const ev of events) {
          for (const m of ev.markets ?? []) {
            try {
              const outcomes = JSON.parse(m.outcomes ?? "[]");
              const prices   = JSON.parse(m.outcomePrices ?? "[]");
              const yi = outcomes.findIndex((o: string) => o.toLowerCase() === "yes");
              all.push({
                question: m.question ?? "", slug: m.slug ?? "", tag,
                yes_price: prices[yi >= 0 ? yi : 0] ? parseFloat(prices[yi >= 0 ? yi : 0]) : null,
                wow_chg: m.oneWeekPriceChange ?? null,
                day_chg: m.oneDayPriceChange ?? null,
                volume: m.volumeNum ?? null, volume_24h: m.volume24hr ?? null,
                end_date: m.endDate ?? null,
              });
            } catch { /* skip */ }
          }
        }
      } catch { /* skip tag */ }
    })
  );
  const seen = new Set<string>();
  return all
    .filter(m => { if (seen.has(m.slug)) return false; seen.add(m.slug); return true; })
    .sort((a, b) => (b.volume_24h ?? 0) - (a.volume_24h ?? 0))
    .slice(0, 15);
}

// ─────────────────────────────────────────────────────────────
// CALCULATIONS
// ─────────────────────────────────────────────────────────────

function calcEquities(raw: Record<string, Prices>) {
  const levels: Record<string, number> = {};
  const weekChg: Record<string, number> = {};
  for (const k of ["SPY","RSP","QQQ","IWM","VIX"]) {
    const c = raw[k]?.closes ?? [];
    levels[k] = last(c);
    weekChg[k] = wowPct(c);
  }

  const spyC = raw.SPY?.closes ?? [];
  const rspC = raw.RSP?.closes ?? [];
  const rv = realizedVol21d(spyC);
  const vixRvSpread = Math.round((levels.VIX - rv) * 10) / 10;

  const ewRatio  = (levels.RSP && levels.SPY) ? levels.RSP / levels.SPY : NaN;
  const ewPrev   = (prevWeek(rspC) && prevWeek(spyC)) ? prevWeek(rspC) / prevWeek(spyC) : NaN;
  const ewChg    = Math.round((ewRatio - ewPrev) * 100 * 1000) / 1000;

  const sectorRets: Record<string, number> = {};
  for (const s of SECTORS) sectorRets[s] = wowPct(raw[s]?.closes ?? []);
  const valid = Object.entries(sectorRets).filter(([, v]) => !isNaN(v));
  const topSector = valid.length ? valid.reduce((a, b) => a[1] > b[1] ? a : b)[0] : null;
  const botSector = valid.length ? valid.reduce((a, b) => a[1] < b[1] ? a : b)[0] : null;

  return {
    levels, week_chg_pct: weekChg,
    realized_vol_21d: rv, vix_rv_spread: vixRvSpread,
    equal_weight_ratio: Math.round(ewRatio * 10000) / 10000,
    ew_ratio_chg_wow: ewChg,
    sector_returns_wow: sectorRets, top_sector: topSector, bot_sector: botSector,
  };
}

function calcRates(raw: Record<string, { date: string; value: number }[]>) {
  const getLatest = (k: string) => raw[k]?.at(-1)?.value ?? NaN;
  const getPrev   = (k: string) => raw[k]?.[Math.max(0, (raw[k]?.length ?? 0) - 6)]?.value ?? NaN;

  const nominals = ["UST_2Y","UST_5Y","UST_10Y","UST_30Y"];
  const levels: Record<string, number> = {};
  const chgBp: Record<string, number> = {};
  for (const k of nominals) {
    levels[k] = getLatest(k);
    chgBp[k]  = Math.round((getLatest(k) - getPrev(k)) * 100 * 10) / 10;
  }

  const curve2s10s     = Math.round((levels.UST_10Y - levels.UST_2Y) * 100 * 10) / 10;
  const curve2s10sPrev = Math.round((getPrev("UST_10Y") - getPrev("UST_2Y")) * 100 * 10) / 10;

  const real10y = getLatest("TIPS_10Y");
  const bei10y  = getLatest("BEI_10Y");
  const realMv  = (real10y - getPrev("TIPS_10Y")) * 100;
  const beiMv   = (bei10y  - getPrev("BEI_10Y"))  * 100;
  const total   = Math.abs(realMv) + Math.abs(beiMv);
  const realSplit = total > 0 ? Math.round(Math.abs(realMv) / total * 100) : NaN;

  return {
    levels, week_chg_bp: chgBp,
    curve_2s10s: curve2s10s,
    curve_5s30s: Math.round((levels.UST_30Y - levels.UST_5Y) * 100 * 10) / 10,
    curve_chg_wow_bp: Math.round((curve2s10s - curve2s10sPrev) * 10) / 10,
    real_10y:  Math.round(real10y * 100) / 100,
    breakeven_10y: Math.round(bei10y * 100) / 100,
    real_vs_nominal_split: realSplit,
    sofr_latest: Math.round(getLatest("SOFR") * 100) / 100,
  };
}

function calcFX(raw: Record<string, Prices>) {
  const levels: Record<string, number> = {};
  const weekChg: Record<string, number> = {};
  for (const [pair, { closes }] of Object.entries(raw)) {
    levels[pair]   = last(closes);
    weekChg[pair]  = wowPct(closes);
  }
  const carryWinners = Object.entries(CARRY_DIRECTION)
    .filter(([p, d]) => !isNaN(weekChg[p]) && ((d > 0 && weekChg[p] > 0) || (d < 0 && weekChg[p] < 0)))
    .map(([p]) => p);

  return { levels, week_chg_pct: weekChg, factor_labels: FX_FACTOR_LABELS, carry_winners: carryWinners };
}

function calcPolymarket(markets: PolyMarket[]) {
  const fedKw = ["fed","rate","fomc","cut","hike","powell","basis point"];
  const fedMarkets = markets.filter(m => fedKw.some(kw => m.question.toLowerCase().includes(kw))).slice(0, 6);
  const movers = [...markets]
    .filter(m => m.wow_chg != null)
    .sort((a, b) => Math.abs(b.wow_chg!) - Math.abs(a.wow_chg!))
    .slice(0, 3);

  return {
    top_markets: markets.slice(0, 12), biggest_movers: movers, fed_markets: fedMarkets,
    total_volume_24h: Math.round(markets.reduce((s, m) => s + (m.volume_24h ?? 0), 0)),
  };
}

// ─────────────────────────────────────────────────────────────
// GEMINI COMMENTARY
// ─────────────────────────────────────────────────────────────

const SYSTEM = `You write the markets section of a professional financial newsletter.
Voice: tight, trader-note style. No fluff. One strong sentence beats three weak ones.
Frame everything as "what changed in the distribution of outcomes."
Format: 2-3 sentences max per item. Numbers must match the metrics exactly.
Never use "it's worth noting" or "as we can see."`;

async function gemini(prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${SYSTEM}\n\n${prompt}` }] }],
      generationConfig: { maxOutputTokens: 2000, temperature: 0.3 },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body}`);
  }
  const d = await res.json();
  return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
}

function parseJson(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()); }
  catch { return { summary: raw }; }
}

async function generateCommentary(metrics: Record<string, unknown>) {
  const eq = metrics.equities as any;
  const rt = metrics.rates    as any;
  const fx = metrics.fx       as any;
  const pm = metrics.prediction_markets as any;

  const raw = await gemini(`You are writing the markets section of a professional financial newsletter.
Generate commentary for ALL four sections in ONE response. Return a single JSON object with keys: equities, rates, fx, prediction_markets.

EQUITIES metrics: ${JSON.stringify({ SPY_wow: eq.week_chg_pct?.SPY, VIX: eq.levels?.VIX, rvol: eq.realized_vol_21d, vix_rv_spread: eq.vix_rv_spread, ew_chg: eq.ew_ratio_chg_wow, top: eq.top_sector, top_ret: eq.sector_returns_wow?.[eq.top_sector], bot: eq.bot_sector, bot_ret: eq.sector_returns_wow?.[eq.bot_sector] })}
RATES metrics: ${JSON.stringify({ levels: rt.levels, chg_bp: rt.week_chg_bp, curve_2s10s: rt.curve_2s10s, curve_chg: rt.curve_chg_wow_bp, real_10y: rt.real_10y, bei_10y: rt.breakeven_10y, real_split_pct: rt.real_vs_nominal_split })}
FX metrics: ${JSON.stringify({ week_chg_pct: fx.week_chg_pct, factor_labels: fx.factor_labels, carry_winners: fx.carry_winners })}
PREDICTION MARKETS metrics (yes_price = probability 0-1, wow_chg = week-over-week change): ${JSON.stringify({ top: pm.top_markets?.slice(0, 6), movers: pm.biggest_movers, fed: pm.fed_markets })}

Return exactly this JSON shape:
{
  "equities": { "summary": "", "tape_vs_story": "Narrative: ...\\nTape: ...\\nRead: ...", "so_what": "", "actionable": "" },
  "rates": { "summary": "", "policy_pricing": "", "real_vs_nominal": "", "so_what": "" },
  "fx": { "grid": [{"pair": "", "move_pct": 0, "driver": ""}], "cross_section_theme": "", "misalignment": "", "so_what": "" },
  "prediction_markets": { "summary": "", "fed_read": "", "divergence": "", "so_what": "" }
}`);

  const parsed = parseJson(raw) as any;
  return {
    equities:           parsed.equities           ?? { summary: raw },
    rates:              parsed.rates              ?? {},
    fx:                 parsed.fx                 ?? {},
    prediction_markets: parsed.prediction_markets ?? {},
  };
}

// ─────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const [equitiesRaw, ratesRaw, fxRaw, pmRaw] = await Promise.all([
      collectEquities(),
      collectRates(),
      collectFX(),
      collectPolymarket(),
    ]);

    const metrics = {
      equities:           calcEquities(equitiesRaw),
      rates:              calcRates(ratesRaw),
      fx:                 calcFX(fxRaw),
      prediction_markets: calcPolymarket(pmRaw),
      as_of_date:         new Date().toISOString(),
    };

    const commentary = await generateCommentary(metrics);
    const dashboard  = { metrics, commentary, as_of_date: metrics.as_of_date };

    const redis = new Redis({
      url:   process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
    });
    await redis.set("dashboard:latest", JSON.stringify(dashboard));
    await redis.lpush("dashboard:history", JSON.stringify(dashboard));
    await redis.ltrim("dashboard:history", 0, 11);

    return NextResponse.json({ status: "ok", as_of_date: dashboard.as_of_date });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Pipeline error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
