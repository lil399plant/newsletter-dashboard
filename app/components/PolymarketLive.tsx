"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ─── Excluded categories ──────────────────────────────────────────────────────
const EXCLUDED = new Set([
  "sports", "nba", "basketball", "nfl", "soccer", "baseball", "hockey",
  "tennis", "golf", "mma", "ufc", "formula-1", "f1", "racing", "olympics",
  "cricket", "football", "rugby", "nascar", "superbowl", "champions-league",
  "ncaa", "nhl", "mlb", "pga", "college-football", "college-basketball",
  "premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1",
  "esports", "gaming", "e-sports",
  "culture", "entertainment", "music", "movies", "film", "tv", "television",
  "pop-culture", "celebrity", "celebrities", "oscars", "grammys", "emmys",
  "awards", "reality-tv",
  "weather", "mentions",
  "elections", "us-elections", "world-elections", "global-elections",
  "primaries", "election",
]);

function tagExcluded(tags: { slug?: string; label?: string }[]): boolean {
  return tags.some((t) => {
    const slug = (t.slug ?? "").toLowerCase();
    const label = (t.label ?? "").toLowerCase();
    return (
      EXCLUDED.has(slug) || EXCLUDED.has(label) ||
      slug.startsWith("sports") || label.startsWith("sports") ||
      slug.includes("nfl") || slug.includes("nba") ||
      slug.includes("nhl") || slug.includes("mlb")
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
  endDate: string | null;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeParseArray(raw: string | null | undefined): string[] {
  try { return JSON.parse(raw ?? "[]"); } catch { return []; }
}

function parseEvents(data: any): MarketEvent[] {
  const now = Date.now();
  const events: any[] = Array.isArray(data) ? data : data.events ?? [];
  const result: MarketEvent[] = [];

  for (const ev of events) {
    const endDate = ev.endDate ?? ev.end_date_iso ?? null;
    if (endDate && new Date(endDate).getTime() < now) continue;

    const tags: { slug?: string; label?: string }[] = ev.tags ?? [];
    if (tagExcluded(tags)) continue;

    const markets: any[] = ev.markets ?? [];
    if (markets.length === 0) continue;

    const outcomes: Outcome[] = [];
    const isMulti = markets.length > 1;

    if (!isMulti) {
      const mkt = markets[0];
      const tokenIds = safeParseArray(mkt.clobTokenIds);
      const prices = safeParseArray(mkt.outcomePrices);
      if (tokenIds[0]) {
        outcomes.push({ label: "Yes", tokenId: tokenIds[0], currentPrice: parseFloat(prices[0] ?? "0") });
      }
    } else {
      const parsed = markets
        .map((mkt: any) => {
          const tokenIds = safeParseArray(mkt.clobTokenIds);
          const prices = safeParseArray(mkt.outcomePrices);
          return { label: mkt.groupItemTitle ?? mkt.question ?? "?", tokenId: tokenIds[0] ?? "", currentPrice: parseFloat(prices[0] ?? "0") };
        })
        .filter((o) => o.tokenId)
        .sort((a, b) => b.currentPrice - a.currentPrice)
        .slice(0, 5);
      outcomes.push(...parsed);
    }

    if (outcomes.length === 0) continue;
    result.push({ id: String(ev.id), title: ev.title ?? ev.slug ?? "Untitled", volume24hr: Number(ev.volume24hr ?? 0), outcomes, isMulti, endDate });
  }

  return result;
}

async function fetchEvents(): Promise<MarketEvent[]> {
  const res = await fetch("/api/polymarket/events?limit=200", { cache: "no-store" });
  if (!res.ok) throw new Error(`Gamma API ${res.status}`);
  return parseEvents(await res.json());
}

function searchEvents(pool: MarketEvent[], query: string): MarketEvent[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return pool.slice(0, 10);

  return pool
    .map((ev) => {
      const title = ev.title.toLowerCase();
      const matchCount = terms.filter((t) => title.includes(t)).length;
      return { ev, matchCount };
    })
    .filter(({ matchCount }) => matchCount > 0)
    .sort((a, b) => {
      // Primary: how many terms matched; secondary: 24h volume
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return b.ev.volume24hr - a.ev.volume24hr;
    })
    .slice(0, 10)
    .map(({ ev }) => ev);
}

async function fetchHistory(tokenId: string): Promise<HistoryPoint[]> {
  try {
    const res = await fetch(`/api/polymarket/history?market=${tokenId}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.history ?? [];
  } catch { return []; }
}

function fmtVol(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const LINE_COLORS = ["#1d4ed8", "#059669", "#dc2626", "#d97706", "#7c3aed"];

function probColor(p: number): string {
  if (p >= 0.7) return "#059669";
  if (p >= 0.4) return "#d97706";
  return "#dc2626";
}

// ─── Chart ────────────────────────────────────────────────────────────────────

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
    setLoading(true);
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const allTs = Array.from(
    new Set(histories.flatMap((h) => h.history.map((pt) => pt.t)))
  ).sort((a, b) => a - b);

  const spanDays = allTs.length > 1 ? (allTs[allTs.length - 1] - allTs[0]) / 86_400 : 0;

  function formatTs(t: number): string {
    const d = new Date(t * 1000);
    if (spanDays >= 2) return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  const tickInterval = Math.max(1, Math.floor(allTs.length / 7));

  const chartData = allTs.map((t) => {
    const row: Record<string, number | string> = { t, time: formatTs(t) };
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
    <div className="border border-zinc-200 rounded-lg p-4 bg-zinc-50">
      <div className="flex items-start justify-between mb-3 gap-3">
        <p className="text-xs text-zinc-700 leading-snug flex-1">{event.title}</p>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {currentProbs.map((cp, i) => (
            <span key={cp.label} className="text-sm font-bold tabular-nums"
              style={{ color: event.isMulti ? LINE_COLORS[i % LINE_COLORS.length] : probColor(cp.prob) }}>
              {event.isMulti && <span className="text-xs font-normal text-zinc-400 mr-1">{cp.label.slice(0, 12)}</span>}
              {(cp.prob * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-36 flex items-center justify-center">
          <span className="text-xs text-zinc-400 animate-pulse">loading history…</span>
        </div>
      ) : chartData.length < 2 ? (
        <div className="h-36 flex items-center justify-center">
          <span className="text-xs text-zinc-400">no history available</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData} margin={{ top: 2, right: 4, bottom: 4, left: -18 }}>
            <XAxis dataKey="time"
              tick={{ fill: "#71717a", fontSize: 9, fontFamily: "Times New Roman, serif" }}
              tickLine={false} axisLine={false}
              interval={tickInterval} height={20}
            />
            <YAxis domain={[0, 100]}
              tick={{ fill: "#a1a1aa", fontSize: 8, fontFamily: "Times New Roman, serif" }}
              tickLine={false} axisLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{ background: "#ffffff", border: "1px solid #e4e4e7", borderRadius: 6, fontSize: 10, fontFamily: "Times New Roman, serif", padding: "6px 10px" }}
              itemStyle={{ color: "#3f3f46" }}
              labelStyle={{ color: "#a1a1aa", marginBottom: 3 }}
              formatter={(v: number, name: string) => [`${v}%`, name]}
            />
            {event.isMulti && (
              <Legend wrapperStyle={{ fontSize: 8, fontFamily: "Times New Roman, serif", paddingTop: 4 }} iconType="plainline" iconSize={10} />
            )}
            {histories.map((h, i) => (
              <Line key={h.label} type="monotone" dataKey={h.label}
                stroke={event.isMulti ? LINE_COLORS[i % LINE_COLORS.length] : LINE_COLORS[0]}
                strokeWidth={1.5} dot={false} connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function PolymarketLive() {
  const [pool, setPool] = useState<MarketEvent[]>([]);
  const [selected, setSelected] = useState<MarketEvent | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<MarketEvent[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  const wrapperRef = useRef<HTMLDivElement>(null);

  // Load full pool once on mount
  useEffect(() => {
    fetchEvents().then((evs) => {
      setPool(evs);
      if (evs.length > 0) {
        setSelected(evs[0]);
        setQuery(evs[0].title);
        setLastUpdate(new Date());
      }
      setBootstrapping(false);
    }).catch(() => setBootstrapping(false));
  }, []);

  // Client-side search — instant, no API call
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || pool.length === 0) {
      setSuggestions([]);
      setDropdownOpen(false);
      return;
    }
    const results = searchEvents(pool, trimmed);
    setSuggestions(results);
    setDropdownOpen(results.length > 0);
  }, [query, pool]);

  // Close dropdown on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function selectMarket(ev: MarketEvent) {
    setSelected(ev);
    setQuery(ev.title);
    setDropdownOpen(false);
    setLastUpdate(new Date());
  }

  return (
    <section>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-bold tracking-widest text-blue-900 uppercase">
          Prediction Markets · Polymarket
        </span>
        <div className="flex-1 h-px bg-zinc-300" />
        {lastUpdate && (
          <span className="text-xs text-zinc-400">
            {lastUpdate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}
          </span>
        )}
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      </div>

      {/* Search bar */}
      <div ref={wrapperRef} className="relative mb-3">
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { if (suggestions.length > 0) setDropdownOpen(true); }}
            placeholder="search markets…"
            className="w-full bg-white border border-zinc-300 rounded-md px-3 py-2 text-xs text-zinc-700 placeholder-zinc-400 focus:outline-none focus:border-blue-400"
          />
        </div>

        {/* Dropdown */}
        {dropdownOpen && suggestions.length > 0 && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-md shadow-lg overflow-hidden">
            {suggestions.map((ev, i) => (
              <button
                key={ev.id}
                onMouseDown={() => selectMarket(ev)}
                className="w-full text-left px-3 py-2 flex items-center justify-between gap-3 hover:bg-zinc-50 transition-colors border-b border-zinc-100 last:border-0"
              >
                <span className="text-xs text-zinc-700 leading-snug flex-1 truncate">{ev.title}</span>
                <span className="text-xs text-zinc-400 shrink-0">{fmtVol(ev.volume24hr)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chart area */}
      {bootstrapping ? (
        <div className="h-40 flex items-center justify-center">
          <span className="text-xs text-zinc-400 animate-pulse">fetching markets…</span>
        </div>
      ) : selected ? (
        <MarketChart key={selected.id} event={selected} />
      ) : (
        <div className="h-40 border border-zinc-200 rounded-lg flex items-center justify-center">
          <span className="text-xs text-zinc-400">search for a market above</span>
        </div>
      )}
    </section>
  );
}
