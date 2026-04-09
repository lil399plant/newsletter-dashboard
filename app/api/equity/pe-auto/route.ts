export const dynamic = "force-dynamic";

import { Redis } from "@upstash/redis";

const CACHE_KEY = "sectors:pe:cache";
const TICKERS = ["SPY", "XLK", "XLF", "XLV", "XLY", "XLI", "XLC", "XLP", "XLE", "XLRE", "XLB", "XLU"];

function getRedis() {
  return new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
}

export async function GET() {
  try {
    const redis = getRedis();

    // Return cached data if available (12hr TTL set on write)
    const cached = await redis.get<Record<string, { trailingPE: number | null; forwardPE: number | null }>>(CACHE_KEY);
    if (cached) return Response.json(cached);

    // Fetch from Yahoo Finance v7/quote (no crumb required)
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${TICKERS.join(",")}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      },
      next: { revalidate: 0 },
    });

    if (!res.ok) return Response.json({});

    const data = await res.json();
    const quotes: any[] = data?.quoteResponse?.result ?? [];

    const result: Record<string, { trailingPE: number | null; forwardPE: number | null }> = {};
    for (const q of quotes) {
      if (!q.symbol) continue;
      result[q.symbol] = {
        trailingPE: typeof q.trailingPE === "number" ? q.trailingPE : null,
        forwardPE: typeof q.forwardPE === "number" ? q.forwardPE : null,
      };
    }

    // Cache for 12 hours if we got any data
    if (Object.keys(result).length > 0) {
      await redis.set(CACHE_KEY, result, { ex: 12 * 60 * 60 });
    }

    return Response.json(result);
  } catch {
    return Response.json({});
  }
}
