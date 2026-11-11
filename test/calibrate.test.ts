import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, parseCalibration } from "../src/config/load.js";
import { computeMetrics, pearson, runCalibration } from "../src/core/calibrate.js";
import { formatCalibration } from "../src/format/table.js";
import { EXIT, main } from "../src/main.js";
import type { Provider } from "../src/providers/types.js";

const yaml = (samples: string, extra = "") => `
name: cal
judge: { command: unused }
${extra}
samples:
${samples}`;
const sample = (id: string, output: string, human: number) =>
  `  - { id: ${id}, input: q, output: "${output}", rubric: r, human: ${human} }\n`;

describe("computeMetrics", () => {
  it("computes MAE, RMSE, bias, tolerance, agreement and correlation", () => {
    const m = computeMetrics(
      [
        { human: 1, judge: 0.9 }, // err −0.1
        { human: 0.5, judge: 0.7 }, // err +0.2
        { human: 0, judge: 0.1 }, // err +0.1
        { human: 0.8, judge: 0.2 }, // err −0.6 (disagrees at 0.7)
      ],
      0.7,
      0.1,
    );
    expect(m?.n).toBe(4);
    expect(m?.mae).toBeCloseTo(0.25);
    expect(m?.rmse).toBeCloseTo(Math.sqrt((0.01 + 0.04 + 0.01 + 0.36) / 4));
    expect(m?.bias).toBeCloseTo(-0.1);
    expect(m?.withinTolerance).toBeCloseTo(0.5); // −0.1 and +0.1 only, despite float error
    expect(m?.agreement).toBeCloseTo(0.5); // 1/0.9 agree, 0.5/0.7 differ, 0/0.1 agree, 0.8/0.2 differ
    expect(m?.correlation).toBeGreaterThan(0);
  });

  it("treats a float-noisy difference of exactly the tolerance as within it", () => {
    expect(0.8 - 0.7).toBeGreaterThan(0.1); // 0.10000000000000009
    expect(computeMetrics([{ human: 0.7, judge: 0.8 }], 0.7, 0.1)?.withinTolerance).toBe(1);
  });

  it("returns null for no data and null correlation for constant scores", () => {
    expect(computeMetrics([], 0.7, 0.1)).toBeNull();
    expect(pearson([1, 1, 1], [0.1, 0.5, 0.9])).toBeNull();
    expect(pearson([1], [1])).toBeNull();
  });
});

describe("parseCalibration", () => {
  it("applies defaults", () => {
    const c = parseCalibration(yaml(sample("a", "x", 1) + sample("b", "y", 0)));
    expect(c).toMatchObject({ repeat: 1, threshold: 0.7, tolerance: 0.1 });
  });

  it("rejects duplicate ids, <2 samples and out-of-range human scores", () => {
    expect(() => parseCalibration(yaml(sample("a", "x", 1) + sample("a", "y", 0)))).toThrow(
      /duplicate id/,
    );
    expect(() => parseCalibration(yaml(sample("a", "x", 1)))).toThrow(/at least 2/);
    expect(() => parseCalibration(yaml(sample("a", "x", 1) + sample("b", "y", 7)))).toThrow(
      ConfigError,
    );
  });
});

describe("runCalibration", () => {
  const cal = parseCalibration(
    yaml(sample("hit", "x", 0.9) + sample("miss", "y", 0.1) + sample("bad", "z", 0.5), "repeat: 2"),
  );

  it("averages repeated judge calls and reports spread", async () => {
    const scores = [0.8, 1.0, 0.2, 0.2, 0.5, 0.5];
    let i = 0;
    const judge: Provider = () =>
      Promise.resolve(JSON.stringify({ score: scores[i++ % scores.length] }));
    const report = await runCalibration({ ...cal, concurrency: 1 }, judge);
    const hit = report.samples.find((s) => s.id === "hit");
    expect(hit?.judge).toBeCloseTo(0.9);
    expect(hit?.spread).toBeCloseTo(0.1);
    expect(report.unscored).toBe(0);
  });

  it("fails closed: one bad judge call leaves the whole sample unscored", async () => {
    let calls = 0;
    const judge: Provider = (_p, ctx) => {
      calls++;
      if (ctx.caseId === "bad" && ctx.trial === 2) return Promise.reject(new Error("judge down"));
      if (ctx.caseId === "miss") return Promise.resolve("no json here");
      return Promise.resolve('{"score": 0.9}');
    };
    const report = await runCalibration(cal, judge);
    expect(calls).toBe(6); // every trial still attempted
    const byId = Object.fromEntries(report.samples.map((s) => [s.id, s]));
    expect(byId.bad).toMatchObject({ judge: null, error: "judge down" });
    expect(byId.miss).toMatchObject({
      judge: null,
      error: expect.stringContaining("no {score}") as unknown,
    });
    expect(report.unscored).toBe(2);
    expect(report.metrics?.n).toBe(1);
  });

  it("formats worst disagreements and unscored samples first", async () => {
    const judge: Provider = (_p, ctx) =>
      ctx.caseId === "bad" ? Promise.reject(new Error("x")) : Promise.resolve('{"score": 0.9}');
    const text = formatCalibration(await runCalibration(cal, judge));
    expect(text.indexOf("bad")).toBeLessThan(text.indexOf("miss"));
    expect(text.indexOf("miss")).toBeLessThan(text.indexOf("hit"));
    expect(text).toContain("unscored and excluded");
  });
});

describe("cli calibrate (end-to-end with a real subprocess)", () => {
  const judge = resolve("test/fixtures/fake-judge.mjs");
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-gauge-cal-"));
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });
  afterEach(() => vi.restoreAllMocks());

  async function write(samples: string): Promise<string> {
    const path = join(dir, "cal.yaml");
    await writeFile(path, `name: e2e\njudge: { command: 'node "${judge}"' }\nsamples:\n${samples}`);
    return path;
  }

  it("passes the gate when judge and human agree, fails when MAE is too high", async () => {
    const close = await write(sample("a", "GOOD", 0.9) + sample("b", "BAD", 0.1));
    expect(await main(["calibrate", close, "--max-mae", "0.1"])).toBe(EXIT.OK);
    const far = await write(sample("a", "GOOD", 0.1) + sample("b", "BAD", 0.9));
    expect(await main(["calibrate", far, "--max-mae", "0.3"])).toBe(EXIT.GATE);
    expect(await main(["calibrate", far])).toBe(EXIT.OK); // no gate flag → report only
  });

  it("fails the gate when a sample cannot be scored, even if the rest agree", async () => {
    const file = await write(
      sample("a", "GOOD", 0.9) + sample("b", "BAD", 0.1) + sample("c", "CRASH", 0.5),
    );
    expect(await main(["calibrate", file, "--max-mae", "0.5"])).toBe(EXIT.GATE);
  });

  it("returns usage errors with exit code 2", async () => {
    expect(await main(["calibrate"])).toBe(EXIT.USAGE);
    expect(await main(["calibrate", join(dir, "missing.yaml")])).toBe(EXIT.USAGE);
    expect(await main(["calibrate", await write(sample("a", "x", 1)), "--max-mae", "9"])).toBe(
      EXIT.USAGE,
    );
  });
});
