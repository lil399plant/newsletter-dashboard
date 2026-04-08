"use client";

import { useEffect, useState, useRef } from "react";

interface SectorMeta {
  label: string;
  ticker: string;
}

interface PEValues {
  trailingPE: number | null;
  forwardPE: number | null;
}

interface SectorRow extends SectorMeta {
  ret4w: number | null;
  ret52w: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  impliedEpsGrowth: number | null;
  erp: number | null;
  returnsLoading: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtPct(v: number | null, decimals = 1): string {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

function fmtPE(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}×`;
}

function retColor(v: number | null): string {
  if (v == null) return "text-zinc-400";
  return v > 0 ? "text-emerald-700" : v < 0 ? "text-red-600" : "text-zinc-400";
}

function growthColor(v: number | null): string {
  if (v == null) return "text-zinc-400";
  return v > 5 ? "text-emerald-700" : v > 0 ? "text-zinc-600" : "text-red-600";
}

function erpColor(v: number | null): string {
  if (v == null) return "text-zinc-400";
  return v > 1 ? "text-emerald-700" : v > 0 ? "text-zinc-600" : "text-red-600";
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

// ─── Inline PE editor cell ────────────────────────────────────────────────────

function PECell({
  value,
  editing,
  onStartEdit,
  onSave,
}: {
  value: number | null;
  editing: boolean;
  onStartEdit: () => void;
  onSave: (v: number | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  useEffect(() => {
    if (editing) {
      setDraft(value != null ? String(value) : "");
      setTimeout(() => inputRef.current?.select(), 0);
    }
  }, [editing, value]);

  function commit() {
    const num = parseFloat(draft);
    onSave(isNaN(num) || draft.trim() === "" ? null : num);
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") onSave(value); }}
        className="w-16 text-right bg-blue-50 border border-blue-300 rounded px-1 text-xs focus:outline-none"
        style={{ fontFamily: "Times New Roman, serif" }}
        placeholder="—"
      />
    );
  }

  return (
    <span
      onClick={onStartEdit}
      className="cursor-pointer hover:text-blue-600 transition-colors"
      title="Click to edit"
    >
      {fmtPE(value)}
    </span>
  );
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
  const [editingCell, setEditingCell] = useState<{ ticker: string; field: "trailingPE" | "forwardPE" } | null>(null);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(false);

  // Load sector metadata + 10yr yield + stored PE values
  useEffect(() => {
    Promise.all([
      fetch("/api/equity/sectors", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/equity/pe", { cache: "no-store" }).then((r) => r.json()),
    ]).then(([meta, peData]) => {
      setTenYrYield(meta.tenYrYield ?? null);
      const yield10 = meta.tenYrYield ?? null;

      const initial: SectorRow[] = (meta.sectors ?? []).map((s: SectorMeta) => {
        const pe: PEValues = peData[s.ticker] ?? { trailingPE: null, forwardPE: null };
        const impliedEpsGrowth =
          pe.trailingPE != null && pe.forwardPE != null && pe.forwardPE > 0
            ? (pe.trailingPE / pe.forwardPE - 1) * 100 : null;
        const erp =
          pe.forwardPE != null && yield10 != null
            ? parseFloat(((1 / pe.forwardPE) * 100 - yield10).toFixed(2)) : null;
        return { ...s, ...pe, impliedEpsGrowth, erp, ret4w: null, ret52w: null, returnsLoading: true };
      });
      setRows(initial);
      setMetaLoading(false);

      // Fetch returns client-side one ticker at a time
      (async () => {
        for (let i = 0; i < initial.length; i++) {
          const { ticker } = initial[i];
          const returns = await fetchReturns(ticker);
          setRows((prev) =>
            prev.map((r) => r.ticker === ticker ? { ...r, ...returns, returnsLoading: false } : r)
          );
          if (i < initial.length - 1) await new Promise((res) => setTimeout(res, 300));
        }
      })();
    }).catch(() => setMetaLoading(false));
  }, []);

  // Save updated PE to Redis and recompute derived fields
  async function savePE(ticker: string, field: "trailingPE" | "forwardPE", value: number | null) {
    setEditingCell(null);
    setSaving(true);

    setRows((prev) => prev.map((r) => {
      if (r.ticker !== ticker) return r;
      const updated = { ...r, [field]: value };
      updated.impliedEpsGrowth =
        updated.trailingPE != null && updated.forwardPE != null && updated.forwardPE > 0
          ? (updated.trailingPE / updated.forwardPE - 1) * 100 : null;
      updated.erp =
        updated.forwardPE != null && tenYrYield != null
          ? parseFloat(((1 / updated.forwardPE) * 100 - tenYrYield).toFixed(2)) : null;
      return updated;
    }));

    try {
      const currentRow = rows.find((r) => r.ticker === ticker);
      const payload = {
        [ticker]: {
          trailingPE: field === "trailingPE" ? value : currentRow?.trailingPE ?? null,
          forwardPE:  field === "forwardPE"  ? value : currentRow?.forwardPE  ?? null,
        }
      };
      await fetch("/api/equity/pe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      console.error("Failed to save PE:", e);
    } finally {
      setSaving(false);
    }
  }

  const allLoading = metaLoading || rows.length === 0;

  return (
    <section>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs font-bold tracking-widest text-blue-900 uppercase">Sector Fundamentals</span>
        <div className="flex-1 h-px bg-zinc-300" />
        {tenYrYield != null && (
          <span className="text-xs text-zinc-400">10yr {tenYrYield.toFixed(2)}%</span>
        )}
        {saving && <span className="text-xs text-zinc-300 animate-pulse">saving…</span>}
        <button
          onClick={() => { setEditMode((v) => !v); setEditingCell(null); }}
          className={`text-xs px-2 py-0.5 rounded border transition-colors ${
            editMode
              ? "bg-blue-50 border-blue-300 text-blue-700"
              : "border-zinc-200 text-zinc-400 hover:text-zinc-600"
          }`}
          style={{ fontFamily: "Times New Roman, serif" }}
        >
          {editMode ? "done" : "edit P/E"}
        </button>
        {allLoading && <span className="text-xs text-zinc-300 animate-pulse">loading…</span>}
      </div>

      {editMode && (
        <p className="text-xs text-zinc-400 mb-3 italic">
          Click any P/E cell to edit. Values are saved immediately and persist across sessions.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse" style={{ fontFamily: "Times New Roman, serif" }}>
          <thead>
            <tr className="border-b border-zinc-200">
              <Th>Sector</Th>
              <Th>ETF</Th>
              <Th title="Trailing 12-month P/E (click 'edit P/E' to set)">Trail P/E</Th>
              <Th title="Forward 12-month P/E (click 'edit P/E' to set)">Fwd P/E</Th>
              <Th title="Implied NTM EPS growth = Trailing P/E ÷ Forward P/E − 1">EPS Growth</Th>
              <Th title="Equity Risk Premium: earnings yield (1/Fwd P/E) minus 10yr Treasury yield">ERP</Th>
              <Th title="52-week total return">52W Ret</Th>
              <Th title="4-week total return (last 20 trading days)">4W Ret</Th>
            </tr>
          </thead>
          <tbody>
            {allLoading
              ? Array.from({ length: 12 }).map((_, i) => (
                  <tr key={i} className="border-b border-zinc-100">
                    {Array.from({ length: 8 }).map((_, j) => (
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
                    {/* Sector */}
                    <td className="py-2 pl-0 pr-3 text-left text-zinc-700 whitespace-nowrap" style={{ fontSize: 11 }}>
                      {row.label}
                    </td>

                    {/* ETF */}
                    <td className="py-2 px-3 text-right text-zinc-400 whitespace-nowrap" style={{ fontSize: 10 }}>
                      {row.ticker}
                    </td>

                    {/* Trailing P/E */}
                    <td className="py-2 px-3 text-right text-zinc-700 tabular-nums whitespace-nowrap" style={{ fontSize: 11 }}>
                      {editMode ? (
                        <PECell
                          value={row.trailingPE}
                          editing={editingCell?.ticker === row.ticker && editingCell?.field === "trailingPE"}
                          onStartEdit={() => setEditingCell({ ticker: row.ticker, field: "trailingPE" })}
                          onSave={(v) => savePE(row.ticker, "trailingPE", v)}
                        />
                      ) : fmtPE(row.trailingPE)}
                    </td>

                    {/* Forward P/E */}
                    <td className="py-2 px-3 text-right text-zinc-700 tabular-nums whitespace-nowrap" style={{ fontSize: 11 }}>
                      {editMode ? (
                        <PECell
                          value={row.forwardPE}
                          editing={editingCell?.ticker === row.ticker && editingCell?.field === "forwardPE"}
                          onStartEdit={() => setEditingCell({ ticker: row.ticker, field: "forwardPE" })}
                          onSave={(v) => savePE(row.ticker, "forwardPE", v)}
                        />
                      ) : fmtPE(row.forwardPE)}
                    </td>

                    {/* Implied EPS Growth */}
                    <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${growthColor(row.impliedEpsGrowth)}`} style={{ fontSize: 11 }}>
                      {fmtPct(row.impliedEpsGrowth)}
                    </td>

                    {/* ERP */}
                    <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${erpColor(row.erp)}`} style={{ fontSize: 11 }}>
                      {fmtPct(row.erp, 2)}
                    </td>

                    {/* 52W Return */}
                    <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${retColor(row.ret52w)}`} style={{ fontSize: 11 }}>
                      {row.returnsLoading
                        ? <span className="inline-block w-10 h-3 bg-zinc-100 rounded animate-pulse" />
                        : fmtPct(row.ret52w)}
                    </td>

                    {/* 4W Return */}
                    <td className={`py-2 px-3 text-right tabular-nums whitespace-nowrap font-medium ${retColor(row.ret4w)}`} style={{ fontSize: 11 }}>
                      {row.returnsLoading
                        ? <span className="inline-block w-10 h-3 bg-zinc-100 rounded animate-pulse" />
                        : fmtPct(row.ret4w)}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
