import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import { suiteSchema, type Suite } from "./schema.js";

export class ConfigError extends Error {
  override name = "ConfigError";
}

export interface LoadedSuite {
  suite: Suite;
  /** Directory of the config file; provider commands run here. */
  baseDir: string;
}

export function parseSuite(source: string, label = "suite"): Suite {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (e) {
    throw new ConfigError(`${label}: invalid YAML — ${(e as Error).message}`);
  }
  const result = suiteSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new ConfigError(`${label}: invalid suite\n${lines.join("\n")}`);
  }
  return result.data;
}

export async function loadSuite(path: string): Promise<LoadedSuite> {
  const abs = resolve(path);
  let source: string;
  try {
    source = await readFile(abs, "utf8");
  } catch {
    throw new ConfigError(`cannot read suite file: ${path}`);
  }
  return { suite: parseSuite(source, path), baseDir: dirname(abs) };
}
