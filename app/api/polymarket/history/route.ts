export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const market = searchParams.get("market");
  if (!market) return Response.json({ history: [] });

  const res = await fetch(
    `https://clob.polymarket.com/prices-history?market=${market}&interval=1m&fidelity=60`,
    { next: { revalidate: 0 } }
  );
  const data = await res.json();
  return Response.json(data);
}
