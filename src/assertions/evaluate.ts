import type { Assertion } from "../config/schema.js";
import type { AssertionResult } from "../core/types.js";
import type { Provider, ProviderContext } from "../providers/types.js";
import { buildJudgePrompt, parseVerdict } from "./rubric.js";

export interface EvalContext extends ProviderContext {
  input: string;
  judge: Provider | undefined;
}

function binary(a: Assertion, pass: boolean, reason: string): AssertionResult {
  return { type: a.type, pass, score: pass ? 1 : 0, weight: a.weight, reason };
}

const fold = (s: string, ignoreCase: boolean) => (ignoreCase ? s.toLowerCase() : s);

export async function evaluateAssertion(
  a: Assertion,
  output: string,
  ctx: EvalContext,
): Promise<AssertionResult> {
  switch (a.type) {
    case "contains": {
      const ok = fold(output, a.ignoreCase).includes(fold(a.value, a.ignoreCase));
      return binary(a, ok, ok ? "found" : `missing "${a.value}"`);
    }
    case "not-contains": {
      const ok = !fold(output, a.ignoreCase).includes(fold(a.value, a.ignoreCase));
      return binary(a, ok, ok ? "absent" : `unexpected "${a.value}"`);
    }
    case "regex": {
      const ok = new RegExp(a.pattern, a.flags).test(output);
      return binary(a, ok, ok ? "matched" : `no match for /${a.pattern}/${a.flags}`);
    }
    case "max-length": {
      const ok = output.length <= a.value;
      return binary(a, ok, `${output.length}/${a.value} chars`);
    }
    case "json": {
      try {
        JSON.parse(output);
        return binary(a, true, "valid JSON");
      } catch (e) {
        return binary(a, false, `invalid JSON: ${(e as Error).message}`);
      }
    }
    case "llm-rubric": {
      if (!ctx.judge) return binary(a, false, "no judge configured");
      let raw: string;
      try {
        raw = await ctx.judge(buildJudgePrompt(ctx.input, output, a.rubric), ctx);
      } catch (e) {
        return binary(a, false, `judge failed: ${(e as Error).message}`);
      }
      const verdict = parseVerdict(raw);
      if (!verdict) return binary(a, false, "judge output had no {score} JSON");
      return {
        type: a.type,
        pass: verdict.score >= a.threshold,
        score: verdict.score,
        weight: a.weight,
        reason: `${verdict.score.toFixed(2)} (≥${a.threshold}) ${verdict.reason}`.trim(),
      };
    }
  }
}

/** Weighted mean of assertion scores; 0 when empty. */
export function weightedScore(results: AssertionResult[]): number {
  const total = results.reduce((s, r) => s + r.weight, 0);
  return total === 0 ? 0 : results.reduce((s, r) => s + r.score * r.weight, 0) / total;
}
