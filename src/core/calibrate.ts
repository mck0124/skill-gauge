import { buildJudgePrompt, parseVerdict } from "../assertions/rubric.js";
import type { Calibration, CalibrationSample } from "../config/calibration.js";
import type { Provider } from "../providers/types.js";
import { mapPool } from "./pool.js";
import { stdDev } from "./stats.js";

export interface SampleScore {
  id: string;
  human: number;
  /** Mean judge score, or null when the sample could not be scored. */
  judge: number | null;
  /** Std-dev across repeated judge calls (judge self-consistency). */
  spread: number;
  error: string | null;
}

export interface Metrics {
  n: number;
  /** Mean |judge − human|. */
  mae: number;
  rmse: number;
  /** Mean (judge − human): positive means the judge is more lenient than the human. */
  bias: number;
  /** Share of samples with |judge − human| ≤ tolerance. */
  withinTolerance: number;
  /** Share of samples where judge and human land on the same side of the threshold. */
  agreement: number;
  /** Pearson r; null when undefined (n < 2 or zero variance). */
  correlation: number | null;
}

export interface CalibrationReport {
  name: string;
  threshold: number;
  tolerance: number;
  repeat: number;
  samples: SampleScore[];
  unscored: number;
  /** null when no sample could be scored. */
  metrics: Metrics | null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
// Float-safe comparison: 0.9 − 0.8 is 0.0999…, which must still count as "within 0.1".
const EPS = 1e-9;

export function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length < 2) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    const dx = x - mx;
    const dy = (ys[i] ?? 0) - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  });
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

export function computeMetrics(
  pairs: readonly { human: number; judge: number }[],
  threshold: number,
  tolerance: number,
): Metrics | null {
  if (pairs.length === 0) return null;
  const errors = pairs.map((p) => p.judge - p.human);
  return {
    n: pairs.length,
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(mean(errors.map((e) => e * e))),
    bias: mean(errors),
    withinTolerance: errors.filter((e) => Math.abs(e) <= tolerance + EPS).length / pairs.length,
    agreement:
      pairs.filter((p) => p.judge >= threshold === p.human >= threshold).length / pairs.length,
    correlation: pearson(
      pairs.map((p) => p.human),
      pairs.map((p) => p.judge),
    ),
  };
}

async function scoreSample(
  s: CalibrationSample,
  judge: Provider,
  repeat: number,
): Promise<SampleScore> {
  const scores: number[] = [];
  let error: string | null = null;
  for (let trial = 1; trial <= repeat; trial++) {
    try {
      const raw = await judge(buildJudgePrompt(s.input, s.output, s.rubric), {
        caseId: s.id,
        trial,
      });
      const verdict = parseVerdict(raw);
      if (verdict) scores.push(verdict.score);
      else error = "judge output had no {score} JSON";
    } catch (e) {
      error = (e as Error).message;
    }
  }
  // Fail closed: one bad judge call makes the whole sample unscored rather than
  // quietly averaging the rest, so the reported agreement is never flattered.
  if (error !== null || scores.length === 0) {
    return { id: s.id, human: s.human, judge: null, spread: 0, error: error ?? "no judge result" };
  }
  return { id: s.id, human: s.human, judge: mean(scores), spread: stdDev(scores), error: null };
}

export async function runCalibration(
  cal: Calibration,
  judge: Provider,
  onSample?: (s: SampleScore) => void,
): Promise<CalibrationReport> {
  const samples = await mapPool(cal.samples, cal.concurrency, async (s) => {
    const scored = await scoreSample(s, judge, cal.repeat);
    onSample?.(scored);
    return scored;
  });
  const pairs = samples.flatMap((s) =>
    s.judge === null ? [] : [{ human: s.human, judge: s.judge }],
  );
  return {
    name: cal.name,
    threshold: cal.threshold,
    tolerance: cal.tolerance,
    repeat: cal.repeat,
    samples,
    unscored: samples.length - pairs.length,
    metrics: computeMetrics(pairs, cal.threshold, cal.tolerance),
  };
}
