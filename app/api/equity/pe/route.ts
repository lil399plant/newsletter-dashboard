export const dynamic = "force-dynamic";

import { Redis } from "@upstash/redis";

const PE_KEY = "sectors:pe";

function getRedis() {
  return new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
}

// GET: return stored PE values
export async function GET() {
  try {
    const redis = getRedis();
    const data = await redis.get<Record<string, { trailingPE: number | null; forwardPE: number | null }>>(PE_KEY);
    return Response.json(data ?? {});
  } catch (e: any) {
    return Response.json({}, { status: 500 });
  }
}

// POST: save PE values { ticker: { trailingPE, forwardPE } }
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const redis = getRedis();
    // Merge with existing so partial updates don't wipe other tickers
    const existing = await redis.get<Record<string, any>>(PE_KEY) ?? {};
    const merged = { ...existing, ...body };
    await redis.set(PE_KEY, merged);
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
