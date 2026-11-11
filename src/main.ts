import { parseArgs } from "node:util";
import { ConfigError, loadSuite } from "./config/load.js";
import { compare } from "./core/compare.js";
import { runSuite } from "./core/run.js";
import { summarize } from "./core/stats.js";
import { formatComparison, formatSummary } from "./format/table.js";
import { commandProvider } from "./providers/command.js";
import { DEFAULT_RUNS_DIR, latestRunPath, loadRun, saveRun } from "./store/runs.js";

/** 0 = ok, 1 = quality gate failed, 2 = usage / config error. */
export const EXIT = { OK: 0, GATE: 1, USAGE: 2 } as const;

const HELP = `skill-eval — measure LLM skill quality with repeatable test cases

Usage:
  skill-eval run <suite.yaml> [--repeat N] [--case ID]... [--out DIR] [--min-pass-rate R]
  skill-eval report [run.json] [--dir DIR] [--json] [--min-pass-rate R]
  skill-eval compare <base.json> <head.json> [--threshold T]

Exit codes: 0 ok · 1 quality gate failed · 2 usage/config error
Docs: https://github.com/mck0124/skill-eval#readme`;

class UsageError extends Error {}

function ratio(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1)
    throw new UsageError(`${flag} must be between 0 and 1`);
  return n;
}

function gate(passRate: number, min: number | undefined, log: (s: string) => void): number {
  if (min === undefined || passRate >= min) return EXIT.OK;
  log(`\n✗ pass rate ${(passRate * 100).toFixed(0)}% < required ${(min * 100).toFixed(0)}%`);
  return EXIT.GATE;
}

async function cmdRun(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      repeat: { type: "string" },
      case: { type: "string", multiple: true },
      out: { type: "string", default: DEFAULT_RUNS_DIR },
      "min-pass-rate": { type: "string" },
    },
  });
  const [file] = positionals;
  if (!file) throw new UsageError("run: missing <suite.yaml>");
  const repeat = values.repeat === undefined ? undefined : Number(values.repeat);
  if (repeat !== undefined && (!Number.isInteger(repeat) || repeat < 1)) {
    throw new UsageError("--repeat must be a positive integer");
  }
  const minPassRate = ratio(values["min-pass-rate"], "--min-pass-rate");

  const { suite, baseDir } = await loadSuite(file);
  const unknown = (values.case ?? []).filter((id) => !suite.cases.some((c) => c.id === id));
  if (unknown.length) throw new UsageError(`unknown case id(s): ${unknown.join(", ")}`);

  const run = await runSuite(suite, {
    provider: commandProvider(suite.provider, baseDir),
    judge: suite.judge && commandProvider(suite.judge, baseDir),
    only: values.case,
    repeat,
    onTrial: (t) => {
      process.stderr.write(
        `${t.pass ? "✓" : "✗"} ${t.caseId}#${t.trial}${t.error ? ` (${t.error})` : ""}\n`,
      );
    },
  });
  const path = await saveRun(run, values.out);
  const summary = summarize(run);
  console.log(`\n${formatSummary(summary)}\n\nsaved ${path}`);
  return gate(summary.passRate, minPassRate, console.log);
}

async function cmdReport(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      dir: { type: "string", default: DEFAULT_RUNS_DIR },
      json: { type: "boolean", default: false },
      "min-pass-rate": { type: "string" },
    },
  });
  const minPassRate = ratio(values["min-pass-rate"], "--min-pass-rate");
  const path = positionals[0] ?? (await latestRunPath(values.dir));
  if (!path) throw new UsageError(`no runs found in ${values.dir}; run \`skill-eval run\` first`);
  const summary = summarize(await loadRun(path));
  console.log(values.json ? JSON.stringify(summary, null, 2) : formatSummary(summary));
  return gate(summary.passRate, minPassRate, values.json ? console.error : console.log);
}

async function cmdCompare(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { threshold: { type: "string", default: "0.1" } },
  });
  const [basePath, headPath] = positionals;
  if (!basePath || !headPath) throw new UsageError("compare: need <base.json> <head.json>");
  const threshold = ratio(values.threshold, "--threshold") ?? 0.1;
  const [base, head] = await Promise.all([loadRun(basePath), loadRun(headPath)]);
  const result = compare(summarize(base), summarize(head), threshold);
  console.log(formatComparison(result));
  return result.regressions > 0 ? EXIT.GATE : EXIT.OK;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "run":
        return await cmdRun(rest);
      case "report":
        return await cmdReport(rest);
      case "compare":
        return await cmdCompare(rest);
      case undefined:
      case "-h":
      case "--help":
        console.log(HELP);
        return command === undefined ? EXIT.USAGE : EXIT.OK;
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (e) {
    if (
      e instanceof UsageError ||
      e instanceof ConfigError ||
      (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")
    ) {
      console.error(`error: ${(e as Error).message}\n\nRun \`skill-eval --help\` for usage.`);
      return EXIT.USAGE;
    }
    throw e;
  }
}
