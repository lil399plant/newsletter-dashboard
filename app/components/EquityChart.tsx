"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ─── Index options ────────────────────────────────────────────────────────────

const INDICES = [
  { label: "S&P 500",       ticker: "^GSPC"   },
  { label: "S&P 400",       ticker: "^SP400"  },
  { label: "S&P 600",       ticker: "^SP600"  },
  { label: "Russell 2000",  ticker: "^RUT"    },
  { label: "QQQ",           ticker: "QQQ"     },
  { label: "MSCI World",    ticker: "URTH"    },
  { label: "Hang Seng",     ticker: "^HSI"    },
  { label: "Stoxx 600",     ticker: "^STOXX"  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function oneYearAgo(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(d: string, short = false): string {
  if (!d) return "";
  const dt = new Date(d + "T12:00:00");
  return short
    ? dt.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function smartFmtDate(d: string, spanDays: number): string {
  if (!d) return "";
  const dt = new Date(d + "T12:00:00");
  if (spanDays > 365)
    return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  if (spanDays > 60)
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return dt.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
}

function fmtPrice(v: number, ticker: string): string {
  if (ticker === "^HSI") return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 10000) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1000) return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  return v.toFixed(2);
}

function fmtVol(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(v);
}

// ─── Evenly spaced ticks ─────────────────────────────────────────────────────

function evenTicks(min: number, max: number, count = 5): number[] {
  const step = (max - min) / (count - 1);
  return Array.from({ length: count }, (_, i) => min + i * step);
}

// ─── Custom tooltip ───────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, ticker }: any) {
  if (!active || !payload?.length) return null;
  const rawDate: string = payload[0]?.payload?.date ?? "";
  const price = payload.find((p: any) => p.dataKey === "close");
  const vix = payload.find((p: any) => p.dataKey === "vix");
  const vol = payload.find((p: any) => p.dataKey === "volume");

  return (
    <div style={{ background: "#fff", border: "1px solid #e4e4e7", borderRadius: 6, padding: "7px 11px", fontSize: 10, fontFamily: "Times New Roman, serif" }}>
      <div style={{ color: "#a1a1aa", marginBottom: 4 }}>{fmtDate(rawDate)}</div>
      {price && <div style={{ color: "#1e3a8a" }}>Price: {fmtPrice(price.value, ticker)}</div>}
      {vix?.value != null && <div style={{ color: "#b45309" }}>VIX: {vix.value.toFixed(2)}</div>}
      {vol?.value > 0 && <div style={{ color: "#a1a1aa" }}>Vol: {fmtVol(vol.value)}</div>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Row {
  date: string;
  close: number;
  volume: number | null;
  vix: number | null;
}

export default function EquityChart() {
  const [ticker, setTicker] = useState("^GSPC");
  const [startDate, setStartDate] = useState(oneYearAgo());
  const [committedStart, setCommittedStart] = useState(oneYearAgo());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (t: string, start: string) => {
    setLoading(true);
    setError(null);
    try {
      const [res, vixRes] = await Promise.all([
        fetch(`/api/equity/history?ticker=${encodeURIComponent(t)}&startDate=${start}`, { cache: "no-store" }),
        fetch(`/api/equity/history?ticker=%5EVIX&startDate=${start}`, { cache: "no-store" }),
      ]);
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Build VIX lookup by date
      const vixMap: Record<string, number> = {};
      if (vixRes.ok) {
        const vixData = await vixRes.json();
        (vixData.rows ?? []).forEach((r: { date: string; close: number }) => {
          vixMap[r.date] = r.close;
        });
      }

      const raw: { date: string; close: number; volume: number | null }[] = data.rows ?? [];

      const displayRows: Row[] = raw
        .filter((r) => r.date >= start)
        .map((r) => ({ ...r, vix: vixMap[r.date] ?? null }));

      setRows(displayRows);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(ticker, committedStart);
  }, [load, ticker, committedStart]);

  function handleDateChange(val: string) {
    setStartDate(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (val) setCommittedStart(val);
    }, 600);
  }

  function handleTickerChange(val: string) {
    setTicker(val);
  }

  // ── Chart data ──
  const spanDays = rows.length > 1
    ? (new Date(rows[rows.length - 1].date).getTime() - new Date(rows[0].date).getTime()) / 86_400_000
    : 365;

  const tickInterval = Math.max(1, Math.floor(rows.length / 7));

  const chartData = rows.map((r) => ({
    ...r,
    dateLabel: smartFmtDate(r.date, spanDays),
  }));

  // Domains
  const closes = rows.map((r) => r.close);
  const vixValues = rows.map((r) => r.vix).filter((v): v is number => v !== null);
  const vols = rows.map((r) => r.volume ?? 0).filter((v) => v > 0);
  const maxVol = vols.length ? Math.max(...vols) : 0;

  const priceMin = closes.length ? Math.min(...closes) : 0;
  const priceMax = closes.length ? Math.max(...closes) : 1;
  const pricePad = (priceMax - priceMin) * 0.08;
  const pDomainMin = priceMin - pricePad;
  const pDomainMax = priceMax + pricePad;
  const pDomain: [number, number] = [pDomainMin, pDomainMax];
  const pTicks = evenTicks(pDomainMin, pDomainMax, 5);

  const vixMin = vixValues.length ? Math.min(...vixValues) : 0;
  const vixMax = vixValues.length ? Math.max(...vixValues) : 40;
  const vixPad = Math.max((vixMax - vixMin) * 0.08, 0.5);
  const vixDomainMin = Math.max(0, vixMin - vixPad);
  const vixDomainMax = vixMax + vixPad;
  const vixDomain: [number, number] = [vixDomainMin, vixDomainMax];
  const vixTicks = evenTicks(vixDomainMin, vixDomainMax, 5);

  // Volume domain: inflate max 5× so bars only occupy bottom ~20%
  const volDomain: [number, number] = [0, maxVol * 5];

  const selectedLabel = INDICES.find((i) => i.ticker === ticker)?.label ?? ticker;
  const latestClose = rows[rows.length - 1]?.close;
  const latestVix = rows[rows.length - 1]?.vix;
  const latestDate = rows[rows.length - 1]?.date;
  const hasVolume = vols.length > 0;

  return (
    <section>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-bold tracking-widest text-blue-900 uppercase">Equities</span>
        <div className="flex-1 h-px bg-zinc-300" />
        {latestDate && !loading && (
          <span className="text-xs text-zinc-400">{fmtDate(latestDate)}</span>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={ticker}
          onChange={(e) => handleTickerChange(e.target.value)}
          className="border border-zinc-300 rounded px-2 py-1 text-xs text-zinc-700 bg-white focus:outline-none focus:border-blue-400"
        >
          {INDICES.map((idx) => (
            <option key={idx.ticker} value={idx.ticker}>{idx.label}</option>
          ))}
        </select>

        <span className="text-xs text-zinc-400">from</span>

        <input
          type="date"
          value={startDate}
          max={today()}
          onChange={(e) => handleDateChange(e.target.value)}
          className="border border-zinc-300 rounded px-2 py-1 text-xs text-zinc-700 bg-white focus:outline-none focus:border-blue-400"
        />

        {/* Summary badges */}
        {!loading && latestClose != null && (
          <div className="flex items-center gap-3 ml-auto">
            <span className="text-sm font-bold text-zinc-800" style={{ fontFamily: "Times New Roman, serif" }}>
              {fmtPrice(latestClose, ticker)}
            </span>
            {latestVix != null && (
              <span className="text-sm font-bold" style={{ color: "#b45309", fontFamily: "Times New Roman, serif" }}>
                VIX {latestVix.toFixed(2)}
              </span>
            )}
          </div>
        )}

        {loading && <span className="text-xs text-zinc-300 animate-pulse ml-auto">loading…</span>}
      </div>

      {/* Chart */}
      {error ? (
        <div className="text-xs text-red-500 px-1">{error}</div>
      ) : rows.length === 0 && !loading ? (
        <div className="h-64 flex items-center justify-center text-xs text-zinc-400">no data available</div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 56, bottom: 4, left: 4 }}>

            {/* Hidden volume axis — inflated domain pushes bars to bottom */}
            <YAxis
              yAxisId="vol"
              orientation="left"
              hide
              domain={volDomain}
            />

            {/* Left: VIX */}
            <YAxis
              yAxisId="vix"
              orientation="left"
              domain={vixDomain}
              ticks={vixTicks}
              tick={{ fill: "#71717a", fontSize: 8, fontFamily: "Times New Roman, serif" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => v.toFixed(1)}
              width={40}
            />

            {/* Right: price */}
            <YAxis
              yAxisId="price"
              orientation="right"
              domain={pDomain}
              ticks={pTicks}
              tick={{ fill: "#71717a", fontSize: 8, fontFamily: "Times New Roman, serif" }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => fmtPrice(v, ticker)}
              width={56}
            />

            <XAxis
              dataKey="dateLabel"
              tick={{ fill: "#a1a1aa", fontSize: 8, fontFamily: "Times New Roman, serif" }}
              tickLine={false}
              axisLine={{ stroke: "#e4e4e7" }}
              interval={tickInterval}
              height={18}
            />

            <Tooltip
              content={<CustomTooltip ticker={ticker} />}
              cursor={{ stroke: "#e4e4e7", strokeWidth: 1 }}
            />

            <Legend
              wrapperStyle={{ fontSize: 9, fontFamily: "Times New Roman, serif", paddingTop: 6 }}
              iconType="plainline"
              iconSize={12}
            />

            {/* Volume — shaded mass at bottom */}
            {hasVolume && (
              <Bar
                yAxisId="vol"
                dataKey="volume"
                fill="#d4d4d8"
                opacity={0.45}
                name="Volume"
                legendType="none"
                isAnimationActive={false}
              />
            )}

            {/* VIX — amber, left axis */}
            <Line
              yAxisId="vix"
              type="monotone"
              dataKey="vix"
              stroke="#b45309"
              strokeWidth={1.5}
              dot={false}
              connectNulls
              name="VIX"
              isAnimationActive={false}
            />

            {/* Price — solid navy, right axis */}
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke="#1e3a8a"
              strokeWidth={2}
              dot={false}
              connectNulls
              name={selectedLabel}
              isAnimationActive={false}
            />

          </ComposedChart>
        </ResponsiveContainer>
      )}
    </section>
  );
}
