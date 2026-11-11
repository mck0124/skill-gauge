import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { commandProvider } from "../src/providers/command.js";
import { compare } from "../src/core/compare.js";
import type { RunSummary } from "../src/core/stats.js";

const cfg = (command: string, timeoutMs = 5000) => ({ command, timeoutMs, env: {} });
const cwd = resolve(".");
const ctx = { caseId: "c1", trial: 2 };

describe("commandProvider", () => {
  it("pipes input to stdin and returns trimmed stdout", async () => {
    expect(await commandProvider(cfg("cat"), cwd)("hi\n", ctx)).toBe("hi");
  });

  it("exposes case id and trial via env", async () => {
    const out = await commandProvider(cfg("echo $SKILL_GAUGE_CASE_ID-$SKILL_GAUGE_TRIAL"), cwd)(
      "",
      ctx,
    );
    expect(out).toBe("c1-2");
  });

  it("includes exit code and stderr tail on failure", async () => {
    await expect(commandProvider(cfg("echo oops >&2; exit 4"), cwd)("", ctx)).rejects.toThrow(
      /code 4: oops/,
    );
  });

  it("kills the command on timeout", async () => {
    await expect(commandProvider(cfg("sleep 5", 100), cwd)("", ctx)).rejects.toThrow(/timed out/);
  });
});

describe("compare added/removed", () => {
  const sum = (ids: string[]): RunSummary => ({
    suite: "s",
    passRate: 1,
    meanScore: 1,
    flakyCount: 0,
    cases: ids.map((caseId) => ({
      caseId,
      trials: 1,
      passRate: 1,
      meanScore: 1,
      stdDev: 0,
      flaky: false,
      errors: 0,
      meanDurationMs: 0,
    })),
  });

  it("reports added and removed cases without counting them as regressions", () => {
    const r = compare(sum(["a", "b"]), sum(["b", "c"]));
    expect(r.changes.map((c) => [c.caseId, c.kind])).toEqual([
      ["a", "removed"],
      ["b", "unchanged"],
      ["c", "added"],
    ]);
    expect(r.regressions).toBe(0);
  });
});
