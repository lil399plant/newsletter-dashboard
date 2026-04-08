export const dynamic = "force-dynamic";

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

// ─── Yahoo crumb (module-level cache) ─────────────────────────────────────────

let crumbCache: { crumb: string; cookie: string; expiresAt: number } | null = null;

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  const now = Date.now();
  if (crumbCache && crumbCache.expiresAt > now) return crumbCache;

  try {
    const homeRes = await fetch("https://finance.yahoo.com/", {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      redirect: "follow",
    });

    // Node 18+: getSetCookie(); older: parse set-cookie header manually
    let cookieParts: string[] = [];
    if (typeof (homeRes.headers as any).getSetCookie === "function") {
      cookieParts = (homeRes.headers as any).getSetCookie().map((c: string) => c.split(";")[0]);
    } else {
      const raw = homeRes.headers.get("set-cookie") ?? "";
      cookieParts = raw.split(",").map((c) => c.trim().split(";")[0]).filter(Boolean);
    }
    const cookieHeader = cookieParts.join("; ");
    if (!cookieHeader) {
      console.error("[sectors] No cookie from Yahoo homepage");
      return null;
    }

    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, "Cookie": cookieHeader },
    });
    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes("{") || crumb.length > 30) {
      console.error("[sectors] Bad crumb:", crumb?.slice(0, 100));
      return null;
    }

    console.log("[sectors] Got crumb:", crumb);
    crumbCache = { crumb, cookie: cookieHeader, expiresAt: now + 55 * 60_000 };
    return crumbCache;
  } catch (e) {
    console.error("[sectors] Crumb fetch error:", e);
    return null;
  }
}

// ─── Yahoo quoteSummary ───────────────────────────────────────────────────────

async function fetchQuoteSummary(ticker: string, crumb: string, cookie: string) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail,defaultKeyStatistics,financialData&crumb=${encodeURIComponent(crumb)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Cookie": cookie },
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      console.error(`[sectors] quoteSummary ${ticker} HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) console.error(`[sectors] quoteSummary ${ticker} no result:`, JSON.stringify(data).slice(0, 200));
    return result ?? null;
  } catch (e) {
    console.error(`[sectors] quoteSummary ${ticker} error:`, e);
    return null;
  }
}

// ─── Yahoo chart: 4-week return ───────────────────────────────────────────────

async function fetch4WeekReturn(ticker: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1mo`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 0 } });
    if (!res.ok) {
      console.error(`[sectors] chart ${ticker} HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const closes: (number | null)[] =
      data?.chart?.result?.[0]?.indicators?.adjclose?.[0]?.adjclose ??
      data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c != null && c > 0);
    if (valid.length < 2) {
      console.error(`[sectors] chart ${ticker} insufficient closes: ${valid.length}`);
      return null;
    }
    return (valid[valid.length - 1] / valid[0] - 1) * 100;
  } catch (e) {
    console.error(`[sectors] chart ${ticker} error:`, e);
    return null;
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
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d`,
      { headers: { "User-Agent": UA }, next: { revalidate: 0 } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const closes: (number | null)[] =
      data?.chart?.result?.[0]?.indicators?.adjclose?.[0]?.adjclose ??
      data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c != null && c > 0);
    return valid.length ? valid[valid.length - 1] / 10 : null;
  } catch {
    return null;
  }
}

// ─── Sequential batch helper (avoid hammering Yahoo with 25 concurrent reqs) ──

async function fetchInBatches<T>(
  items: string[],
  fn: (ticker: string) => Promise<T>,
  batchSize = 4,
  delayMs = 300
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < items.length) await new Promise((r) => setTimeout(r, delayMs));
  }
  return results;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET() {
  const [auth, tenYrYield] = await Promise.all([
    getYahooCrumb(),
    fetch10YrYield(),
  ]);

  const tickers = SECTORS.map((s) => s.ticker);

  // Fetch in small batches to avoid Yahoo rate-limiting
  const [summaries, ret4ws] = await Promise.all([
    fetchInBatches(tickers, (t) => auth ? fetchQuoteSummary(t, auth.crumb, auth.cookie) : Promise.resolve(null), 4, 300),
    fetchInBatches(tickers, fetch4WeekReturn, 4, 300),
  ]);

  const rows = SECTORS.map(({ label, ticker }, i) => {
    const summary = summaries[i];
    const ret4w = ret4ws[i];

    const trailingPE: number | null =
      summary?.summaryDetail?.trailingPE?.raw ??
      summary?.defaultKeyStatistics?.trailingPE?.raw ?? null;

    const forwardPE: number | null =
      summary?.summaryDetail?.forwardPE?.raw ??
      summary?.defaultKeyStatistics?.forwardPE?.raw ?? null;

    const profitMargin: number | null =
      summary?.financialData?.profitMargins?.raw ?? null;

    const ret52w: number | null =
      summary?.defaultKeyStatistics?.["52WeekChange"]?.raw != null
        ? summary.defaultKeyStatistics["52WeekChange"].raw * 100
        : null;

    const impliedEpsGrowth: number | null =
      trailingPE != null && forwardPE != null && forwardPE > 0
        ? (trailingPE / forwardPE - 1) * 100
        : null;

    const erp =
      forwardPE != null && tenYrYield != null
        ? parseFloat(((1 / forwardPE) * 100 - tenYrYield).toFixed(2))
        : null;

    return { label, ticker, trailingPE, forwardPE, impliedEpsGrowth, profitMargin, ret52w, ret4w, erp };
  });

  return Response.json({ rows, tenYrYield });
}
