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

const TENORS = ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "20Y", "30Y"];

interface YieldData {
  monday: Record<string, number>;
  latest: Record<string, number>;
  mondayDate: string;
  latestDate: string;
}

interface ChartRow {
  tenor: string;
  Monday: number | null;
  Latest: number | null;
  bps: number | null;
}

// ─── Custom X-axis tick ───────────────────────────────────────────────────────

function CustomTick({ x, y, payload, bpsMap }: any) {
  const tenor: string = payload?.value ?? "";
  const bps: number | null = bpsMap[tenor] ?? null;
  const bpsLabel =
    bps === null ? "" : bps > 0 ? `+${bps}bp` : bps < 0 ? `${bps}bp` : "0bp";
  const bpsColor = bps === null ? "#a1a1aa" : bps > 0 ? "#059669" : bps < 0 ? "#dc2626" : "#a1a1aa";

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0} y={0} dy={12}
        textAnchor="middle"
        fill="#52525b"
        fontSize={9}
        fontFamily="Times New Roman, serif"
      >
        {tenor}
      </text>
      {bpsLabel && (
        <text
          x={0} y={0} dy={24}
          textAnchor="middle"
          fill={bpsColor}
          fontSize={8}
          fontFamily="Times New Roman, serif"
          fontWeight="600"
        >
          {bpsLabel}
        </text>
      )}
    </g>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function YieldCurve() {
  const [data, setData] = useState<YieldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/rates/yieldcurve", { cache: "no-store" });
      if (!res.ok) throw new Error(`API ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5 * 60_000); // refresh every 5 min
    return () => clearInterval(id);
  }, [load]);

  const chartData: ChartRow[] = TENORS.map((tenor) => {
    const mon = data?.monday[tenor] ?? null;
    const lat = data?.latest[tenor] ?? null;
    const bps = mon !== null && lat !== null ? Math.round((lat - mon) * 100) : null;
    return { tenor, Monday: mon, Latest: lat, bps };
  });

  const bpsMap: Record<string, number | null> = {};
  chartData.forEach((r) => { bpsMap[r.tenor] = r.bps; });

  // Y-axis domain
  const allVals = chartData.flatMap((r) => [r.Monday, r.Latest]).filter((v): v is number => v !== null);
  const yMin = allVals.length ? Math.floor((Math.min(...allVals) - 0.15) * 4) / 4 : 0;
  const yMax = allVals.length ? Math.ceil((Math.max(...allVals) + 0.15) * 4) / 4 : 6;

  const fmtDate = (d: string) =>
    d ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  return (
    <section>
      {/* Section header */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-bold tracking-widest text-blue-900 uppercase">
          Treasury Yield Curve
        </span>
        <div className="flex-1 h-px bg-zinc-300" />
        {data && !loading && (
          <span className="text-xs text-zinc-400">
            {fmtDate(data.latestDate)}
          </span>
        )}
      </div>

      {loading ? (
        <div className="h-52 flex items-center justify-center">
          <span className="text-xs text-zinc-400 animate-pulse">loading yield curve…</span>
        </div>
      ) : error ? (
        <div className="text-xs text-red-500 px-1">{error}</div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: -10 }}>
              <XAxis
                dataKey="tenor"
                tick={(props: any) => <CustomTick {...props} bpsMap={bpsMap} />}
                tickLine={false}
                axisLine={{ stroke: "#e4e4e7" }}
                height={50}
              />
              <YAxis
                domain={[yMin, yMax]}
                tick={{ fill: "#a1a1aa", fontSize: 8, fontFamily: "Times New Roman, serif" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `${v.toFixed(2)}%`}
                width={42}
              />
              <Tooltip
                contentStyle={{
                  background: "#ffffff",
                  border: "1px solid #e4e4e7",
                  borderRadius: 6,
                  fontSize: 10,
                  fontFamily: "Times New Roman, serif",
                  padding: "6px 10px",
                }}
                itemStyle={{ color: "#3f3f46" }}
                labelStyle={{ color: "#a1a1aa", marginBottom: 3 }}
                formatter={(v: number, name: string) => [`${v.toFixed(3)}%`, name]}
              />
              <Legend
                wrapperStyle={{ fontSize: 9, fontFamily: "Times New Roman, serif", paddingTop: 4 }}
                iconType="plainline"
                iconSize={12}
              />
              {/* Monday — dashed gray reference line */}
              <Line
                type="monotone"
                dataKey="Monday"
                stroke="#a1a1aa"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
                name={`Mon ${fmtDate(data?.mondayDate ?? "")}`}
              />
              {/* Latest — solid dark blue */}
              <Line
                type="monotone"
                dataKey="Latest"
                stroke="#1e3a8a"
                strokeWidth={2}
                dot={{ r: 2.5, fill: "#1e3a8a", strokeWidth: 0 }}
                connectNulls
                name={`Latest ${fmtDate(data?.latestDate ?? "")}`}
              />
            </LineChart>
          </ResponsiveContainer>

          {/* Summary strip */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1">
            {chartData
              .filter((r) => r.bps !== null)
              .map((r) => (
                <div key={r.tenor} className="flex items-baseline gap-1 text-xs">
                  <span className="text-zinc-500">{r.tenor}</span>
                  <span className="font-semibold" style={{ color: r.bps! > 0 ? "#059669" : r.bps! < 0 ? "#dc2626" : "#a1a1aa" }}>
                    {r.bps! > 0 ? "+" : ""}{r.bps}bp
                  </span>
                </div>
              ))}
            <span className="text-zinc-300 text-xs ml-auto">vs Mon open</span>
          </div>
        </>
      )}
    </section>
  );
}
