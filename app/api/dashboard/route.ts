import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

export const revalidate = 0; // always fresh

export async function GET() {
  const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });
  const data = await redis.get("dashboard:latest");
  if (!data) {
    return NextResponse.json({ error: "No dashboard data yet." }, { status: 404 });
  }
  return NextResponse.json(data);
}
