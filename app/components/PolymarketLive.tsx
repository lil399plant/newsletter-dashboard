"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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

async function fetchEvents(q?: string): Promise<MarketEvent[]> {
  const url = q ? `/api/polymarket/events?q=${encodeURIComponent(q)}&limit=50` : "/api/polymarket/events?limit=100";
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Gamma API ${res.status}`);
  return parseEvents(await res.json());
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

const LINE_COLORS = ["#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#a78bfa"];

function probColor(p: number): string {
  if (p >= 0.7) return "#34d399";
  if (p >= 0.4) return "#fbbf24";
  return "#f87171";
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
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-950/40">
      <div className="flex items-start justify-between mb-3 gap-3">
        <p className="text-xs text-zinc-200 font-mono leading-snug flex-1">{event.title}</p>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {currentProbs.map((cp, i) => (
            <span key={cp.label} className="text-sm font-mono font-bold tabular-nums"
              style={{ color: event.isMulti ? LINE_COLORS[i % LINE_COLORS.length] : probColor(cp.prob) }}>
              {event.isMulti && <span className="text-xs font-normal text-zinc-500 mr-1">{cp.label.slice(0, 12)}</span>}
              {(cp.prob * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="h-36 flex items-center justify-center">
          <span className="text-xs text-zinc-700 font-mono animate-pulse">loading history…</span>
        </div>
      ) : chartData.length < 2 ? (
        <div className="h-36 flex items-center justify-center">
          <span className="text-xs text-zinc-700 font-mono">no history available</span>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={chartData} margin={{ top: 2, right: 4, bottom: 4, left: -18 }}>
            <XAxis dataKey="time"
              tick={{ fill: "#52525b", fontSize: 9, fontFamily: "monospace" }}
              tickLine={false} axisLine={false}
              interval={tickInterval} height={20}
            />
            <YAxis domain={[0, 100]}
              tick={{ fill: "#3f3f46", fontSize: 8, fontFamily: "monospace" }}
              tickLine={false} axisLine={false}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip
              contentStyle={{ background: "#09090b", border: "1px solid #27272a", borderRadius: 6, fontSize: 10, fontFamily: "monospace", padding: "6px 10px" }}
              itemStyle={{ color: "#e4e4e7" }}
              labelStyle={{ color: "#52525b", marginBottom: 3 }}
              formatter={(v: number, name: string) => [`${v}%`, name]}
            />
            {event.isMulti && (
              <Legend wrapperStyle={{ fontSize: 8, fontFamily: "monospace", paddingTop: 4 }} iconType="plainline" iconSize={10} />
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
  const [selected, setSelected] = useState<MarketEvent | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<MarketEvent[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Load default (highest-volume qualifying market) on mount
  useEffect(() => {
    fetchEvents().then((evs) => {
      if (evs.length > 0) {
        setSelected(evs[0]);
        setQuery(evs[0].title);
        setLastUpdate(new Date());
      }
      setBootstrapping(false);
    }).catch(() => setBootstrapping(false));
  }, []);

  // Debounced search on keystroke
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setSuggestions([]);
      setDropdownOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const evs = await fetchEvents(query.trim());
        setSuggestions(evs.slice(0, 10));
        setDropdownOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

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
        <span className="text-xs font-mono font-bold tracking-widest text-zinc-500 uppercase">
          Prediction Markets · Polymarket
        </span>
        <div className="flex-1 h-px bg-zinc-800" />
        {lastUpdate && (
          <span className="text-xs text-zinc-700 font-mono">
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
            className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-3 py-2 text-xs font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 pr-8"
          />
          {searching && (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-600 text-xs font-mono animate-pulse">…</span>
          )}
        </div>

        {/* Dropdown */}
        {dropdownOpen && suggestions.length > 0 && (
          <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-700 rounded-md shadow-xl overflow-hidden">
            {suggestions.map((ev, i) => (
              <button
                key={ev.id}
                onMouseDown={() => selectMarket(ev)}
                className="w-full text-left px-3 py-2 flex items-center justify-between gap-3 hover:bg-zinc-800 transition-colors border-b border-zinc-800 last:border-0"
              >
                <span className="text-xs font-mono text-zinc-200 leading-snug flex-1 truncate">{ev.title}</span>
                <span className="text-xs font-mono text-zinc-600 shrink-0">{fmtVol(ev.volume24hr)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chart area */}
      {bootstrapping ? (
        <div className="h-40 flex items-center justify-center">
          <span className="text-xs text-zinc-600 font-mono animate-pulse">fetching markets…</span>
        </div>
      ) : selected ? (
        <MarketChart key={selected.id} event={selected} />
      ) : (
        <div className="h-40 border border-zinc-800 rounded-lg flex items-center justify-center">
          <span className="text-xs text-zinc-600 font-mono">search for a market above</span>
        </div>
      )}
    </section>
  );
}
