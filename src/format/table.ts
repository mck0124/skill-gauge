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
