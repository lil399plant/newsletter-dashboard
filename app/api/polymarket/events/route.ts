export const dynamic = "force-dynamic";

export async function GET() {
  const res = await fetch(
    "https://gamma-api.polymarket.com/events?active=true&limit=100&order=volume24hr&ascending=false",
    { next: { revalidate: 0 } }
  );
  const data = await res.json();
  return Response.json(data);
}
