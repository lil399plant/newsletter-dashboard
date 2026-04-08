export const dynamic = "force-dynamic";

import { Redis } from "@upstash/redis";

const SECTORS = [
  { label: "S&P 500",          ticker: "SPY"  },
  { label: "Technology",       ticker: "XLK"  },
  { label: "Financials",       ticker: "XLF"  },
  { label: "Health Care",      ticker: "XLV"  },
  { label: "Consumer Disc.",   ticker: "XLY"  },
  { label: "Industrials",      ticker: "XLI"  },
  { label: "Comm. Services",   ticker: "XLC"  },
  { label: "Consumer Staples", ticker: "XLP"  },
  { label: "Energy",           ticker: "XLE"  },
  { label: "Real Estate",      ticker: "XLRE" },
  { label: "Materials",        ticker: "XLB"  },
  { label: "Utilities",        ticker: "XLU"  },
];

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SECTORS_CACHE_KEY = "sectors:latest";
const SECTORS_TTL = 60 * 60;

function getRedis() {
  return new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
}

// ─── Returns via exact same Yahoo URL format as /api/equity/history ───────────
// Uses period1/period2 unix timestamps — the format that works on Vercel.

async function fetchReturns(ticker: string): Promise<{ ret4w: number | null; ret52w: number | null }> {
  const now = Math.floor(Date.now() / 1000);
  const oneYearAgo = now - 365 * 86400;
  // Add 40-day prefetch buffer (same as equity/history route)
  const period1 = oneYearAgo - 40 * 86400;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${now}&includePrePost=false`;

  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 0 } });
    if (!res.ok) {
      console.error(`[sectors] chart ${ticker} HTTP ${res.status}`);
      return { ret4w: null, ret52w: null };
    }
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      console.error(`[sectors] chart ${ticker} no result`);
      return { ret4w: null, ret52w: null };
    }
    const closes: (number | null)[] =
      result.indicators?.adjclose?.[0]?.adjclose ??
      result.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c != null && c > 0);
    if (valid.length < 2) return { ret4w: null, ret52w: null };

    const last = valid[valid.length - 1];
    // 52W: first vs last in the 1Y window
    const ret52w = (last / valid[0] - 1) * 100;
    // 4W: last 20 trading days
    const ret4w = (last / valid[Math.max(0, valid.length - 20)] - 1) * 100;
    return { ret4w, ret52w };
  } catch (e) {
    console.error(`[sectors] chart ${ticker}:`, e);
    return { ret4w: null, ret52w: null };
  }
}

// ─── 10yr yield from FRED ─────────────────────────────────────────────────────

async function fetch10YrYield(): Promise<number | null> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;
  try {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() - 7);
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&observation_start=${start.toISOString().slice(0, 10)}&api_key=${apiKey}&file_type=json&sort_order=asc`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return null;
    const data = await res.json();
    const obs = (data.observations ?? []).filter((o: any) => o.value !== ".");
    return obs.length ? parseFloat(obs[obs.length - 1].value) : null;
  } catch { return null; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function fetchFreshData() {
  const tenYrYield = await fetch10YrYield();
  const rows = [];
  let successCount = 0;

  for (const { label, ticker } of SECTORS) {
    const { ret4w, ret52w } = await fetchReturns(ticker);
    if (ret4w !== null || ret52w !== null) successCount++;

    rows.push({
      label, ticker,
      trailingPE: null,   // Yahoo quoteSummary blocked from Vercel — future fix
      forwardPE: null,
      impliedEpsGrowth: null,
      profitMargin: null,
      ret52w, ret4w,
      erp: null,
    });

    await sleep(600);
  }

  console.log(`[sectors] fetchFreshData: ${successCount}/${SECTORS.length} tickers got returns`);
  return { rows, tenYrYield, cachedAt: new Date().toISOString(), successCount };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const redis = getRedis();
  const { searchParams } = new URL(request.url);
  const bust = searchParams.get("bust") === "1";

  // Serve from Redis cache (skip if busting or cache empty)
  if (!bust) {
    try {
      const cached = await redis.get<any>(SECTORS_CACHE_KEY);
      // Only serve cache if it has actual data (not all-null failed fetch)
      if (cached?.successCount > 0) {
        return Response.json(cached);
      }
    } catch (e) {
      console.error("[sectors] Redis read:", e);
    }
  }

  const data = await fetchFreshData();

  // Only cache if we got at least some real data
  if (data.successCount > 0) {
    try {
      await redis.set(SECTORS_CACHE_KEY, data, { ex: SECTORS_TTL });
      console.log(`[sectors] Cached with ${data.successCount} successful rows`);
    } catch (e) {
      console.error("[sectors] Redis write:", e);
    }
  } else {
    console.error("[sectors] Not caching — all rows null");
  }

  return Response.json(data);
}
