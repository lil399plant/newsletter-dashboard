"use client";

import { useState } from "react";
import PolymarketLive from "./components/PolymarketLive";

// ─── Types ────────────────────────────────────────────────────────────────────

interface EquityMetrics {
  levels: Record<string, number>;
  week_chg_pct: Record<string, number>;
  realized_vol_21d: number;
  vix_rv_spread: number;
  equal_weight_ratio: number;
  ew_ratio_chg_wow: number;
  sector_returns_wow: Record<string, number>;
  top_sector: string;
  bot_sector: string;
}

interface RateMetrics {
  levels: Record<string, number>;
  week_chg_bp: Record<string, number>;
  curve_2s10s: number;
  curve_5s30s: number;
  curve_chg_wow_bp: number;
  real_10y: number;
  breakeven_10y: number;
  real_vs_nominal_split: number;
}

interface FxMetrics {
  levels: Record<string, number>;
  week_chg_pct: Record<string, number>;
  factor_labels: Record<string, string>;
  carry_winners: string[];
}

interface PredictionMarket {
  question: string;
  yes_price: number | null;
  wow_chg: number | null;
  day_chg: number | null;
  volume_24h: number | null;
  volume: number | null;
  tag: string;
  end_date: string | null;
}

interface PredictionMarketMetrics {
  top_markets: PredictionMarket[];
  biggest_movers: PredictionMarket[];
  fed_markets: PredictionMarket[];
  total_volume_24h: number;
}

export interface Dashboard {
  metrics: {
    equities: EquityMetrics;
    rates: RateMetrics;
    fx: FxMetrics;
    positioning: Record<string, number>;
    prediction_markets: PredictionMarketMetrics;
    as_of_date: string;
  };
  commentary: {
    equities: { summary: string; tape_vs_story: string; so_what: string; actionable: string };
    rates: { summary: string; policy_pricing: string; real_vs_nominal: string; so_what: string };
    fx: { grid: { pair: string; move_pct: number; driver: string }[]; cross_section_theme: string; misalignment: string; so_what: string };
    prediction_markets: { summary: string; fed_read: string; divergence: string; so_what: string };
    as_of_date: string;
  };
  as_of_date: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function chgColor(val: number | undefined | null) {
  if (val == null || isNaN(val)) return "text-zinc-400";
  return val > 0 ? "text-emerald-700" : val < 0 ? "text-red-600" : "text-zinc-400";
}

function fmt(val: number | undefined | null, decimals = 2, suffix = "") {
  if (val == null || isNaN(val)) return "—";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(decimals)}${suffix}`;
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-xs font-bold tracking-widest text-blue-900 uppercase">{label}</span>
      <div className="flex-1 h-px bg-zinc-300" />
    </div>
  );
}

function MetricRow({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-zinc-200">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-sm font-medium text-zinc-800">
        {value}
        {sub && <span className="text-xs text-zinc-400 ml-1">{sub}</span>}
      </span>
    </div>
  );
}

function CommentaryBlock({ text }: { text: string }) {
  if (!text) return null;
  return <p className="text-sm text-zinc-700 leading-relaxed mt-3">{text}</p>;
}

function TapeVsStory({ text }: { text: string }) {
  const lines = text.split("\n").filter(Boolean);
  return (
    <div className="mt-3 rounded-md bg-zinc-50 border border-zinc-200 p-3 space-y-1.5">
      {lines.map((line, i) => {
        const [label, ...rest] = line.split(": ");
        return (
          <div key={i} className="flex gap-2 text-xs">
            <span className="text-zinc-400 w-20 shrink-0">{label}</span>
            <span className="text-zinc-700">{rest.join(": ")}</span>
          </div>
        );
      })}
    </div>
  );
}

function SoWhat({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="mt-3 rounded-md bg-amber-50 border-l-2 border-amber-500 pl-3 py-2">
      <span className="text-xs text-amber-700 uppercase tracking-wider">so what </span>
      <p className="text-sm text-zinc-700 mt-0.5">{text}</p>
    </div>
  );
}

function Actionable({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="mt-2 rounded-md bg-blue-50 border-l-2 border-blue-400 pl-3 py-2">
      <span className="text-xs text-blue-700 uppercase tracking-wider">watch </span>
      <p className="text-sm text-zinc-600 mt-0.5">{text}</p>
    </div>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function EquitiesSection({ m, c, showCommentary }: { m: EquityMetrics; c: Dashboard["commentary"]["equities"]; showCommentary: boolean }) {
  const SECTOR_LABELS: Record<string, string> = {
    XLK: "Tech", XLF: "Fins", XLE: "Energy", XLV: "Health",
    XLI: "Indus", XLY: "Disc", XLP: "Staples", XLU: "Utils",
    XLB: "Mats", XLRE: "RE", XLC: "Comm",
  };
  return (
    <section>
      <SectionHeader label="Equities" />
      <div className="grid grid-cols-2 gap-x-8">
        <div>
          {["SPY", "RSP", "QQQ", "IWM"].map((t) => (
            <MetricRow key={t} label={t}
              value={<span className={chgColor(m.week_chg_pct[t])}>{fmt(m.week_chg_pct[t], 2, "% wow")}</span>}
              sub={m.levels[t] ? `@ ${m.levels[t].toFixed(2)}` : undefined}
            />
          ))}
        </div>
        <div>
          <MetricRow label="VIX" value={m.levels["VIX"]?.toFixed(1) ?? "—"} />
          <MetricRow label="RVol 21d" value={`${m.realized_vol_21d?.toFixed(1) ?? "—"}%`} />
          <MetricRow label="VIX − RVol" value={<span className={chgColor(m.vix_rv_spread)}>{fmt(m.vix_rv_spread, 1, " pts")}</span>} />
          <MetricRow label="EW ratio chg" value={<span className={chgColor(m.ew_ratio_chg_wow)}>{fmt(m.ew_ratio_chg_wow, 3)}</span>} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.entries(m.sector_returns_wow ?? {}).map(([t, v]) => (
          <div key={t} className={`px-2 py-0.5 rounded text-xs border ${v > 0 ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "bg-red-50 border-red-300 text-red-600"}`}>
            {SECTOR_LABELS[t] ?? t} {fmt(v, 1, "%")}
          </div>
        ))}
      </div>
      {showCommentary && (
        <>
          <CommentaryBlock text={c.summary} />
          {c.tape_vs_story && <TapeVsStory text={c.tape_vs_story} />}
          <SoWhat text={c.so_what} />
          {c.actionable && <Actionable text={c.actionable} />}
        </>
      )}
    </section>
  );
}

function RatesSection({ m, c, showCommentary }: { m: RateMetrics; c: Dashboard["commentary"]["rates"]; showCommentary: boolean }) {
  return (
    <section>
      <SectionHeader label="Rates" />
      <div className="grid grid-cols-2 gap-x-8">
        <div>
          {(["UST_2Y", "UST_5Y", "UST_10Y", "UST_30Y"] as const).map((k) => (
            <MetricRow key={k} label={k.replace("UST_", "")}
              value={<>
                <span className="text-zinc-800">{m.levels[k]?.toFixed(2) ?? "—"}%</span>
                <span className={`ml-2 text-xs ${chgColor(m.week_chg_bp[k])}`}>{fmt(m.week_chg_bp[k], 0, "bp")}</span>
              </>}
            />
          ))}
        </div>
        <div>
          <MetricRow label="2s10s" value={<span className={chgColor(m.curve_2s10s)}>{m.curve_2s10s?.toFixed(0) ?? "—"}bp</span>} sub={`${fmt(m.curve_chg_wow_bp, 0, "bp wow")}`} />
          <MetricRow label="5s30s" value={`${m.curve_5s30s?.toFixed(0) ?? "—"}bp`} />
          <MetricRow label="10Y real" value={`${m.real_10y?.toFixed(2) ?? "—"}%`} />
          <MetricRow label="10Y BEI" value={`${m.breakeven_10y?.toFixed(2) ?? "—"}%`} />
          <MetricRow label="10Y move: real" value={`${m.real_vs_nominal_split?.toFixed(0) ?? "—"}%`} />
        </div>
      </div>
      {showCommentary && (
        <>
          <CommentaryBlock text={c.summary} />
          <CommentaryBlock text={c.policy_pricing} />
          <CommentaryBlock text={c.real_vs_nominal} />
          <SoWhat text={c.so_what} />
        </>
      )}
    </section>
  );
}

function FxSection({ m, c, showCommentary }: { m: FxMetrics; c: Dashboard["commentary"]["fx"]; showCommentary: boolean }) {
  const FACTOR_COLORS: Record<string, string> = {
    growth_proxy: "text-blue-700", safe_haven: "text-purple-700",
    tot_play: "text-amber-700", carry: "text-emerald-700",
  };
  return (
    <section>
      <SectionHeader label="G10 FX" />
      <div className="space-y-0">
        {(c.grid ?? []).map((row) => (
          <div key={row.pair} className="flex items-start gap-3 py-2 border-b border-zinc-200">
            <div className="w-16 shrink-0">
              <span className="text-sm font-medium text-zinc-800">{row.pair}</span>
              <div className={`text-xs ${chgColor(row.move_pct)}`}>{fmt(row.move_pct, 2, "%")}</div>
            </div>
            <div className="flex-1">
              <span className={`text-xs ${FACTOR_COLORS[m.factor_labels?.[row.pair] ?? ""] ?? "text-zinc-400"}`}>
                [{m.factor_labels?.[row.pair] ?? "—"}]
              </span>
              {showCommentary && <p className="text-xs text-zinc-500 mt-0.5">{row.driver}</p>}
            </div>
          </div>
        ))}
      </div>
      {showCommentary && (
        <>
          {c.cross_section_theme && (
            <div className="mt-3 text-xs text-zinc-600 border border-zinc-200 rounded px-3 py-2 bg-zinc-50">
              <span className="text-zinc-400">theme </span>{c.cross_section_theme}
            </div>
          )}
          {c.misalignment && (
            <div className="mt-2 text-xs text-zinc-600 border border-amber-200 rounded px-3 py-2 bg-amber-50">
              <span className="text-amber-600">misalignment </span>{c.misalignment}
            </div>
          )}
          <SoWhat text={c.so_what} />
        </>
      )}
    </section>
  );
}

// ─── Main client component ────────────────────────────────────────────────────

export default function DashboardClient({ dashboard, asOf }: { dashboard: Dashboard; asOf: string }) {
  const hasCommentary = Boolean((dashboard.commentary?.equities as any)?.summary);
  const [showCommentary, setShowCommentary] = useState(hasCommentary);

  return (
    <>
      <div className="border-b border-zinc-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-blue-900">Market Dashboard</h1>
          <p className="text-xs text-zinc-400 mt-0.5">Weekly trader-note · updated every Friday close</p>
        </div>
        <div className="flex items-center gap-4">
          {asOf && <span className="text-xs text-zinc-400">{asOf}</span>}
          <button
            onClick={() => setShowCommentary((v) => !v)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs border transition-colors ${
              showCommentary
                ? "bg-blue-50 border-blue-300 text-blue-800"
                : "bg-transparent border-zinc-300 text-zinc-400"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${showCommentary ? "bg-emerald-500" : "bg-zinc-300"}`} />
            commentary
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-12">
        <EquitiesSection m={dashboard.metrics.equities} c={dashboard.commentary.equities} showCommentary={showCommentary} />
        <RatesSection m={dashboard.metrics.rates} c={dashboard.commentary.rates} showCommentary={showCommentary} />
        <FxSection m={dashboard.metrics.fx} c={dashboard.commentary.fx} showCommentary={showCommentary} />
        <PolymarketLive />
      </div>
    </>
  );
}
