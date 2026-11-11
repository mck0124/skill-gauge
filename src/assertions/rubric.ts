export function buildJudgePrompt(input: string, output: string, rubric: string): string {
  return [
    "You are a strict evaluator. Grade the RESPONSE against the RUBRIC.",
    'Reply with only JSON: {"score": <number 0..1>, "reason": "<one sentence>"}',
    "",
    "<rubric>",
    rubric,
    "</rubric>",
    "<input>",
    input,
    "</input>",
    "<response>",
    output,
    "</response>",
  ].join("\n");
}

export interface Verdict {
  score: number;
  reason: string;
}

/** Extracts the first JSON object containing a numeric `score`. Returns null if none. */
export function parseVerdict(text: string): Verdict | null {
  const matches = text.match(/\{[^{}]*\}/g) ?? [];
  for (const m of matches) {
    try {
      const obj = JSON.parse(m) as { score?: unknown; reason?: unknown };
      if (typeof obj.score === "number" && Number.isFinite(obj.score)) {
        return {
          score: Math.min(1, Math.max(0, obj.score)),
          reason: typeof obj.reason === "string" ? obj.reason : "",
        };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}
