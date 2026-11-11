export { parseSuite, loadSuite, ConfigError } from "./config/load.js";
export type { Suite, Case, Assertion, ProviderConfig } from "./config/schema.js";
export { runSuite, type RunOptions } from "./core/run.js";
export { summarize, type RunSummary, type CaseSummary } from "./core/stats.js";
export { compare, type Comparison, type CaseChange } from "./core/compare.js";
export type { RunRecord, TrialResult, AssertionResult } from "./core/types.js";
export type { Provider, ProviderContext } from "./providers/types.js";
export { commandProvider } from "./providers/command.js";
