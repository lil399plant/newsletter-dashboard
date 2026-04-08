export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q");
  const limit = searchParams.get("limit") ?? "100";

  const url = new URL("https://gamma-api.polymarket.com/events");
  url.searchParams.set("active", "true");
  url.searchParams.set("limit", limit);
  url.searchParams.set("order", "volume24hr");
  url.searchParams.set("ascending", "false");
  if (q) url.searchParams.set("q", q);

  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  const data = await res.json();
  return Response.json(data);
}
