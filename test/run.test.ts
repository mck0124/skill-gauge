import { describe, expect, it } from "vitest";
import { parseSuite } from "../src/config/load.js";
import { compare } from "../src/core/compare.js";
import { mapPool } from "../src/core/pool.js";
import { runSuite } from "../src/core/run.js";
import { summarize } from "../src/core/stats.js";
import type { Provider } from "../src/providers/types.js";

const suite = parseSuite(`
name: demo
provider: { command: unused }
repeat: 4
cases:
  - id: stable
    input: hello
    assert: [{ type: contains, value: hello }]
  - id: flaky
    input: coin
    assert: [{ type: contains, value: heads }]
  - id: broken
    input: x
    assert: [{ type: json }]
`);

// Deterministic fake: "flaky" alternates by trial, "broken" throws.
const provider: Provider = (input, { caseId, trial }) => {
  if (caseId === "broken") return Promise.reject(new Error("boom"));
  if (caseId === "flaky") return Promise.resolve(trial % 2 ? "heads" : "tails");
  return Promise.resolve(input);
};

describe("runSuite + summarize", () => {
  it("measures pass rate, variance, flakiness and errors per case", async () => {
    const run = await runSuite(suite, { provider });
    expect(run.trials).toHaveLength(12);
    const s = summarize(run);
    const byId = Object.fromEntries(s.cases.map((c) => [c.caseId, c]));
    expect(byId.stable).toMatchObject({ passRate: 1, stdDev: 0, flaky: false });
    expect(byId.flaky).toMatchObject({ passRate: 0.5, stdDev: 0.5, flaky: true });
    expect(byId.broken).toMatchObject({ passRate: 0, errors: 4 });
    expect(s.passRate).toBeCloseTo(0.5);
  });

  it("filters cases and overrides repeat", async () => {
    const run = await runSuite(suite, { provider, only: ["stable"], repeat: 2 });
    expect(run.trials.map((t) => t.caseId)).toEqual(["stable", "stable"]);
  });
});

describe("compare", () => {
  it("flags regressions beyond threshold only", async () => {
    const base = summarize(await runSuite(suite, { provider }));
    const worse: Provider = (i, c) =>
      c.caseId === "stable" ? Promise.resolve("nope") : provider(i, c);
    const head = summarize(await runSuite(suite, { provider: worse }));
    const result = compare(base, head, 0.1);
    expect(result.regressions).toBe(1);
    expect(result.changes.find((c) => c.caseId === "stable")?.kind).toBe("regression");
    expect(compare(base, base).regressions).toBe(0);
  });
});

describe("mapPool", () => {
  it("respects the concurrency limit and keeps order", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });
});
