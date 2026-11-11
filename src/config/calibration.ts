import { z } from "zod";
import { providerSchema } from "./schema.js";

const sampleSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][\w-]*$/, "id must be alphanumeric, '-' or '_'"),
  /** The task given to the skill being judged. */
  input: z.string(),
  /** The skill's output that the judge will grade. */
  output: z.string(),
  /** The grading rubric — same text you would use in an `llm-rubric` assertion. */
  rubric: z.string().min(1),
  /** Human reference score, 0..1. */
  human: z.number().min(0).max(1),
});

export const calibrationSchema = z
  .object({
    name: z.string().min(1),
    judge: providerSchema,
    /** Judge calls per sample; the mean is compared to the human score. */
    repeat: z.number().int().min(1).max(20).default(1),
    concurrency: z.number().int().min(1).max(64).default(4),
    /** Pass/fail cutoff used for the agreement metric (matches `llm-rubric.threshold`). */
    threshold: z.number().min(0).max(1).default(0.7),
    /** |judge − human| at or below this counts as "close". */
    tolerance: z.number().min(0).max(1).default(0.1),
    samples: z.array(sampleSchema).min(2, "need at least 2 samples to compare"),
  })
  .superRefine((cal, ctx) => {
    const seen = new Set<string>();
    cal.samples.forEach((s, i) => {
      if (seen.has(s.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["samples", i, "id"],
          message: `duplicate id "${s.id}"`,
        });
      }
      seen.add(s.id);
    });
  });

export type Calibration = z.infer<typeof calibrationSchema>;
export type CalibrationSample = Calibration["samples"][number];
