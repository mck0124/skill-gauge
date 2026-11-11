import { describe, expect, it } from "vitest";
import { evaluateAssertion, weightedScore } from "../src/assertions/evaluate.js";
import { parseVerdict } from "../src/assertions/rubric.js";
import { assertionSchema } from "../src/config/schema.js";

const ctx = { caseId: "c", trial: 1, input: "in", judge: undefined };
const check = (raw: unknown, output: string, judge?: (p: string) => Promise<string>) =>
  evaluateAssertion(assertionSchema.parse(raw), output, { ...ctx, judge });

describe("evaluateAssertion", () => {
  it.each([
    [{ type: "contains", value: "Fix" }, "fix bug", false],
    [{ type: "contains", value: "Fix", ignoreCase: true }, "fix bug", true],
    [{ type: "not-contains", value: "TODO" }, "done", true],
    [{ type: "regex", pattern: "^feat\\(" }, "feat(cli): x", true],
    [{ type: "max-length", value: 3 }, "abcd", false],
    [{ type: "json" }, '{"a":1}', true],
    [{ type: "json" }, "{a:1}", false],
  ])("%j on %j → %s", async (raw, output, pass) => {
    expect((await check(raw, output)).pass).toBe(pass);
  });

  it("uses judge score against threshold", async () => {
    const r = await check({ type: "llm-rubric", rubric: "r", threshold: 0.8 }, "out", () =>
      Promise.resolve('Sure! {"score": 0.75, "reason": "close"}'),
    );
    expect(r).toMatchObject({ pass: false, score: 0.75 });
  });

  it("fails closed when the judge errors or returns garbage", async () => {
    const bad = await check({ type: "llm-rubric", rubric: "r" }, "o", () => Promise.resolve("??"));
    const err = await check({ type: "llm-rubric", rubric: "r" }, "o", () =>
      Promise.reject(new Error("down")),
    );
    expect(bad.pass).toBe(false);
    expect(err.reason).toContain("down");
  });
});

describe("parseVerdict", () => {
  it("clamps score and skips non-score objects", () => {
    expect(parseVerdict('{"x":1} then {"score": 1.4}')).toEqual({ score: 1, reason: "" });
    expect(parseVerdict('{"score":"high"}')).toBeNull();
  });
});

describe("weightedScore", () => {
  it("weights assertions", () => {
    const r = (score: number, weight: number) => ({
      type: "t",
      pass: true,
      reason: "",
      score,
      weight,
    });
    expect(weightedScore([r(1, 3), r(0, 1)])).toBe(0.75);
    expect(weightedScore([])).toBe(0);
  });
});
