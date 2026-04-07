import { Redis } from "@upstash/redis";

// Types
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

interface Dashboard {
  metrics: {
    equities: EquityMetrics;
    rates: RateMetrics;
    fx: FxMetrics;
    positioning: Record<string, number>;
    prediction_markets: PredictionMarketMetrics;
    as_of_date: string;
  };
  commentary: {
    equities: {
      summary: string;
      tape_vs_story: string;
      so_what: string;
      actionable: string;
    };
    rates: {
      summary: string;
      policy_pricing: string;
      real_vs_nominal: string;
      so_what: string;
    };
    fx: {
      grid: { pair: string; move_pct: number; driver: string }[];
      cross_section_theme: string;
      misalignment: string;
      so_what: string;
    };
    prediction_markets: {
      summary: string;
      fed_read: string;
      divergence: string;
      so_what: string;
    };
    as_of_date: string;
  };
  as_of_date: string;
}

// Helpers
function chgColor(val: number | undefined) {
  if (val === undefined || isNaN(val)) return "text-zinc-400";
  return val > 0 ? "text-emerald-400" : val < 0 ? "text-red-400" : "text-zinc-400";
}

function fmt(val: number | undefined, decimals = 2, suffix = "") {
  if (val === undefined || isNaN(val)) return "—";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(decimals)}${suffix}`;
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="text-xs font-mono font-bold tracking-widest text-zinc-500 uppercase">
        {label}
      </span>
      <div className="flex-1 h-px bg-zinc-800" />
    </div>
  );
}

function MetricRow({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-zinc-800/60">
      <span className="text-xs text-zinc-500 font-mono">{label}</span>
      <span className="text-sm font-mono font-medium">
        {value}
        {sub && <span className="text-xs text-zinc-600 ml-1">{sub}</span>}
      </span>
    </div>
  );
}

function CommentaryBlock({ text }: { text: string }) {
  return (
    <p className="text-sm text-zinc-300 leading-relaxed mt-3">{text}</p>
  );
}

function TapeVsStory({ text }: { text: string }) {
  // Parses "Narrative: ...\nTape: ...\nRead: ..."
  const lines = text.split("\n").filter(Boolean);
  return (
    <div className="mt-3 rounded-md bg-zinc-900 border border-zinc-800 p-3 space-y-1.5">
      {lines.map((line, i) => {
        const [label, ...rest] = line.split(": ");
        return (
          <div key={i} className="flex gap-2 text-xs font-mono">
            <span className="text-zinc-600 w-20 shrink-0">{label}</span>
            <span className="text-zinc-300">{rest.join(": ")}</span>
          </div>
        );
      })}
    </div>
  );
}

function SoWhat({ text }: { text: string }) {
  return (
    <div className="mt-3 rounded-md bg-zinc-900/60 border-l-2 border-amber-500/60 pl-3 py-2">
      <span className="text-xs text-amber-500/80 font-mono uppercase tracking-wider">so what </span>
      <p className="text-sm text-zinc-200 mt-0.5">{text}</p>
    </div>
  );
}

function Actionable({ text }: { text: string }) {
  return (
    <div className="mt-2 rounded-md bg-zinc-900/40 border-l-2 border-blue-500/40 pl-3 py-2">
      <span className="text-xs text-blue-400/70 font-mono uppercase tracking-wider">watch </span>
      <p className="text-sm text-zinc-400 mt-0.5">{text}</p>
    </div>
  );
}

// Sections
function EquitiesSection({ m, c }: { m: EquityMetrics; c: Dashboard["commentary"]["equities"] }) {
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
            <MetricRow
              key={t}
              label={t}
              value={
                <span className={chgColor(m.week_chg_pct[t])}>
                  {fmt(m.week_chg_pct[t], 2, "% wow")}
                </span>
              }
              sub={m.levels[t] ? `@ ${m.levels[t].toFixed(2)}` : undefined}
            />
          ))}
        </div>
        <div>
          <MetricRow label="VIX" value={m.levels["VIX"]?.toFixed(1) ?? "—"} />
          <MetricRow
            label="RVol 21d"
            value={`${m.realized_vol_21d?.toFixed(1) ?? "—"}%`}
          />
          <MetricRow
            label="VIX − RVol"
            value={
              <span className={chgColor(m.vix_rv_spread)}>
                {fmt(m.vix_rv_spread, 1, " pts")}
              </span>
            }
          />
          <MetricRow
            label="EW ratio chg"
            value={
              <span className={chgColor(m.ew_ratio_chg_wow)}>
                {fmt(m.ew_ratio_chg_wow, 3)}
              </span>
            }
          />
        </div>
      </div>

      {/* Sector strip */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.entries(m.sector_returns_wow ?? {}).map(([t, v]) => (
          <div
            key={t}
            className={`px-2 py-0.5 rounded text-xs font-mono border ${
              v > 0
                ? "bg-emerald-950/40 border-emerald-800/40 text-emerald-400"
                : "bg-red-950/40 border-red-800/40 text-red-400"
            }`}
          >
            {SECTOR_LABELS[t] ?? t} {fmt(v, 1, "%")}
          </div>
        ))}
      </div>

      <CommentaryBlock text={c.summary} />
      {c.tape_vs_story && <TapeVsStory text={c.tape_vs_story} />}
      <SoWhat text={c.so_what} />
      {c.actionable && <Actionable text={c.actionable} />}
    </section>
  );
}

function RatesSection({ m, c }: { m: RateMetrics; c: Dashboard["commentary"]["rates"] }) {
  return (
    <section>
      <SectionHeader label="Rates" />
      <div className="grid grid-cols-2 gap-x-8">
        <div>
          {(["UST_2Y", "UST_5Y", "UST_10Y", "UST_30Y"] as const).map((k) => (
            <MetricRow
              key={k}
              label={k.replace("UST_", "")}
              value={
                <>
                  <span className="text-zinc-200">{m.levels[k]?.toFixed(2) ?? "—"}%</span>
                  <span className={`ml-2 text-xs ${chgColor(m.week_chg_bp[k])}`}>
                    {fmt(m.week_chg_bp[k], 0, "bp")}
                  </span>
                </>
              }
            />
          ))}
        </div>
        <div>
          <MetricRow
            label="2s10s"
            value={
              <span className={chgColor(m.curve_2s10s)}>
                {m.curve_2s10s?.toFixed(0) ?? "—"}bp
              </span>
            }
            sub={`${fmt(m.curve_chg_wow_bp, 0, "bp wow")}`}
          />
          <MetricRow label="5s30s" value={`${m.curve_5s30s?.toFixed(0) ?? "—"}bp`} />
          <MetricRow label="10Y real" value={`${m.real_10y?.toFixed(2) ?? "—"}%`} />
          <MetricRow label="10Y BEI" value={`${m.breakeven_10y?.toFixed(2) ?? "—"}%`} />
          <MetricRow
            label="10Y move: real"
            value={`${m.real_vs_nominal_split?.toFixed(0) ?? "—"}%`}
          />
        </div>
      </div>

      <CommentaryBlock text={c.summary} />
      <CommentaryBlock text={c.policy_pricing} />
      <CommentaryBlock text={c.real_vs_nominal} />
      <SoWhat text={c.so_what} />
    </section>
  );
}

function FxSection({ m, c }: { m: FxMetrics; c: Dashboard["commentary"]["fx"] }) {
  const FACTOR_COLORS: Record<string, string> = {
    growth_proxy: "text-blue-400",
    safe_haven:   "text-purple-400",
    tot_play:     "text-amber-400",
    carry:        "text-emerald-400",
  };

  return (
    <section>
      <SectionHeader label="G10 FX" />

      <div className="space-y-0">
        {(c.grid ?? []).map((row) => (
          <div
            key={row.pair}
            className="flex items-start gap-3 py-2 border-b border-zinc-800/60"
          >
            <div className="w-16 shrink-0">
              <span className="text-sm font-mono font-medium text-zinc-200">{row.pair}</span>
              <div className={`text-xs font-mono ${chgColor(row.move_pct)}`}>
                {fmt(row.move_pct, 2, "%")}
              </div>
            </div>
            <div className="flex-1">
              <span
                className={`text-xs font-mono ${
                  FACTOR_COLORS[m.factor_labels?.[row.pair] ?? ""] ?? "text-zinc-500"
                }`}
              >
                [{m.factor_labels?.[row.pair] ?? "—"}]
              </span>
              <p className="text-xs text-zinc-400 mt-0.5">{row.driver}</p>
            </div>
          </div>
        ))}
      </div>

      {c.cross_section_theme && (
        <div className="mt-3 text-xs text-zinc-400 font-mono border border-zinc-800 rounded px-3 py-2">
          <span className="text-zinc-600">theme </span>{c.cross_section_theme}
        </div>
      )}

      {c.misalignment && (
        <div className="mt-2 text-xs text-zinc-400 font-mono border border-amber-900/30 rounded px-3 py-2 bg-amber-950/10">
          <span className="text-amber-600/80">misalignment </span>{c.misalignment}
        </div>
      )}

      <SoWhat text={c.so_what} />
    </section>
  );
}

function PredictionMarketsSection({
  m,
  c,
}: {
  m: PredictionMarketMetrics;
  c: Dashboard["commentary"]["prediction_markets"];
}) {
  const TAG_COLORS: Record<string, string> = {
    economy:       "text-blue-400",
    fed_decisions: "text-purple-400",
    politics:      "text-amber-400",
  };

  const probColor = (p: number | null) => {
    if (p === null) return "text-zinc-400";
    if (p >= 0.7) return "text-emerald-400";
    if (p >= 0.4) return "text-yellow-400";
    return "text-red-400";
  };

  const fmtProb = (p: number | null) =>
    p !== null ? `${(p * 100).toFixed(0)}%` : "—";

  const fmtVol = (v: number | null) => {
    if (v === null) return "—";
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toFixed(0)}`;
  };

  const allMarkets = [
    ...(m.fed_markets ?? []),
    ...(m.top_markets ?? []).filter(
      (t) => !(m.fed_markets ?? []).some((f) => f.question === t.question)
    ),
  ].slice(0, 10);

  return (
    <section>
      <SectionHeader label="Prediction Markets · Polymarket" />

      {/* Market rows */}
      <div className="space-y-0">
        {allMarkets.map((mkt, i) => (
          <div
            key={i}
            className="flex items-center gap-3 py-2 border-b border-zinc-800/60"
          >
            {/* Probability pill */}
            <div className="w-12 shrink-0 text-center">
              <span className={`text-base font-mono font-bold ${probColor(mkt.yes_price)}`}>
                {fmtProb(mkt.yes_price)}
              </span>
            </div>

            {/* Question + meta */}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-zinc-200 leading-snug truncate">
                {mkt.question}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-xs font-mono ${TAG_COLORS[mkt.tag] ?? "text-zinc-600"}`}>
                  {mkt.tag?.replace("_", " ")}
                </span>
                <span className="text-zinc-700 text-xs">·</span>
                <span className="text-xs text-zinc-600 font-mono">
                  {fmtVol(mkt.volume_24h)} / 24h
                </span>
              </div>
            </div>

            {/* WoW change */}
            <div className="w-16 shrink-0 text-right">
              {mkt.wow_chg !== null && mkt.wow_chg !== undefined ? (
                <span className={`text-xs font-mono ${chgColor(mkt.wow_chg * 100)}`}>
                  {mkt.wow_chg > 0 ? "+" : ""}
                  {(mkt.wow_chg * 100).toFixed(0)}pp
                </span>
              ) : (
                <span className="text-xs text-zinc-700">—</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Biggest movers */}
      {(m.biggest_movers ?? []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {m.biggest_movers.map((mkt, i) => (
            <div
              key={i}
              className={`px-2 py-1 rounded text-xs font-mono border max-w-[280px] ${
                (mkt.wow_chg ?? 0) > 0
                  ? "bg-emerald-950/40 border-emerald-800/40 text-emerald-300"
                  : "bg-red-950/40 border-red-800/40 text-red-300"
              }`}
            >
              <span className="truncate block">
                {mkt.question.length > 40
                  ? mkt.question.slice(0, 40) + "…"
                  : mkt.question}
              </span>
              <span className="opacity-70">
                {fmtProb(mkt.yes_price)}{" "}
                {(mkt.wow_chg ?? 0) > 0 ? "↑" : "↓"}
                {Math.abs((mkt.wow_chg ?? 0) * 100).toFixed(0)}pp wow
              </span>
            </div>
          ))}
        </div>
      )}

      <CommentaryBlock text={c.summary} />
      <CommentaryBlock text={c.fed_read} />

      {c.divergence && (
        <div className="mt-2 rounded-md bg-zinc-900/40 border-l-2 border-violet-500/40 pl-3 py-2">
          <span className="text-xs text-violet-400/70 font-mono uppercase tracking-wider">
            divergence{" "}
          </span>
          <p className="text-sm text-zinc-400 mt-0.5">{c.divergence}</p>
        </div>
      )}

      <SoWhat text={c.so_what} />
    </section>
  );
}

// Page
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
    : null;

  return (
    <main className="min-h-screen">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-100">
            Market Dashboard
          </h1>
          <p className="text-xs text-zinc-600 font-mono mt-0.5">
            Weekly trader-note · updated every Friday close
          </p>
        </div>
        {asOf && (
          <span className="text-xs text-zinc-600 font-mono">{asOf}</span>
        )}
      </div>

      {!dashboard ? (
        <div className="flex items-center justify-center h-96 text-zinc-600 font-mono text-sm">
          No data yet — trigger /api/pipeline to run the first collection.
        </div>
      ) : (
        <div className="max-w-4xl mx-auto px-6 py-8 space-y-12">
          <EquitiesSection
            m={dashboard.metrics.equities}
            c={dashboard.commentary.equities}
          />
          <RatesSection
            m={dashboard.metrics.rates}
            c={dashboard.commentary.rates}
          />
          <FxSection
            m={dashboard.metrics.fx}
            c={dashboard.commentary.fx}
          />
          <PredictionMarketsSection
            m={dashboard.metrics.prediction_markets}
            c={dashboard.commentary.prediction_markets}
          />
        </div>
      )}
    </main>
  );
}
