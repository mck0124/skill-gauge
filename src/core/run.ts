import type { Case, Suite } from "../config/schema.js";
import { evaluateAssertion, weightedScore } from "../assertions/evaluate.js";
import type { Provider } from "../providers/types.js";
import { mapPool } from "./pool.js";
import type { RunRecord, TrialResult } from "./types.js";

export interface RunOptions {
  provider: Provider;
  judge?: Provider | undefined;
  /** Restrict to case ids. */
  only?: readonly string[] | undefined;
  repeat?: number | undefined;
  onTrial?: ((t: TrialResult) => void) | undefined;
  now?: () => Date;
}

async function runTrial(c: Case, trial: number, opts: RunOptions): Promise<TrialResult> {
  const ctx = { caseId: c.id, trial };
  const started = performance.now();
  let output: string;
  try {
    output = await opts.provider(c.input, ctx);
  } catch (e) {
    return {
      caseId: c.id,
      trial,
      output: null,
      error: (e as Error).message,
      durationMs: Math.round(performance.now() - started),
      assertions: [],
      pass: false,
      score: 0,
    };
  }
  const durationMs = Math.round(performance.now() - started);
  const assertions = [];
  for (const a of c.assert) {
    assertions.push(
      await evaluateAssertion(a, output, { ...ctx, input: c.input, judge: opts.judge }),
    );
  }
  return {
    caseId: c.id,
    trial,
    output,
    error: null,
    durationMs,
    assertions,
    pass: assertions.every((r) => r.pass),
    score: weightedScore(assertions),
  };
}

export async function runSuite(suite: Suite, opts: RunOptions): Promise<RunRecord> {
  const now = opts.now ?? (() => new Date());
  const repeat = opts.repeat ?? suite.repeat;
  const cases = opts.only ? suite.cases.filter((c) => opts.only?.includes(c.id)) : suite.cases;
  const jobs = cases.flatMap((c) => Array.from({ length: repeat }, (_, t) => ({ c, t: t + 1 })));
  const startedAt = now().toISOString();
  const trials = await mapPool(jobs, suite.concurrency, async ({ c, t }) => {
    const result = await runTrial(c, t, opts);
    opts.onTrial?.(result);
    return result;
  });
  return {
    version: 1,
    suite: suite.name,
    startedAt,
    finishedAt: now().toISOString(),
    repeat,
    trials,
  };
}
