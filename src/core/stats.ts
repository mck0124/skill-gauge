import type { RunRecord } from "./types.js";

export interface CaseSummary {
  caseId: string;
  trials: number;
  passRate: number;
  meanScore: number;
  /** Population standard deviation of trial scores. */
  stdDev: number;
  /** Passed in some trials and failed in others. */
  flaky: boolean;
  errors: number;
  meanDurationMs: number;
}

export interface RunSummary {
  suite: string;
  cases: CaseSummary[];
  passRate: number;
  meanScore: number;
  flakyCount: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function summarize(run: RunRecord): RunSummary {
  const byCase = new Map<string, RunRecord["trials"]>();
  for (const t of run.trials) {
    const list = byCase.get(t.caseId) ?? [];
    list.push(t);
    byCase.set(t.caseId, list);
  }
  const cases = [...byCase].map(([caseId, ts]): CaseSummary => {
    const passed = ts.filter((t) => t.pass).length;
    const scores = ts.map((t) => t.score);
    return {
      caseId,
      trials: ts.length,
      passRate: passed / ts.length,
      meanScore: mean(scores),
      stdDev: stdDev(scores),
      flaky: passed > 0 && passed < ts.length,
      errors: ts.filter((t) => t.error !== null).length,
      meanDurationMs: Math.round(mean(ts.map((t) => t.durationMs))),
    };
  });
  return {
    suite: run.suite,
    cases,
    passRate: mean(cases.map((c) => c.passRate)),
    meanScore: mean(cases.map((c) => c.meanScore)),
    flakyCount: cases.filter((c) => c.flaky).length,
  };
}
