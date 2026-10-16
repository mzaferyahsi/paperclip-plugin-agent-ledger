// The only outbound destinations of this plugin. Nothing else is ever requested (tests/outbound.test.ts).
import type { SourceKey } from './candidate.ts';
import { parseLitellm } from './parse-litellm.ts';
import { parseModelsDev } from './parse-models-dev.ts';
import { parseAnthropicOfficial, parseOpenAiOfficial } from './parse-official.ts';
import type { ParseOutcome } from './candidate.ts';

export const USER_AGENT = 'paperclip-plugin-org-usage/0.1.3';
export interface Source { key: SourceKey; label: string; url: string; accept: string | null; parse: (body: string) => ParseOutcome }

export const SOURCES: readonly Source[] = [
  { key: 'anthropic-official', label: 'Anthropic pricing page', url: 'https://platform.claude.com/docs/en/about-claude/pricing', accept: 'text/markdown', parse: parseAnthropicOfficial },
  { key: 'openai-official', label: 'OpenAI pricing page', url: 'https://developers.openai.com/api/docs/pricing.md', accept: null, parse: parseOpenAiOfficial },
  { key: 'litellm', label: 'LiteLLM price list', url: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json', accept: 'application/json', parse: parseLitellm },
  { key: 'models-dev', label: 'models.dev', url: 'https://models.dev/api.json', accept: 'application/json', parse: parseModelsDev },
];
export const DEFAULT_SOURCE_ORDER: SourceKey[] = ['anthropic-official', 'openai-official', 'litellm', 'models-dev'];
export const ALLOWED_HOSTS: readonly string[] = [...new Set(SOURCES.map((s) => new URL(s.url).host))];
