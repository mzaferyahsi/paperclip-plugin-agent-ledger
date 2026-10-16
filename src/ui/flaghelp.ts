// What each flag means. Shown as a tooltip on desktop and as written text in the details of a row on phones.
export const FLAG_HELP: Record<string, { label: string; meaning: string }> = {
  heavy: { label: 'HEAVY', meaning: 'Heavy spender: this agent uses a large share of all tokens in the range (above the configured limit, or far above the median agent).' },
  drift: { label: 'DRIFT', meaning: 'Model drift: the agent ran more than one model in this range, for example because its model was changed. Its latest run used the configured model.' },
  cfg_not_actual: { label: 'CFG≠ACT', meaning: 'Configured model differs from the model actually used: the most recent run did not use the model the agent is configured with.' },
  low_data: { label: 'LOW DATA', meaning: 'Low data: too few runs with usage in this range to draw conclusions from the numbers.' },
  unpriced: { label: 'UNPRICED', meaning: 'Unpriced usage: some tokens belong to models with no known price, so the cost is a lower bound. Set a price in the settings page.' },
  errors: { label: 'ERRORS', meaning: 'Errors: the agent is in an error state, or many of its runs failed or were cancelled in this range.' },
  tier: { label: 'TIER', meaning: "Tier mismatch: the tier of the agent's model differs from the tier you set for its role." },
};
