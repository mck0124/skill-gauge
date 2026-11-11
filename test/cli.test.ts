import { mkdtemp, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT, main } from "../src/main.js";

const skill = resolve("test/fixtures/echo-skill.mjs");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "skill-eval-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});
afterEach(() => vi.restoreAllMocks());

async function writeSuite(cases: string): Promise<string> {
  const path = join(dir, "suite.yaml");
  await writeFile(path, `name: e2e\nprovider: { command: 'node "${skill}"' }\ncases:\n${cases}`);
  return path;
}

describe("cli (end-to-end with a real subprocess)", () => {
  it("runs, saves a run file, and reports it", async () => {
    const suite = await writeSuite(
      `  - id: shout\n    input: please shout\n    assert: [{ type: contains, value: SHOUT }]\n`,
    );
    const out = join(dir, "runs");
    expect(await main(["run", suite, "--out", out])).toBe(EXIT.OK);
    const [file] = await readdir(out);
    expect(file).toMatch(/^e2e-.*\.json$/);
    expect(await main(["report", "--dir", out, "--min-pass-rate", "1"])).toBe(EXIT.OK);
  });

  it("fails the gate when a case fails, and records command errors", async () => {
    const suite = await writeSuite(
      `  - id: c\n    input: crash\n    assert: [{ type: contains, value: x }]\n`,
    );
    const code = await main(["run", suite, "--out", join(dir, "r"), "--min-pass-rate", "0.9"]);
    expect(code).toBe(EXIT.GATE);
  });

  it("returns usage errors with exit code 2", async () => {
    expect(await main(["nope"])).toBe(EXIT.USAGE);
    expect(await main(["run"])).toBe(EXIT.USAGE);
    expect(await main(["run", join(dir, "missing.yaml")])).toBe(EXIT.USAGE);
    expect(await main(["report", "--dir", join(dir, "empty"), "--min-pass-rate", "2"])).toBe(
      EXIT.USAGE,
    );
  });
});
