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

// ─── 10yr yield from FRED (primary) ──────────────────────────────────────────

async function fetch10YrYieldFRED(): Promise<number | null> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return null;
  // Fetch last 7 days of DGS10, take the most recent observation
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - 7);
  const startStr = start.toISOString().slice(0, 10);
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&observation_start=${startStr}&api_key=${apiKey}&file_type=json&sort_order=asc`;
  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return null;
    const data = await res.json();
    const obs = (data.observations ?? []).filter((o: any) => o.value !== ".");
    if (!obs.length) return null;
    // DGS10 is in percent (e.g. 4.33 means 4.33%)
    return parseFloat(obs[obs.length - 1].value);
  } catch {
    return null;
  }
}

// ─── Yahoo Finance fallback for 10yr yield ────────────────────────────────────

async function fetch10YrYieldYahoo(): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 0 } });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const closes: (number | null)[] =
      result.indicators?.adjclose?.[0]?.adjclose ??
      result.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c != null && c > 0);
    // ^TNX is quoted in tenths of a percent (e.g. 43.3 = 4.33%) — divide by 10
    return valid.length ? valid[valid.length - 1] / 10 : null;
  } catch {
    return null;
  }
}

async function fetch10YrYield(): Promise<number | null> {
  const fred = await fetch10YrYieldFRED();
  if (fred != null) return fred;
  return fetch10YrYieldYahoo();
}

// ─── FMP price change (1M = ~4W, 1Y = 52W) ───────────────────────────────────

async function fetchFMPPriceChange(ticker: string, apiKey: string): Promise<{ ret1m: number | null; ret1y: number | null }> {
  try {
    const url = `https://financialmodelingprep.com/stable/stock-price-change?symbol=${ticker}&apikey=${apiKey}`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return { ret1m: null, ret1y: null };
    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return { ret1m: null, ret1y: null };
    return {
      ret1m: row["1M"] != null ? row["1M"] : null,
      ret1y: row["1Y"] != null ? row["1Y"] : null,
    };
  } catch {
    return { ret1m: null, ret1y: null };
  }
}

// ─── Yahoo Finance fallbacks for returns ──────────────────────────────────────

async function fetchYahooReturns(ticker: string): Promise<{ ret4w: number | null; ret52w: number | null }> {
  try {
    // 4-week return from chart
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1mo`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 0 } });
    if (!res.ok) return { ret4w: null, ret52w: null };
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { ret4w: null, ret52w: null };
    const closes: (number | null)[] =
      result.indicators?.adjclose?.[0]?.adjclose ??
      result.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c != null && c > 0);
    const ret4w = valid.length >= 2 ? (valid[valid.length - 1] / valid[0] - 1) * 100 : null;
    return { ret4w, ret52w: null }; // 52W comes from quoteSummary
  } catch {
    return { ret4w: null, ret52w: null };
  }
}

// ─── Yahoo Finance quoteSummary for P/E and margins ──────────────────────────

async function fetchQuoteSummary(ticker: string) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=summaryDetail,defaultKeyStatistics,financialData`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.quoteSummary?.result?.[0] ?? null;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET() {
  const fmpKey = process.env.FMP_API_KEY ?? null;

  const [tenYrYield, ...sectorResults] = await Promise.all([
    fetch10YrYield(),
    ...SECTORS.map(async ({ label, ticker }) => {
      // Always fetch Yahoo quoteSummary for P/E and margin data
      const summaryPromise = fetchQuoteSummary(ticker);

      // Returns: prefer FMP if key available (only SPY works on free tier),
      // otherwise fall back to Yahoo for all
      const returnsPromise = fmpKey
        ? fetchFMPPriceChange(ticker, fmpKey).then(async (fmp) => {
            // FMP may return null for sector ETFs on free tier — fall back to Yahoo
            if (fmp.ret1m != null || fmp.ret1y != null) {
              return { ret4w: fmp.ret1m, ret52w: fmp.ret1y };
            }
            const y = await fetchYahooReturns(ticker);
            return y;
          })
        : fetchYahooReturns(ticker);

      const [summary, returns] = await Promise.all([summaryPromise, returnsPromise]);

      const trailingPE: number | null =
        summary?.summaryDetail?.trailingPE?.raw ??
        summary?.defaultKeyStatistics?.trailingPE?.raw ?? null;

      const forwardPE: number | null =
        summary?.summaryDetail?.forwardPE?.raw ??
        summary?.defaultKeyStatistics?.forwardPE?.raw ?? null;

      const profitMargin: number | null =
        summary?.financialData?.profitMargins?.raw ?? null;

      // 52W from Yahoo quoteSummary (always available), override with FMP if present
      const ret52wYahoo: number | null =
        summary?.defaultKeyStatistics?.["52WeekChange"]?.raw != null
          ? summary.defaultKeyStatistics["52WeekChange"].raw * 100
          : null;
      const ret52w = returns.ret52w ?? ret52wYahoo;
      const ret4w = returns.ret4w ?? null;

      const impliedEpsGrowth: number | null =
        trailingPE != null && forwardPE != null && forwardPE > 0
          ? (trailingPE / forwardPE - 1) * 100
          : null;

      return { label, ticker, trailingPE, forwardPE, impliedEpsGrowth, profitMargin, ret52w, ret4w };
    }),
  ]);

  const rows = sectorResults.map((r) => ({
    ...r,
    erp:
      r.forwardPE != null && tenYrYield != null
        ? parseFloat(((1 / r.forwardPE) * 100 - tenYrYield).toFixed(2))
        : null,
  }));

  return Response.json({ rows, tenYrYield });
}
