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

// Returns YYYY-MM-DD for Monday of the current week (local)
function getMondayDate(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun … 6=Sat
  const daysBack = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysBack);
  return monday.toISOString().slice(0, 10);
}

function getStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d.toISOString().slice(0, 10);
}

async function fetchSeries(id: string, apiKey: string, start: string) {
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&observation_start=${start}&api_key=${apiKey}&file_type=json&sort_order=asc`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.observations ?? []).filter((o: any) => o.value !== ".");
}

export async function GET() {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) return Response.json({ error: "No FRED_API_KEY" }, { status: 500 });

  const mondayStr = getMondayDate();
  const startStr = getStartDate();

  const results = await Promise.all(
    TENORS.map(async ({ label, id }) => {
      const obs = await fetchSeries(id, apiKey, startStr);
      if (obs.length === 0) return { label, monday: null, latest: null, mondayDate: null, latestDate: null };

      // Latest = most recent observation
      const latestObs = obs[obs.length - 1];
      const latest = parseFloat(latestObs.value);
      const latestDate: string = latestObs.date;

      // Monday = first observation on or after Monday of this week
      const thisWeek = obs.filter((o: any) => o.date >= mondayStr);
      const mondayObs = thisWeek.length > 0 ? thisWeek[0] : obs[obs.length - 1];
      const monday = parseFloat(mondayObs.value);
      const mondayDate: string = mondayObs.date;

      return { label, monday, latest, mondayDate, latestDate };
    })
  );

  const monday: Record<string, number> = {};
  const latest: Record<string, number> = {};
  let latestDate = "";
  let mondayDate = "";

  for (const r of results) {
    if (r.monday !== null) monday[r.label] = r.monday!;
    if (r.latest !== null) latest[r.label] = r.latest!;
    if (r.latestDate) latestDate = r.latestDate;
    if (r.mondayDate) mondayDate = r.mondayDate;
  }

  return Response.json({ monday, latest, mondayDate, latestDate });
}
