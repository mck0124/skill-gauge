import type { RunSummary } from "./stats.js";

export type ChangeKind = "regression" | "improvement" | "unchanged" | "added" | "removed";

export interface CaseChange {
  caseId: string;
  kind: ChangeKind;
  passRateDelta: number;
  scoreDelta: number;
}

export interface Comparison {
  changes: CaseChange[];
  regressions: number;
  passRateDelta: number;
  scoreDelta: number;
}

/**
 * Compares two summaries case by case. A change counts only when the pass-rate
 * or mean-score delta exceeds `threshold`, so run-to-run noise is not flagged.
 */
export function compare(base: RunSummary, head: RunSummary, threshold = 0.1): Comparison {
  const baseMap = new Map(base.cases.map((c) => [c.caseId, c]));
  const headMap = new Map(head.cases.map((c) => [c.caseId, c]));
  const ids = [...new Set([...baseMap.keys(), ...headMap.keys()])].sort();

  const changes = ids.map((caseId): CaseChange => {
    const b = baseMap.get(caseId);
    const h = headMap.get(caseId);
    if (!b) return { caseId, kind: "added", passRateDelta: 0, scoreDelta: 0 };
    if (!h) return { caseId, kind: "removed", passRateDelta: 0, scoreDelta: 0 };
    const passRateDelta = h.passRate - b.passRate;
    const scoreDelta = h.meanScore - b.meanScore;
    const worst = Math.min(passRateDelta, scoreDelta);
    const best = Math.max(passRateDelta, scoreDelta);
    const kind: ChangeKind =
      worst < -threshold ? "regression" : best > threshold ? "improvement" : "unchanged";
    return { caseId, kind, passRateDelta, scoreDelta };
  });

  return {
    changes,
    regressions: changes.filter((c) => c.kind === "regression").length,
    passRateDelta: head.passRate - base.passRate,
    scoreDelta: head.meanScore - base.meanScore,
  };
}
