"use client";

import { useEffect, useState, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ─── Excluded tag slugs/labels ────────────────────────────────────────────────
const EXCLUDED = new Set([
  // Sports
  "sports", "nba", "basketball", "nfl", "soccer", "baseball", "hockey",
  "tennis", "golf", "mma", "ufc", "formula-1", "f1", "racing", "olympics",
  "cricket", "football", "rugby", "nascar", "superbowl", "champions-league",
  "ncaa", "nhl", "mlb", "pga", "college-football", "college-basketball",
  "premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1",
  // Esports / Gaming
  "esports", "gaming", "e-sports",
  // Culture / Entertainment
  "culture", "entertainment", "music", "movies", "film", "tv", "television",
  "pop-culture", "celebrity", "celebrities", "oscars", "grammys", "emmys",
  "awards", "reality-tv",
  // Weather
  "weather",
  // Mentions
  "mentions",
  // Elections
  "elections", "us-elections", "world-elections", "global-elections",
  "primaries", "election",
]);

function tagExcluded(tags: { slug?: string; label?: string }[]): boolean {
  return tags.some((t) => {
    const slug = (t.slug ?? "").toLowerCase();
    const label = (t.label ?? "").toLowerCase();
    return (
      EXCLUDED.has(slug) ||
      EXCLUDED.has(label) ||
      slug.startsWith("sports") ||
      label.startsWith("sports") ||
      slug.includes("nfl") ||
      slug.includes("nba") ||
      slug.includes("nhl") ||
      slug.includes("mlb")
    );
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Outcome {
  label: string;
  tokenId: string;
  currentPrice: number;
}

interface MarketEvent {
  id: string;
  title: string;
  volume24hr: number;
  outcomes: Outcome[];
  isMulti: boolean;
}

interface HistoryPoint {
  t: number;
  p: number;
}

interface OutcomeHistory {
  label: string;
  tokenId: string;
  history: HistoryPoint[];
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function fetchTopEvents(): Promise<MarketEvent[]> {
  const res = await fetch("/api/polymarket/events", { cache: "no-store" });
  if (!res.ok) throw new Error(`Gamma API ${res.status}`);
  const data = await res.json();
  const events: any[] = Array.isArray(data) ? data : data.events ?? [];

  const result: MarketEvent[] = [];

  for (const ev of events) {
    const tags: { slug?: string; label?: string }[] = ev.tags ?? [];
    if (tagExcluded(tags)) continue;

    const markets: any[] = ev.markets ?? [];
    if (markets.length === 0) continue;

    const outcomes: Outcome[] = [];
    const isMulti = markets.length > 1;

    if (!isMulti) {
      // Binary event — single market, show Yes side
      const mkt = markets[0];
      const tokenIds: string[] = safeParseArray(mkt.clobTokenIds);
      const prices: string[] = safeParseArray(mkt.outcomePrices);
      if (tokenIds[0]) {
        outcomes.push({
          label: "Yes",
          tokenId: tokenIds[0],
          currentPrice: parseFloat(prices[0] ?? "0"),
        });
      }
    } else {
      // Multi-outcome event — one market per outcome, take Yes token per market
      const parsed = markets
        .map((mkt: any) => {
          const tokenIds: string[] = safeParseArray(mkt.clobTokenIds);
          const prices: string[] = safeParseArray(mkt.outcomePrices);
          return {
            label: mkt.groupItemTitle ?? mkt.question ?? "?",
            tokenId: tokenIds[0] ?? "",
            currentPrice: parseFloat(prices[0] ?? "0"),
          };
        })
        .filter((o) => o.tokenId)
        .sort((a, b) => b.currentPrice - a.currentPrice)
        .slice(0, 5);
      outcomes.push(...parsed);
    }

    if (outcomes.length === 0) continue;

    result.push({
      id: String(ev.id),
      title: ev.title ?? ev.slug ?? "Untitled",
      volume24hr: Number(ev.volume24hr ?? 0),
      outcomes,
      isMulti,
    });

    if (result.length >= 5) break;
  }

  return result;
}

function safeParseArray(raw: string | null | undefined): string[] {
  try {
    return JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
}

async function fetchHistory(tokenId: string): Promise<HistoryPoint[]> {
  try {
    const res = await fetch(`/api/polymarket/history?market=${tokenId}`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    const raw: { t: number; p: number }[] = data.history ?? [];
    // Last 2 hours
    return raw.slice(-120);
  } catch {
    return [];
  }
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const LINE_COLORS = [
  "#34d399", // emerald
  "#60a5fa", // blue
  "#f472b6", // pink
  "#fbbf24", // amber
  "#a78bfa", // violet
];

function probColor(p: number): string {
  if (p >= 0.7) return "#34d399";
  if (p >= 0.4) return "#fbbf24";
  return "#f87171";
}

// ─── Single market chart ──────────────────────────────────────────────────────

function MarketChart({ event }: { event: MarketEvent }) {
  const [histories, setHistories] = useState<OutcomeHistory[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const results = await Promise.all(
      event.outcomes.map(async (o) => ({
        label: o.label,
        tokenId: o.tokenId,
        history: await fetchHistory(o.tokenId),
      }))
    );
    setHistories(results.filter((r) => r.history.length > 0));
    setLoading(false);
  }, [event]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Merge timestamps into chart rows
  const allTs = Array.from(
    new Set(histories.flatMap((h) => h.history.map((pt) => pt.t)))
  ).sort((a, b) => a - b);

  const chartData = allTs.map((t) => {
    const row: Record<string, number | string> = {
      t,
      time: new Date(t * 1000).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    };
    for (const h of histories) {
      const pt = h.history.find((p) => p.t === t);
      if (pt !== undefined) row[h.label] = parseFloat((pt.p * 100).toFixed(1));
    }
    return row;
  });

  const currentProbs = event.outcomes.map((o) => {
    const h = histories.find((h) => h.tokenId === o.tokenId);
    const last = h?.history[h.history.length - 1];
    return { label: o.label, prob: last?.p ?? o.currentPrice };
  });

  return (
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950/40">
      {/* Header row */}
      <div className="flex items-start justify-between mb-3 gap-3">
        <p className="text-xs text-zinc-200 font-mono leading-snug flex-1">
          {event.title}
        </p>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {currentProbs.map((cp, i) => (
            <span
              key={cp.label}
              className="text-sm font-mono font-bold tabular-nums"
              style={{ color: event.isMulti ? LINE_COLORS[i % LINE_COLORS.length] : probColor(cp.prob) }}
            >
              {event.isMulti && (
                <span className="text-xs font-normal text-zinc-500 mr-1">{cp.label.slice(0, 12)}</span>
              )}
              {(cp.prob * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>

      {/* Chart */}
      {loading ? (
        <div className="h-28 flex items-center justify-center">
          <span className="text-xs text-zinc-700 font-mono animate-pulse">loading history…</span>
        </div>
      ) : chartData.length < 2 ? (
        <div className="h-28 flex items-center justify-center">
          <span className="text-xs text-zinc-700 font-mono">no history available</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={130}>
          <LineChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: -18 }}>
            <XAxis
              dataKey="time"
              tick={{ fill: "#3f3f46", fontSize: 8, fontFamily: "monospace" }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: "#3f3f46", fontSize: 8, fontFamily: "monospace" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{
                background: "#09090b",
                border: "1px solid #27272a",
                borderRadius: 6,
                fontSize: 10,
                fontFamily: "monospace",
                padding: "6px 10px",
              }}
              itemStyle={{ color: "#e4e4e7" }}
              labelStyle={{ color: "#52525b", marginBottom: 3 }}
              formatter={(v: number, name: string) => [`${v}%`, name]}
            />
            {event.isMulti && (
              <Legend
                wrapperStyle={{ fontSize: 8, fontFamily: "monospace", paddingTop: 4 }}
                iconType="plainline"
                iconSize={10}
              />
            )}
            {histories.map((h, i) => (
              <Line
                key={h.label}
                type="monotone"
                dataKey={h.label}
                stroke={event.isMulti ? LINE_COLORS[i % LINE_COLORS.length] : LINE_COLORS[0]}
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PolymarketLive() {
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const loadEvents = useCallback(async () => {
    try {
      const evs = await fetchTopEvents();
      setEvents(evs);
      setLastUpdate(new Date());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEvents();
    const id = setInterval(loadEvents, 60_000);
    return () => clearInterval(id);
  }, [loadEvents]);

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-mono font-bold tracking-widest text-zinc-500 uppercase">
          Prediction Markets · Polymarket
        </span>
        <div className="flex-1 h-px bg-zinc-800" />
        {lastUpdate && (
          <span className="text-xs text-zinc-700 font-mono">
            {lastUpdate.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })}
          </span>
        )}
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      </div>

      {loading ? (
        <div className="h-32 flex items-center justify-center">
          <span className="text-xs text-zinc-600 font-mono animate-pulse">fetching markets…</span>
        </div>
      ) : error ? (
        <div className="text-xs text-red-400 font-mono px-1">{error}</div>
      ) : events.length === 0 ? (
        <div className="text-xs text-zinc-600 font-mono px-1">no qualifying markets found</div>
      ) : (
        <div className="space-y-3">
          {events.map((ev) => (
            <MarketChart key={ev.id} event={ev} />
          ))}
        </div>
      )}
    </section>
  );
}
