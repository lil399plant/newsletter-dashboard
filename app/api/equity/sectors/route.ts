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

// ─── Yahoo crumb cache (module-level, survives across requests in same worker) ─

let crumbCache: { crumb: string; cookie: string; expiresAt: number } | null = null;

async function getYahooCrumb(): Promise<{ crumb: string; cookie: string } | null> {
  const now = Date.now();
  if (crumbCache && crumbCache.expiresAt > now) {
    return { crumb: crumbCache.crumb, cookie: crumbCache.cookie };
  }

  try {
    // Step 1: visit finance.yahoo.com to get a session cookie
    const homeRes = await fetch("https://finance.yahoo.com/", {
      headers: { "User-Agent": UA, "Accept": "text/html" },
      redirect: "follow",
    });

    // Extract all Set-Cookie headers and join into a single cookie string
    const rawCookies = homeRes.headers.getSetCookie?.() ?? [];
    // getSetCookie may not exist on older Node — fall back to get()
    const cookieHeader = rawCookies.length
      ? rawCookies.map((c) => c.split(";")[0]).join("; ")
      : (homeRes.headers.get("set-cookie") ?? "").split(",").map((c) => c.trim().split(";")[0]).join("; ");

    if (!cookieHeader) return null;

    // Step 2: fetch crumb using that cookie
    const crumbRes = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: { "User-Agent": UA, "Cookie": cookieHeader },
    });
    const crumb = await crumbRes.text();
    if (!crumb || crumb.includes("{") || crumb.length > 20) return null;

    // Cache for 55 minutes
    crumbCache = { crumb, cookie: cookieHeader, expiresAt: now + 55 * 60_000 };
    return { crumb, cookie: cookieHeader };
  } catch {
    return null;
  }
}

// ─── Yahoo Finance quoteSummary ───────────────────────────────────────────────

async function fetchQuoteSummary(ticker: string, crumb: string, cookie: string) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail,defaultKeyStatistics,financialData&crumb=${encodeURIComponent(crumb)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Cookie": cookie },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.quoteSummary?.result?.[0] ?? null;
}

// ─── Yahoo Finance chart: 4-week return ──────────────────────────────────────

async function fetch4WeekReturn(ticker: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1mo`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 0 } });
    if (!res.ok) return null;
    const data = await res.json();
    const closes: (number | null)[] =
      data?.chart?.result?.[0]?.indicators?.adjclose?.[0]?.adjclose ??
      data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c != null && c > 0);
    return valid.length >= 2 ? (valid[valid.length - 1] / valid[0] - 1) * 100 : null;
  } catch {
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
  // Fallback: ^TNX is quoted as e.g. 43.3 meaning 4.33%
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

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET() {
  const [auth, tenYrYield] = await Promise.all([
    getYahooCrumb(),
    fetch10YrYield(),
  ]);

  const sectorResults = await Promise.all(
    SECTORS.map(async ({ label, ticker }) => {
      const [summary, ret4w] = await Promise.all([
        auth ? fetchQuoteSummary(ticker, auth.crumb, auth.cookie) : Promise.resolve(null),
        fetch4WeekReturn(ticker),
      ]);

      const trailingPE: number | null =
        summary?.summaryDetail?.trailingPE?.raw ??
        summary?.defaultKeyStatistics?.trailingPE?.raw ?? null;

      const forwardPE: number | null =
        summary?.summaryDetail?.forwardPE?.raw ??
        summary?.defaultKeyStatistics?.forwardPE?.raw ?? null;

      const profitMargin: number | null =
        summary?.financialData?.profitMargins?.raw ?? null;

      // 52WeekChange is a decimal (0.36 = 36%)
      const ret52w: number | null =
        summary?.defaultKeyStatistics?.["52WeekChange"]?.raw != null
          ? summary.defaultKeyStatistics["52WeekChange"].raw * 100
          : null;

      const impliedEpsGrowth: number | null =
        trailingPE != null && forwardPE != null && forwardPE > 0
          ? (trailingPE / forwardPE - 1) * 100
          : null;

      return { label, ticker, trailingPE, forwardPE, impliedEpsGrowth, profitMargin, ret52w, ret4w };
    })
  );

  const rows = sectorResults.map((r) => ({
    ...r,
    erp:
      r.forwardPE != null && tenYrYield != null
        ? parseFloat(((1 / r.forwardPE) * 100 - tenYrYield).toFixed(2))
        : null,
  }));

  return Response.json({ rows, tenYrYield });
}
