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
const CRUMB_KEY = "yahoo:crumb";
const CRUMB_TTL = 55 * 60;

// ─── Yahoo crumb — shared across all Vercel instances via Redis ───────────────

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  let redis: Redis | null = null;
  try {
    redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
    const cached = await redis.get<{ crumb: string; cookie: string }>(CRUMB_KEY);
    if (cached?.crumb && cached?.cookie) return cached;
  } catch (e) {
    console.error("[sectors] Redis read error:", e);
  }

  try {
    const homeRes = await fetch("https://finance.yahoo.com/", {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      redirect: "follow",
    });

    let cookieParts: string[] = [];
    if (typeof (homeRes.headers as any).getSetCookie === "function") {
      cookieParts = (homeRes.headers as any).getSetCookie().map((c: string) => c.split(";")[0]);
    } else {
      const raw = homeRes.headers.get("set-cookie") ?? "";
      cookieParts = raw.split(",").map((c) => c.trim().split(";")[0]).filter(Boolean);
    }
    const cookie = cookieParts.join("; ");
    if (!cookie) { console.error("[sectors] No cookie from Yahoo"); return null; }

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, "Cookie": cookie },
    });
    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes("{") || crumb.includes(" ") || crumb.includes("<") || crumb.length > 30) {
      console.error("[sectors] Bad crumb:", crumb?.slice(0, 80));
      return null;
    }

    const payload = { crumb, cookie };
    try { await redis?.set(CRUMB_KEY, payload, { ex: CRUMB_TTL }); } catch {}
    return payload;
  } catch (e) {
    console.error("[sectors] Crumb error:", e);
    return null;
  }
}

// ─── Yahoo quoteSummary: P/E and margin ──────────────────────────────────────

async function fetchQuoteSummary(ticker: string, crumb: string, cookie: string) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail,defaultKeyStatistics,financialData&crumb=${encodeURIComponent(crumb)}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Cookie": cookie }, next: { revalidate: 0 } });
    if (!res.ok) { console.error(`[sectors] quoteSummary ${ticker} HTTP ${res.status}`); return null; }
    const data = await res.json();
    if (data?.quoteSummary?.error) console.error(`[sectors] quoteSummary ${ticker}:`, JSON.stringify(data.quoteSummary.error).slice(0, 100));
    return data?.quoteSummary?.result?.[0] ?? null;
  } catch (e) {
    console.error(`[sectors] quoteSummary ${ticker} threw:`, e);
    return null;
  }
}

// ─── Yahoo chart: single 1Y daily request → both 4W and 52W returns ──────────
// One request per ticker instead of two — halves Yahoo load from Vercel.

async function fetchReturns(ticker: string): Promise<{ ret4w: number | null; ret52w: number | null }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1y`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 0 } });
    if (!res.ok) {
      console.error(`[sectors] chart ${ticker} HTTP ${res.status}`);
      return { ret4w: null, ret52w: null };
    }
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      console.error(`[sectors] chart ${ticker} no result, error:`, JSON.stringify(data?.chart?.error).slice(0, 100));
      return { ret4w: null, ret52w: null };
    }
    const closes: (number | null)[] =
      result.indicators?.adjclose?.[0]?.adjclose ??
      result.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c != null && c > 0);

    if (valid.length < 2) {
      console.error(`[sectors] chart ${ticker} insufficient data: ${valid.length} closes`);
      return { ret4w: null, ret52w: null };
    }

    const last = valid[valid.length - 1];
    // 52W: first to last price in the 1Y window
    const ret52w = (last / valid[0] - 1) * 100;
    // 4W: approximately last 20 trading days
    const start4w = valid[Math.max(0, valid.length - 20)];
    const ret4w = (last / start4w - 1) * 100;

    return { ret4w, ret52w };
  } catch (e) {
    console.error(`[sectors] chart ${ticker} threw:`, e);
    return { ret4w: null, ret52w: null };
  }
}

// ─── 10yr yield: FRED primary, Yahoo fallback ─────────────────────────────────

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
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d`, {
      headers: { "User-Agent": UA }, next: { revalidate: 0 }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const closes: (number | null)[] =
      data?.chart?.result?.[0]?.indicators?.adjclose?.[0]?.adjclose ??
      data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c != null && c > 0);
    return valid.length ? valid[valid.length - 1] / 10 : null;
  } catch { return null; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET() {
  const [auth, tenYrYield] = await Promise.all([
    getYahooCrumb(),
    fetch10YrYield(),
  ]);

  // Fetch one ticker at a time with a gap — 12 sequential requests is still fast
  // (~15s total) and avoids Yahoo rate-limiting from Vercel's shared IPs.
  const results: Array<{ label: string; ticker: string; trailingPE: number | null; forwardPE: number | null; impliedEpsGrowth: number | null; profitMargin: number | null; ret52w: number | null; ret4w: number | null; erp: number | null }> = [];

  for (const { label, ticker } of SECTORS) {
    const [summary, { ret4w, ret52w }] = await Promise.all([
      auth ? fetchQuoteSummary(ticker, auth.crumb, auth.cookie) : Promise.resolve(null),
      fetchReturns(ticker),
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

    results.push({ label, ticker, trailingPE, forwardPE, impliedEpsGrowth, profitMargin, ret52w, ret4w, erp });
    await sleep(500);
  }

  return Response.json({ rows: results, tenYrYield });
}
