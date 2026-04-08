export const dynamic = "force-dynamic";

// Returns only 10yr yield and placeholder rows.
// P/E data: Yahoo quoteSummary is blocked from Vercel server IPs.
// Returns (4W, 52W): fetched client-side via /api/equity/history to avoid server-side 429s.

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

export async function GET() {
  const tenYrYield = await fetch10YrYield();
  // Return sector metadata + 10yr yield; client fetches returns itself
  return Response.json({
    sectors: SECTORS,
    tenYrYield,
  });
}
