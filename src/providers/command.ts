import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderConfig } from "../config/schema.js";
import type { Provider } from "./types.js";

export class ProviderError extends Error {
  override name = "ProviderError";
}

const STDERR_TAIL = 500;

/** Kills the whole process group; a shell alone would leave children holding our pipes open. */
function killTree(child: ChildProcess): void {
  try {
    if (child.pid !== undefined && process.platform !== "win32")
      process.kill(-child.pid, "SIGKILL");
    else child.kill("SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/**
 * Runs a shell command per call: input → stdin, stdout → output.
 * `suiteDir` is where the suite file lives; with `isolate`, the command instead runs
 * in a throwaway empty directory that is removed afterwards.
 */
export function commandProvider(config: ProviderConfig, suiteDir: string): Provider {
  return async (input, ctx) => {
    if (!config.isolate) return exec(config, suiteDir, suiteDir, input, ctx);
    const dir = await mkdtemp(join(tmpdir(), "skill-gauge-iso-"));
    try {
      return await exec(config, dir, suiteDir, input, ctx);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

function exec(
  config: ProviderConfig,
  cwd: string,
  suiteDir: string,
  input: string,
  ctx: { caseId: string; trial: number },
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(config.command, {
      cwd,
      shell: true,
      // Own process group, so a timeout can kill the shell *and* its children.
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        ...config.env,
        SKILL_GAUGE_SUITE_DIR: suiteDir,
        SKILL_GAUGE_CASE_ID: ctx.caseId,
        SKILL_GAUGE_TRIAL: String(ctx.trial),
      },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, config.timeoutMs);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new ProviderError(`failed to start command: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new ProviderError(`timed out after ${config.timeoutMs}ms`));
      } else if (code !== 0) {
        const tail = stderr.trim().slice(-STDERR_TAIL);
        reject(new ProviderError(`exited with code ${code}${tail ? `: ${tail}` : ""}`));
      } else {
        resolvePromise(stdout.trim());
      }
    });
    // Ignore EPIPE if the command exits without reading stdin.
    child.stdin.on("error", () => undefined);
    child.stdin.end(input);
  });
}
