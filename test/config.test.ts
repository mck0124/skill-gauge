import { describe, expect, it } from "vitest";
import { ConfigError, parseSuite } from "../src/config/load.js";

const minimal = `
name: demo
provider: { command: "cat" }
cases:
  - id: a
    input: hi
    assert: [{ type: contains, value: hi }]
`;

describe("parseSuite", () => {
  it("applies defaults", () => {
    const s = parseSuite(minimal);
    expect(s.repeat).toBe(1);
    expect(s.concurrency).toBe(4);
    expect(s.provider.timeoutMs).toBe(120_000);
    expect(s.cases[0]?.assert[0]).toMatchObject({ weight: 1, ignoreCase: false });
  });

  it("rejects duplicate case ids", () => {
    const src = minimal + `  - id: a\n    input: x\n    assert: [{ type: json }]\n`;
    expect(() => parseSuite(src)).toThrow(/duplicate id "a"/);
  });

  it("requires a judge for llm-rubric", () => {
    const src = minimal.replace(
      "{ type: contains, value: hi }",
      "{ type: llm-rubric, rubric: polite }",
    );
    expect(() => parseSuite(src)).toThrow(/require a `judge`/);
  });

  it("rejects invalid regex at load time", () => {
    const src = minimal.replace("{ type: contains, value: hi }", '{ type: regex, pattern: "(" }');
    expect(() => parseSuite(src)).toThrow(/invalid regex/);
  });

  it("reports YAML syntax errors as ConfigError", () => {
    expect(() => parseSuite("name: [")).toThrow(ConfigError);
  });
});
