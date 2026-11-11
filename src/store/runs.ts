import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RunRecord } from "../core/types.js";

export const DEFAULT_RUNS_DIR = ".skill-gauge/runs";

export async function saveRun(run: RunRecord, dir = DEFAULT_RUNS_DIR): Promise<string> {
  await mkdir(dir, { recursive: true });
  const stamp = run.startedAt.replace(/[:.]/g, "-");
  const path = resolve(join(dir, `${run.suite}-${stamp}.json`));
  await writeFile(path, JSON.stringify(run, null, 2) + "\n");
  return path;
}

export async function loadRun(path: string): Promise<RunRecord> {
  const data = JSON.parse(await readFile(path, "utf8")) as Partial<RunRecord>;
  if (data.version !== 1 || !Array.isArray(data.trials)) {
    throw new Error(`${path}: not a skill-gauge run file`);
  }
  return data as RunRecord;
}

/** Most recently written run file (names sort by timestamp within a suite). */
export async function latestRunPath(dir = DEFAULT_RUNS_DIR): Promise<string | null> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }
  const runs = files.filter((f) => f.endsWith(".json"));
  if (runs.length === 0) return null;
  const stamped = runs
    .map((f) => ({ f, stamp: f.slice(-29) }))
    .sort((a, b) => a.stamp.localeCompare(b.stamp));
  return resolve(dir, stamped[stamped.length - 1]?.f ?? "");
}
