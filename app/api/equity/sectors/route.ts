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

// ─── 10yr yield from FRED (with Yahoo fallback) ───────────────────────────────

async function fetch10YrYield(): Promise<number | null> {
  // Primary: FRED DGS10 (already have the key, authoritative source)
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

  // Fallback: Yahoo Finance ^TNX (quoted as e.g. 43.3 = 4.33%, divide by 10)
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d`,
      { headers: { "User-Agent": "Mozilla/5.0" }, next: { revalidate: 0 } }
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

// ─── Yahoo Finance quoteSummary: P/E, margin, 52W return ─────────────────────

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

// ─── Yahoo Finance chart: 4-week return ──────────────────────────────────────

async function fetch4WeekReturn(ticker: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1mo`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 0 },
    });
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

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET() {
  const [tenYrYield, ...sectorResults] = await Promise.all([
    fetch10YrYield(),
    ...SECTORS.map(async ({ label, ticker }) => {
      const [summary, ret4w] = await Promise.all([
        fetchQuoteSummary(ticker),
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

      // 52WeekChange from Yahoo is a decimal (0.36 = 36%) — multiply by 100
      const ret52w: number | null =
        summary?.defaultKeyStatistics?.["52WeekChange"]?.raw != null
          ? summary.defaultKeyStatistics["52WeekChange"].raw * 100
          : null;

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
