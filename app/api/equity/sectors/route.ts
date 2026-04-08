export const dynamic = "force-dynamic";

const SECTORS = [
  { label: "S&P 500",           ticker: "SPY"  },
  { label: "Technology",        ticker: "XLK"  },
  { label: "Financials",        ticker: "XLF"  },
  { label: "Health Care",       ticker: "XLV"  },
  { label: "Consumer Disc.",    ticker: "XLY"  },
  { label: "Industrials",       ticker: "XLI"  },
  { label: "Comm. Services",    ticker: "XLC"  },
  { label: "Consumer Staples",  ticker: "XLP"  },
  { label: "Energy",            ticker: "XLE"  },
  { label: "Real Estate",       ticker: "XLRE" },
  { label: "Materials",         ticker: "XLB"  },
  { label: "Utilities",         ticker: "XLU"  },
];

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

async function fetch4WeekReturn(ticker: string): Promise<number | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1mo`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const closes: (number | null)[] =
    result.indicators?.adjclose?.[0]?.adjclose ??
    result.indicators?.quote?.[0]?.close ?? [];
  const valid = closes.filter((c): c is number => c != null && c > 0);
  if (valid.length < 2) return null;
  return (valid[valid.length - 1] / valid[0] - 1) * 100;
}

async function fetch10YrYield(): Promise<number | null> {
  // ^TNX: 10-year Treasury yield, quoted in % (e.g. 4.25 = 4.25%)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=5d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    next: { revalidate: 0 },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const closes: (number | null)[] =
    result.indicators?.adjclose?.[0]?.adjclose ??
    result.indicators?.quote?.[0]?.close ?? [];
  const valid = closes.filter((c): c is number => c != null && c > 0);
  return valid.length ? valid[valid.length - 1] : null;
}

export async function GET() {
  const [tenYrYield, ...sectorResults] = await Promise.all([
    fetch10YrYield(),
    ...SECTORS.map(async ({ label, ticker }) => {
      const [summary, ret4w] = await Promise.all([
        fetchQuoteSummary(ticker),
        fetch4WeekReturn(ticker),
      ]);

      // Try multiple paths Yahoo uses for these fields across ETFs vs equities
      const trailingPE: number | null =
        summary?.summaryDetail?.trailingPE?.raw ??
        summary?.defaultKeyStatistics?.trailingPE?.raw ?? null;

      const forwardPE: number | null =
        summary?.summaryDetail?.forwardPE?.raw ??
        summary?.defaultKeyStatistics?.forwardPE?.raw ?? null;

      const profitMargin: number | null =
        summary?.financialData?.profitMargins?.raw ?? null;

      const ret52w: number | null =
        summary?.defaultKeyStatistics?.["52WeekChange"]?.raw ?? null;

      const impliedEpsGrowth: number | null =
        trailingPE != null && forwardPE != null && forwardPE > 0
          ? (trailingPE / forwardPE - 1) * 100
          : null;

      return { label, ticker, trailingPE, forwardPE, impliedEpsGrowth, profitMargin, ret52w, ret4w };
    }),
  ]);

  const rows = sectorResults.map((r) => ({
    ...r,
    // ERP = earnings yield (%) minus 10yr yield (%)
    erp:
      r.forwardPE != null && tenYrYield != null
        ? parseFloat(((1 / r.forwardPE) * 100 - tenYrYield).toFixed(2))
        : null,
  }));

  return Response.json({ rows, tenYrYield });
}
