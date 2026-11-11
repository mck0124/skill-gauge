export interface AssertionResult {
  type: string;
  pass: boolean;
  /** 0..1 */
  score: number;
  weight: number;
  reason: string;
}

export interface TrialResult {
  caseId: string;
  trial: number;
  output: string | null;
  error: string | null;
  durationMs: number;
  assertions: AssertionResult[];
  pass: boolean;
  score: number;
}

export interface RunRecord {
  version: 1;
  suite: string;
  startedAt: string;
  finishedAt: string;
  repeat: number;
  trials: TrialResult[];
}
