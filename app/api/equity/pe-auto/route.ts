export const dynamic = "force-dynamic";

// Yahoo Finance v7/quote is blocked from Vercel datacenter IPs (429).
// PE data is refreshed via OpenBB yfinance and stored in /api/equity/pe.
export async function GET() {
  return Response.json({});
}
