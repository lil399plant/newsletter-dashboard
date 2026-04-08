export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker") ?? "^GSPC";
  const startDate = searchParams.get("startDate");

  const period1 = startDate
    ? Math.floor(new Date(startDate + "T00:00:00Z").getTime() / 1000)
    : Math.floor(Date.now() / 1000) - 365 * 86400;
  const period2 = Math.floor(Date.now() / 1000);

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&period1=${period1}&period2=${period2}&includePrePost=false`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 0 },
    });
    if (!res.ok) return Response.json({ error: `Yahoo ${res.status}` }, { status: res.status });

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return Response.json({ error: "No data returned" }, { status: 404 });

    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] =
      result.indicators?.adjclose?.[0]?.adjclose ??
      result.indicators?.quote?.[0]?.close ?? [];
    const volumes: (number | null)[] = result.indicators?.quote?.[0]?.volume ?? [];

    const rows = timestamps
      .map((t, i) => ({
        date: new Date(t * 1000).toISOString().slice(0, 10),
        close: closes[i] ?? null,
        volume: volumes[i] ?? null,
      }))
      .filter((r) => r.close !== null && r.close > 0);

    return Response.json({ rows, ticker });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
