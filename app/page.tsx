import { Redis } from "@upstash/redis";
import DashboardClient, { type Dashboard } from "./DashboardClient";

export default async function DashboardPage() {
  let dashboard: Dashboard | null = null;

  try {
    const redis = new Redis({
      url: process.env.KV_REST_API_URL!,
      token: process.env.KV_REST_API_TOKEN!,
    });
    dashboard = await redis.get<Dashboard>("dashboard:latest");
  } catch {
    // KV not configured or no data yet — show empty state
  }

  const asOf = dashboard?.as_of_date
    ? new Date(dashboard.as_of_date).toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      })
    : "";

  return (
    <main className="min-h-screen">
      {!dashboard ? (
        <>
          <div className="border-b border-zinc-200 px-6 py-4">
            <h1 className="text-lg font-semibold tracking-tight text-blue-900">Market Dashboard</h1>
            <p className="text-xs text-zinc-400 mt-0.5">Weekly trader-note · updated every Friday close</p>
          </div>
          <div className="flex items-center justify-center h-96 text-zinc-400 text-sm">
            No data yet — trigger /api/pipeline to run the first collection.
          </div>
        </>
      ) : (
        <DashboardClient dashboard={dashboard} asOf={asOf} />
      )}
    </main>
  );
}
