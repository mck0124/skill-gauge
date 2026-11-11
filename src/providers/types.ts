export interface ProviderContext {
  caseId: string;
  trial: number;
}

/** Sends an input to a model/skill and resolves with its text output. */
export type Provider = (input: string, ctx: ProviderContext) => Promise<string>;
