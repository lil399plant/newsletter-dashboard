import { kv } from "@vercel/kv";
import { NextResponse } from "next/server";

export const revalidate = 0; // always fresh

export async function GET() {
  const data = await kv.get("dashboard:latest");
  if (!data) {
    return NextResponse.json({ error: "No dashboard data yet." }, { status: 404 });
  }
  return NextResponse.json(data);
}
