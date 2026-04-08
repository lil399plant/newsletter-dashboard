"use client";

import { useEffect, useState } from "react";

interface SectorMeta {
  label: string;
  ticker: string;
}

interface SectorRow extends SectorMeta {
  ret4w: number | null;
  ret52w: number | null;
  loading: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(v: number | null, decimals = 1): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

function retColor(v: number | null): string {
  if (v == null) return "text-zinc-400";
  return v > 0 ? "text-emerald-700" : v < 0 ? "text-red-600" : "text-zinc-400";
}

function oneYearAgo(): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

async function fetchReturns(ticker: string): Promise<{ ret4w: number | null; ret52w: number | null }> {
  try {
    const res = await fetch(`/api/equity/history?ticker=${encodeURIComponent(ticker)}&startDate=${oneYearAgo()}`, { cache: "no-store" });
    if (!res.ok) return { ret4w: null, ret52w: null };
    const data = await res.json();
    const rows: { date: string; close: number }[] = data.rows ?? [];
    if (rows.length < 2) return { ret4w: null, ret52w: null };
    const last = rows[rows.length - 1].close;
    const ret52w = (last / rows[0].close - 1) * 100;
    const start4w = rows[Math.max(0, rows.length - 20)].close;
    const ret4w = (last / start4w - 1) * 100;
    return { ret4w, ret52w };
  } catch {
    return { ret4w: null, ret52w: null };
  }
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
  const [tenYrYield, setTenYrYield] = useState<number | null>(null);
  const [rows, setRows] = useState<SectorRow[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);

  // Step 1: fetch sector list + 10yr yield from server
  useEffect(() => {
    fetch("/api/equity/sectors", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        setTenYrYield(data.tenYrYield ?? null);
        const initial: SectorRow[] = (data.sectors ?? []).map((s: SectorMeta) => ({
          ...s, ret4w: null, ret52w: null, loading: true,
        }));
        setRows(initial);
        setMetaLoading(false);

        // Step 2: fetch returns client-side for each ticker, one at a time
        (async () => {
          for (let i = 0; i < initial.length; i++) {
            const { ticker } = initial[i];
            const returns = await fetchReturns(ticker);
            setRows((prev) =>
              prev.map((r) => r.ticker === ticker ? { ...r, ...returns, loading: false } : r)
            );
            // Small delay between requests so we don't hammer Yahoo
            if (i < initial.length - 1) await new Promise((res) => setTimeout(res, 300));
          }
        })();
      })
      .catch(() => setMetaLoading(false));
  }, []);

  const allLoading = metaLoading || rows.length === 0;

  return (
    <section>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-bold tracking-widest text-blue-900 uppercase">Sector Returns</span>
        <div className="flex-1 h-px bg-zinc-300" />
        {tenYrYield != null && (
          <span className="text-xs text-zinc-400">10yr {tenYrYield.toFixed(2)}%</span>
        )}
        {allLoading && <span className="text-xs text-zinc-300 animate-pulse">loading…</span>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ fontFamily: "Times New Roman, serif" }}>
          <thead>
            <tr className="border-b border-zinc-200">
              <Th>Sector</Th>
              <Th>ETF</Th>
              <Th title="52-week total return">52W Return</Th>
              <Th title="4-week total return (approx. last 20 trading days)">4W Return</Th>
            </tr>
          </thead>
          <tbody>
            {allLoading
              ? Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i} className="border-b border-zinc-100">
                    {Array.from({ length: 4 }).map((_, j) => (
                      <td key={j} className="py-2 px-3">
                        <div className="h-3 bg-zinc-100 rounded animate-pulse w-14" />
                      </td>
                    ))}
                  </tr>
                ))
              : rows.map((row, i) => (
                  <tr
                    key={row.ticker}
                    className={`border-b border-zinc-100 hover:bg-zinc-50 transition-colors ${i === 0 ? "font-semibold" : ""}`}
                  >
                    <td className="py-2 pl-0 pr-3 text-left text-zinc-700 whitespace-nowrap" style={{ fontSize: 11 }}>
                      {row.label}
                    </td>
                    <td className="py-2 px-3 text-right text-zinc-400 whitespace-nowrap" style={{ fontSize: 10 }}>
                      {row.ticker}
                    </td>
                    <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${retColor(row.ret52w)}`} style={{ fontSize: 11 }}>
                      {row.loading ? <span className="inline-block w-10 h-3 bg-zinc-100 rounded animate-pulse" /> : fmtPct(row.ret52w)}
                    </td>
                    <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${retColor(row.ret4w)}`} style={{ fontSize: 11 }}>
                      {row.loading ? <span className="inline-block w-10 h-3 bg-zinc-100 rounded animate-pulse" /> : fmtPct(row.ret4w)}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
