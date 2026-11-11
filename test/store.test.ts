import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunRecord } from "../src/core/types.js";
import { latestRunPath, loadRun, saveRun } from "../src/store/runs.js";

const record = (startedAt: string): RunRecord => ({
  version: 1,
  suite: "s",
  startedAt,
  finishedAt: startedAt,
  repeat: 1,
  trials: [],
});

describe("run store", () => {
  it("round-trips a run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "se-store-"));
    const path = await saveRun(record("2026-01-01T00:00:00.000Z"), dir);
    expect((await loadRun(path)).suite).toBe("s");
  });

  it("latestRunPath returns the newest run, or null when empty/missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "se-store-"));
    expect(await latestRunPath(dir)).toBeNull();
    expect(await latestRunPath(join(dir, "nope"))).toBeNull();
    await saveRun(record("2026-01-01T00:00:00.000Z"), dir);
    const newest = await saveRun(record("2026-02-01T00:00:00.000Z"), dir);
    expect(await latestRunPath(dir)).toBe(newest);
  });

  it("rejects files that are not run records", async () => {
    const dir = await mkdtemp(join(tmpdir(), "se-store-"));
    const path = join(dir, "bad.json");
    await writeFile(path, JSON.stringify({ hello: 1 }));
    await expect(loadRun(path)).rejects.toThrow(/not a skill-eval run file/);
  });
});
