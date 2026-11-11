import type { CalibrationReport } from "../core/calibrate.js";
import type { Comparison } from "../core/compare.js";
import type { RunSummary } from "../core/stats.js";

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const num = (x: number) => x.toFixed(2);
const signed = (x: number, f: (n: number) => string) => (x > 0 ? "+" : "") + f(x);

export function formatSummary(s: RunSummary): string {
  const rows = s.cases.map((c) => [
    c.caseId,
    pct(c.passRate),
    num(c.meanScore),
    num(c.stdDev),
    c.flaky ? "flaky" : c.errors > 0 ? `${c.errors} err` : "",
    `${c.meanDurationMs}ms`,
  ]);
  const body = table(["case", "pass", "score", "σ", "note", "avg time"], rows);
  const footer = `\n${s.suite}: pass ${pct(s.passRate)} · score ${num(s.meanScore)} · flaky ${s.flakyCount}/${s.cases.length}`;
  return body + footer;
}

export function formatComparison(c: Comparison): string {
  const rows = c.changes
    .filter((x) => x.kind !== "unchanged")
    .map((x) => [x.caseId, x.kind, signed(x.passRateDelta, pct), signed(x.scoreDelta, num)]);
  const body = rows.length
    ? table(["case", "change", "Δpass", "Δscore"], rows)
    : "no significant changes";
  return `${body}\n\noverall: Δpass ${signed(c.passRateDelta, pct)} · Δscore ${signed(c.scoreDelta, num)} · regressions ${c.regressions}`;
}

export function formatCalibration(r: CalibrationReport): string {
  const showSpread = r.repeat > 1;
  const err = (s: CalibrationReport["samples"][number]) =>
    s.judge === null ? Number.POSITIVE_INFINITY : Math.abs(s.judge - s.human);
  // Worst disagreements first; unscored samples sink to the top so they are not missed.
  const sorted = [...r.samples].sort((a, b) => err(b) - err(a));
  const headers = ["sample", "human", "judge", "error", ...(showSpread ? ["σ"] : []), "note"];
  const rows = sorted.map((s) => [
    s.id,
    num(s.human),
    s.judge === null ? "–" : num(s.judge),
    s.judge === null ? "–" : signed(s.judge - s.human, num),
    ...(showSpread ? [s.judge === null ? "–" : num(s.spread)] : []),
    s.error ?? "",
  ]);
  const m = r.metrics;
  const summary = m
    ? [
        `MAE ${num(m.mae)} · RMSE ${num(m.rmse)} · bias ${signed(m.bias, num)} (+ = judge more lenient than human)`,
        `within ±${r.tolerance}: ${pct(m.withinTolerance)} · agreement @${r.threshold}: ${pct(m.agreement)} · r ${m.correlation === null ? "n/a" : num(m.correlation)}`,
      ].join("\n")
    : "no sample could be scored";
  const warn =
    r.unscored > 0
      ? `\n⚠ ${r.unscored}/${r.samples.length} sample(s) unscored and excluded from the metrics above`
      : "";
  return `${table(headers, rows)}\n\n${r.name}: ${summary}${warn}`;
}
