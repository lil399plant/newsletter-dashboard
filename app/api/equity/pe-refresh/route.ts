export const dynamic = "force-dynamic";

import { Redis } from "@upstash/redis";

const PE_KEY = "sectors:pe";
const TICKERS = ["SPY", "XLK", "XLF", "XLV", "XLY", "XLI", "XLC", "XLP", "XLE", "XLRE", "XLB", "XLU"];

function getRedis() {
  return new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
}

export async function POST() {
  try {
    const redis = getRedis();
    const existing = await redis.get<Record<string, any>>(PE_KEY) ?? {};

    // Try Yahoo Finance v7/quote (no crumb required)
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${TICKERS.join(",")}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return Response.json({ error: "unavailable", message: "Could not reach data provider." }, { status: 503 });
    }

    if (res.status === 429) {
      return Response.json(
        { error: "rate_limit", message: "Yahoo Finance rate limit hit. Wait a day or two before trying again." },
        { status: 429 }
      );
    }

    if (!res.ok) {
      return Response.json(
        { error: "unavailable", message: "Data provider returned an error. Try again later." },
        { status: 503 }
      );
    }

    const data = await res.json();
    const quotes: any[] = data?.quoteResponse?.result ?? [];

    if (quotes.length === 0) {
      return Response.json(
        { error: "no_data", message: "No data returned. Yahoo may be blocking this server. Try again in a few days." },
        { status: 503 }
      );
    }

    // Merge new trailing/forward PE into existing data, preserving forward PE if not returned
    const updatedAt = new Date().toISOString();
    const updated: Record<string, any> = { ...existing };
    let updatedCount = 0;

    for (const q of quotes) {
      if (!q.symbol) continue;
      const prev = existing[q.symbol] ?? {};
      updated[q.symbol] = {
        trailingPE: typeof q.trailingPE === "number" ? q.trailingPE : prev.trailingPE ?? null,
        forwardPE:  typeof q.forwardPE  === "number" ? q.forwardPE  : prev.forwardPE  ?? null,
      };
      if (typeof q.trailingPE === "number") updatedCount++;
    }

    if (updatedCount === 0) {
      return Response.json(
        { error: "no_data", message: "Yahoo returned no P/E data for these ETFs. Try again in a few days." },
        { status: 503 }
      );
    }

    updated["_meta"] = { updatedAt, source: "yahoo" };
    await redis.set(PE_KEY, updated);

    return Response.json({ ok: true, updatedAt, updatedCount });
  } catch (e: any) {
    return Response.json({ error: "server_error", message: "Refresh failed." }, { status: 500 });
  }
}
