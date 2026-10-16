// Model and provider key normalisation. Both the cost events and every price source are reduced to the same
// keys so a configured model, an event model and a price list entry can be compared.

/** Providers whose prices are resold under other names (cloud marketplaces). Their entries are never used as list prices. */
export const RESELLER_PROVIDER = /(bedrock|vertex|azure|sagemaker|watsonx|databricks|snowflake|oci|openrouter|replicate|github|vercel|fireworks|together|deepinfra|nscale|ovhcloud|lambda|baseten|novita|poe|requesty|helicone|portkey|cloudflare|heroku|gateway|proxy|litellm)/i;

const DEFAULT_PROVIDER_ALIASES: Record<string, string> = {
  chatgpt: 'openai', 'text-completion-openai': 'openai', 'zai-coding-plan': 'zai', zhipuai: 'zai', 'zhipuai-coding-plan': 'zai',
  'google-vertex': 'google', gemini: 'google', 'anthropic-claude': 'anthropic', claude: 'anthropic',
};

export function providerKey(raw: string, userAliases: Record<string, string> = {}): string {
  const k = String(raw ?? '').trim().toLowerCase();
  return userAliases[k] ?? DEFAULT_PROVIDER_ALIASES[k] ?? k;
}

/** "us.anthropic.claude-opus-5-5-20260101-v1:0" -> "claude-opus-5-5"; "zai-coding-plan/glm-5.3" -> "glm-5-3". */
export function modelKey(raw: string | null | undefined): string {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  s = s.slice(s.lastIndexOf('/') + 1);
  s = s.replace(/^(us|eu|au|jp|apac|global)\./, '').replace(/^(anthropic|openai|meta|mistral|amazon|cohere|google|deepseek|zai)\./, '');
  s = s.replace(/:[\w.-]*$/, '').replace(/-v\d+(:\d+)?$/, '');
  s = s.replace(/-latest$/, '').replace(/[-@](\d{8})$/, '').replace(/-(\d{4}-\d{2}-\d{2})$/, '');
  return s.replace(/[._\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/** Wildcard (*) case-insensitive match used by alias and tier rules. */
export function globMatch(pattern: string, value: string): boolean {
  const re = new RegExp('^' + pattern.toLowerCase().split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return re.test(value.toLowerCase());
}
