export const dynamic = "force-dynamic";

const TENORS = [
  { label: "3M",  id: "DGS3MO" },
  { label: "6M",  id: "DGS6MO" },
  { label: "1Y",  id: "DGS1"   },
  { label: "2Y",  id: "DGS2"   },
  { label: "3Y",  id: "DGS3"   },
  { label: "5Y",  id: "DGS5"   },
  { label: "7Y",  id: "DGS7"   },
  { label: "10Y", id: "DGS10"  },
  { label: "20Y", id: "DGS20"  },
  { label: "30Y", id: "DGS30"  },
];

// Last Friday's date in YYYY-MM-DD (UTC)
function lastFriday(): string {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun…6=Sat
  const daysBack = day === 0 ? 2 : day === 6 ? 1 : day + 2; // back to most recent Fri
  const fri = new Date(now);
  fri.setUTCDate(now.getUTCDate() - daysBack);
  return fri.toISOString().slice(0, 10);
}

async function fetchSeries(id: string, apiKey: string, start: string) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&observation_start=${start}&api_key=${apiKey}&file_type=json&sort_order=asc`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.observations ?? []).filter((o: any) => o.value !== ".");
}

export async function GET(request: Request) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return Response.json({ error: "No FRED_API_KEY" }, { status: 500 });

  const { searchParams } = new URL(request.url);
  // refDate: user-chosen comparison date (YYYY-MM-DD). Defaults to last Friday.
  const refDate = searchParams.get("refDate") ?? lastFriday();

  // Fetch from 7 days before refDate so we can find the nearest prior trading day,
  // plus enough runway to also get the latest data.
  const refStart = new Date(refDate);
  refStart.setUTCDate(refStart.getUTCDate() - 7);
  const startStr = refStart.toISOString().slice(0, 10);

  const results = await Promise.all(
    TENORS.map(async ({ label, id }) => {
      const obs = await fetchSeries(id, apiKey, startStr);
      if (obs.length === 0) return { label, ref: null, latest: null, refDate: null, latestDate: null };

      // Latest = most recent observation (FRED lags ~1 business day)
      const latestObs = obs[obs.length - 1];
      const latest = parseFloat(latestObs.value);
      const latestDate: string = latestObs.date;

      // Ref curve = last observation on or before the chosen refDate
      // This handles weekends and holidays automatically.
      const onOrBefore = obs.filter((o: any) => o.date <= refDate);
      const refObs = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : obs[0];
      const ref = parseFloat(refObs.value);
      const actualRefDate: string = refObs.date;

      return { label, ref, latest, refDate: actualRefDate, latestDate };
    })
  );

  const ref: Record<string, number> = {};
  const latest: Record<string, number> = {};
  let latestDate = "";
  let actualRefDate = "";

  for (const r of results) {
    if (r.ref !== null) ref[r.label] = r.ref!;
    if (r.latest !== null) latest[r.label] = r.latest!;
    if (r.latestDate) latestDate = r.latestDate;
    if (r.refDate) actualRefDate = r.refDate;
  }

  return Response.json({ ref, latest, refDate: actualRefDate, latestDate });
}
