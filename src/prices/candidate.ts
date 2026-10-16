/** A price as read from one source, in USD per million tokens. */
export type SourceKey = 'anthropic-official' | 'openai-official' | 'litellm' | 'models-dev';
export interface Candidate {
  providerKey: string; modelKey: string;
  input: number; cachedInput: number | null; cacheWrite: number | null; output: number;
  source: SourceKey | 'snapshot'; deprecationDate?: string | null;
}
export type ParseOutcome = { ok: true; candidates: Candidate[]; skipped: number } | { ok: false; reason: string };
