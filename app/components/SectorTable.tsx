"use client";

import { useEffect, useState } from "react";

interface SectorRow {
  label: string;
  ticker: string;
  trailingPE: number | null;
  forwardPE: number | null;
  impliedEpsGrowth: number | null;
  erp: number | null;
  profitMargin: number | null;
  ret52w: number | null;
  ret4w: number | null;
}

interface SectorData {
  rows: SectorRow[];
  tenYrYield: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPE(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}×`;
}

function fmtPct(v: number | null, decimals = 1): string {
  if (v == null) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(decimals)}%`;
}

function retColor(v: number | null): string {
  if (v == null) return "text-zinc-400";
  return v > 0 ? "text-emerald-700" : v < 0 ? "text-red-600" : "text-zinc-400";
}

function erpColor(v: number | null): string {
  if (v == null) return "text-zinc-400";
  return v > 1 ? "text-emerald-700" : v > 0 ? "text-zinc-600" : "text-red-600";
}

function growthColor(v: number | null): string {
  if (v == null) return "text-zinc-400";
  return v > 5 ? "text-emerald-700" : v > 0 ? "text-zinc-600" : "text-red-600";
}

// ─── Column header ────────────────────────────────────────────────────────────

function Th({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <th
      title={title}
      className="py-2 px-3 text-right text-zinc-400 font-normal whitespace-nowrap first:text-left first:pl-0"
      style={{ fontSize: 9, letterSpacing: "0.06em", fontFamily: "Times New Roman, serif" }}
    >
      {children}
    </th>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SectorTable() {
  const [data, setData] = useState<SectorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/equity/sectors", { cache: "no-store" });
        if (!res.ok) throw new Error(`API ${res.status}`);
        const json = await res.json();
        setData(json);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <section>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-bold tracking-widest text-blue-900 uppercase">Sector Fundamentals</span>
        <div className="flex-1 h-px bg-zinc-300" />
        {data?.tenYrYield != null && !loading && (
          <span className="text-xs text-zinc-400">10yr {data.tenYrYield.toFixed(2)}%</span>
        )}
        {loading && <span className="text-xs text-zinc-300 animate-pulse">loading…</span>}
      </div>

      {error ? (
        <div className="text-xs text-red-500 px-1">{error}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse" style={{ fontFamily: "Times New Roman, serif" }}>
            <thead>
              <tr className="border-b border-zinc-200">
                <Th>Sector</Th>
                <Th>ETF</Th>
                <Th title="Trailing 12-month P/E">Trail P/E</Th>
                <Th title="Forward 12-month P/E">Fwd P/E</Th>
                <Th title="Implied NTM EPS growth = Trailing P/E ÷ Forward P/E − 1">Impl. EPS Growth</Th>
                <Th title="Equity Risk Premium: earnings yield (1/Fwd P/E) minus 10yr Treasury yield">ERP</Th>
                <Th title="Net profit margin">Margin</Th>
                <Th title="52-week total return">52W Ret</Th>
                <Th title="4-week total return">4W Ret</Th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 12 }).map((_, i) => (
                    <tr key={i} className="border-b border-zinc-100">
                      {Array.from({ length: 9 }).map((_, j) => (
                        <td key={j} className="py-2 px-3">
                          <div className="h-3 bg-zinc-100 rounded animate-pulse w-12" />
                        </td>
                      ))}
                    </tr>
                  ))
                : data?.rows.map((row, i) => (
                    <tr
                      key={row.ticker}
                      className={`border-b border-zinc-100 hover:bg-zinc-50 transition-colors ${i === 0 ? "font-semibold" : ""}`}
                    >
                      {/* Sector name */}
                      <td
                        className="py-2 pl-0 pr-3 text-left text-zinc-700 whitespace-nowrap"
                        style={{ fontSize: 11 }}
                      >
                        {row.label}
                      </td>

                      {/* ETF ticker */}
                      <td
                        className="py-2 px-3 text-right text-zinc-400 whitespace-nowrap"
                        style={{ fontSize: 10 }}
                      >
                        {row.ticker}
                      </td>

                      {/* Trailing P/E */}
                      <td
                        className="py-2 px-3 text-right text-zinc-700 tabular-nums whitespace-nowrap"
                        style={{ fontSize: 11 }}
                      >
                        {fmtPE(row.trailingPE)}
                      </td>

                      {/* Forward P/E */}
                      <td
                        className="py-2 px-3 text-right text-zinc-700 tabular-nums whitespace-nowrap"
                        style={{ fontSize: 11 }}
                      >
                        {fmtPE(row.forwardPE)}
                      </td>

                      {/* Implied EPS growth */}
                      <td
                        className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${growthColor(row.impliedEpsGrowth)}`}
                        style={{ fontSize: 11 }}
                      >
                        {fmtPct(row.impliedEpsGrowth)}
                      </td>

                      {/* ERP */}
                      <td
                        className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${erpColor(row.erp)}`}
                        style={{ fontSize: 11 }}
                      >
                        {fmtPct(row.erp, 2)}
                      </td>

                      {/* Profit margin */}
                      <td
                        className="py-2 px-3 text-right text-zinc-600 tabular-nums whitespace-nowrap"
                        style={{ fontSize: 11 }}
                      >
                        {row.profitMargin != null ? `${(row.profitMargin * 100).toFixed(1)}%` : "—"}
                      </td>

                      {/* 52W return */}
                      <td
                        className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${retColor(row.ret52w != null ? row.ret52w * 100 : null)}`}
                        style={{ fontSize: 11 }}
                      >
                        {row.ret52w != null ? fmtPct(row.ret52w * 100) : "—"}
                      </td>

                      {/* 4W return */}
                      <td
                        className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${retColor(row.ret4w)}`}
                        style={{ fontSize: 11 }}
                      >
                        {fmtPct(row.ret4w)}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
