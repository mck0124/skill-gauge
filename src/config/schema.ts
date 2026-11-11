import { z } from "zod";

export const providerSchema = z.object({
  /** Shell command. The case input is written to stdin; stdout is the output. */
  command: z.string().min(1),
  timeoutMs: z.number().int().positive().default(120_000),
  env: z.record(z.string(), z.string()).default({}),
});

const base = { weight: z.number().positive().default(1) };

export const assertionSchema = z.discriminatedUnion("type", [
  z.object({
    ...base,
    type: z.literal("contains"),
    value: z.string(),
    ignoreCase: z.boolean().default(false),
  }),
  z.object({
    ...base,
    type: z.literal("not-contains"),
    value: z.string(),
    ignoreCase: z.boolean().default(false),
  }),
  z.object({
    ...base,
    type: z.literal("regex"),
    pattern: z.string(),
    flags: z.string().default(""),
  }),
  z.object({ ...base, type: z.literal("max-length"), value: z.number().int().positive() }),
  z.object({ ...base, type: z.literal("json") }),
  z.object({
    ...base,
    type: z.literal("llm-rubric"),
    rubric: z.string().min(1),
    threshold: z.number().min(0).max(1).default(0.7),
  }),
]);

const caseSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][\w-]*$/, "id must be alphanumeric, '-' or '_'"),
  description: z.string().optional(),
  input: z.string(),
  assert: z.array(assertionSchema).min(1),
});

export const suiteSchema = z
  .object({
    name: z.string().min(1),
    provider: providerSchema,
    judge: providerSchema.optional(),
    repeat: z.number().int().min(1).max(100).default(1),
    concurrency: z.number().int().min(1).max(64).default(4),
    cases: z.array(caseSchema).min(1),
  })
  .superRefine((suite, ctx) => {
    const seen = new Set<string>();
    suite.cases.forEach((c, i) => {
      if (seen.has(c.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", i, "id"],
          message: `duplicate id "${c.id}"`,
        });
      }
      seen.add(c.id);
      c.assert.forEach((a, j) => {
        if (a.type === "regex") {
          try {
            new RegExp(a.pattern, a.flags);
          } catch (e) {
            ctx.addIssue({
              code: "custom",
              path: ["cases", i, "assert", j, "pattern"],
              message: `invalid regex: ${(e as Error).message}`,
            });
          }
        }
      });
    });
    const needsJudge = suite.cases.some((c) => c.assert.some((a) => a.type === "llm-rubric"));
    if (needsJudge && !suite.judge) {
      ctx.addIssue({
        code: "custom",
        path: ["judge"],
        message: "llm-rubric assertions require a `judge` provider",
      });
    }
  });

export type Suite = z.infer<typeof suiteSchema>;
export type Case = Suite["cases"][number];
export type Assertion = z.infer<typeof assertionSchema>;
export type ProviderConfig = z.infer<typeof providerSchema>;
