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
const SECTORS_TTL = 60 * 60; // 1 hour
const CRUMB_KEY = "yahoo:crumb";
const CRUMB_TTL = 55 * 60;

function getRedis() {
  return new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
}

// ─── Yahoo crumb ──────────────────────────────────────────────────────────────

async function getYahooCrumb(redis: Redis): Promise<{ crumb: string; cookie: string } | null> {
  try {
    const cached = await redis.get<{ crumb: string; cookie: string }>(CRUMB_KEY);
    if (cached?.crumb && cached?.cookie) return cached;
  } catch {}

  try {
    const homeRes = await fetch("https://finance.yahoo.com/", {
      headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow",
    });
    let cookieParts: string[] = [];
    if (typeof (homeRes.headers as any).getSetCookie === "function") {
      cookieParts = (homeRes.headers as any).getSetCookie().map((c: string) => c.split(";")[0]);
    } else {
      cookieParts = (homeRes.headers.get("set-cookie") ?? "").split(",").map((c) => c.trim().split(";")[0]).filter(Boolean);
    }
    const cookie = cookieParts.join("; ");
    if (!cookie) return null;

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, "Cookie": cookie },
    });
    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes("{") || crumb.includes(" ") || crumb.includes("<") || crumb.length > 30) {
      console.error("[sectors] Bad crumb:", crumb?.slice(0, 80));
      return null;
    }
    const payload = { crumb, cookie };
    try { await redis.set(CRUMB_KEY, payload, { ex: CRUMB_TTL }); } catch {}
    return payload;
  } catch (e) {
    console.error("[sectors] Crumb error:", e);
    return null;
  }
}

// ─── Yahoo quoteSummary ───────────────────────────────────────────────────────

async function fetchQuoteSummary(ticker: string, crumb: string, cookie: string) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail,defaultKeyStatistics,financialData&crumb=${encodeURIComponent(crumb)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Cookie": cookie }, next: { revalidate: 0 } });
    if (!res.ok) { console.error(`[sectors] quoteSummary ${ticker} HTTP ${res.status}`); return null; }
    const data = await res.json();
    return data?.quoteSummary?.result?.[0] ?? null;
  } catch (e) {
    console.error(`[sectors] quoteSummary ${ticker}:`, e);
    return null;
  }
}

// ─── Returns via our own /api/equity/history proxy (avoids 429) ──────────────
// This route already works on Vercel — reuse it instead of hitting Yahoo directly.

async function fetchReturnsViaProxy(ticker: string, baseUrl: string): Promise<{ ret4w: number | null; ret52w: number | null }> {
  // Fetch 1 year of daily data via our own working proxy
  const oneYearAgo = new Date();
  oneYearAgo.setUTCFullYear(oneYearAgo.getUTCFullYear() - 1);
  const startDate = oneYearAgo.toISOString().slice(0, 10);

  try {
    const res = await fetch(
      `${baseUrl}/api/equity/history?ticker=${encodeURIComponent(ticker)}&startDate=${startDate}`,
      { next: { revalidate: 0 } }
    );
    if (!res.ok) { console.error(`[sectors] proxy history ${ticker} HTTP ${res.status}`); return { ret4w: null, ret52w: null }; }
    const data = await res.json();
    const rows: { date: string; close: number }[] = data.rows ?? [];
    if (rows.length < 2) return { ret4w: null, ret52w: null };

    const last = rows[rows.length - 1].close;
    const ret52w = (last / rows[0].close - 1) * 100;
    const start4w = rows[Math.max(0, rows.length - 20)].close;
    const ret4w = (last / start4w - 1) * 100;
    return { ret4w, ret52w };
  } catch (e) {
    console.error(`[sectors] proxy history ${ticker}:`, e);
    return { ret4w: null, ret52w: null };
  }
}

// ─── 10yr yield ───────────────────────────────────────────────────────────────

async function fetch10YrYield(): Promise<number | null> {
  const apiKey = process.env.FRED_API_KEY;
  if (apiKey) {
    try {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() - 7);
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&observation_start=${start.toISOString().slice(0, 10)}&api_key=${apiKey}&file_type=json&sort_order=asc`;
      const res = await fetch(url, { next: { revalidate: 0 } });
      if (res.ok) {
        const data = await res.json();
        const obs = (data.observations ?? []).filter((o: any) => o.value !== ".");
        if (obs.length) return parseFloat(obs[obs.length - 1].value);
      }
    } catch {}
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function fetchFreshData(redis: Redis, baseUrl: string) {
  const [auth, tenYrYield] = await Promise.all([
    getYahooCrumb(redis),
    fetch10YrYield(),
  ]);

  const rows = [];
  for (const { label, ticker } of SECTORS) {
    const [summary, { ret4w, ret52w }] = await Promise.all([
      auth ? fetchQuoteSummary(ticker, auth.crumb, auth.cookie) : Promise.resolve(null),
      fetchReturnsViaProxy(ticker, baseUrl),
    ]);

    const trailingPE: number | null =
      summary?.summaryDetail?.trailingPE?.raw ??
      summary?.defaultKeyStatistics?.trailingPE?.raw ?? null;
    const forwardPE: number | null =
      summary?.summaryDetail?.forwardPE?.raw ??
      summary?.defaultKeyStatistics?.forwardPE?.raw ?? null;
    const profitMargin: number | null =
      summary?.financialData?.profitMargins?.raw ?? null;
    const impliedEpsGrowth: number | null =
      trailingPE != null && forwardPE != null && forwardPE > 0
        ? (trailingPE / forwardPE - 1) * 100 : null;
    const erp =
      forwardPE != null && tenYrYield != null
        ? parseFloat(((1 / forwardPE) * 100 - tenYrYield).toFixed(2)) : null;

    rows.push({ label, ticker, trailingPE, forwardPE, impliedEpsGrowth, profitMargin, ret52w, ret4w, erp });
    await sleep(500);
  }

  const payload = { rows, tenYrYield, cachedAt: new Date().toISOString() };
  try { await redis.set(SECTORS_CACHE_KEY, payload, { ex: SECTORS_TTL }); } catch {}
  return payload;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const redis = getRedis();
  const { searchParams, origin } = new URL(request.url);
  const bust = searchParams.get("bust") === "1";

  if (!bust) {
    try {
      const cached = await redis.get<any>(SECTORS_CACHE_KEY);
      if (cached?.rows?.length) return Response.json(cached);
    } catch (e) {
      console.error("[sectors] Redis read:", e);
    }
  }

  const data = await fetchFreshData(redis, origin);
  return Response.json(data);
}
