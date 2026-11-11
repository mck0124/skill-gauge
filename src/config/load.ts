import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parse } from "yaml";
import type { ZodType } from "zod";
import { calibrationSchema, type Calibration } from "./calibration.js";
import { suiteSchema, type Suite } from "./schema.js";

export class ConfigError extends Error {
  override name = "ConfigError";
}

function parseWith<T>(schema: ZodType<T>, source: string, label: string, noun: string): T {
  let raw: unknown;
  try {
    raw = parse(source);
  } catch (e) {
    throw new ConfigError(`${label}: invalid YAML — ${(e as Error).message}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`,
    );
    throw new ConfigError(`${label}: invalid ${noun}\n${lines.join("\n")}`);
  }
  return result.data;
}

async function readConfig(path: string): Promise<{ source: string; baseDir: string }> {
  const abs = resolve(path);
  try {
    return { source: await readFile(abs, "utf8"), baseDir: dirname(abs) };
  } catch {
    throw new ConfigError(`cannot read file: ${path}`);
  }
}

export function parseSuite(source: string, label = "suite"): Suite {
  return parseWith(suiteSchema, source, label, "suite");
}

export function parseCalibration(source: string, label = "calibration"): Calibration {
  return parseWith(calibrationSchema, source, label, "calibration");
}

export async function loadSuite(path: string): Promise<{ suite: Suite; baseDir: string }> {
  const { source, baseDir } = await readConfig(path);
  return { suite: parseSuite(source, path), baseDir };
}

export async function loadCalibration(
  path: string,
): Promise<{ calibration: Calibration; baseDir: string }> {
  const { source, baseDir } = await readConfig(path);
  return { calibration: parseCalibration(source, path), baseDir };
}
