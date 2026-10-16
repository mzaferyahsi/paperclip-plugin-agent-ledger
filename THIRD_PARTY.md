# Third-party material

## Price data

The plugin fetches, and ships a snapshot of, public price information from:

- Anthropic and OpenAI pricing pages (list prices published by the vendors).
- LiteLLM `model_prices_and_context_window.json` (BerriAI/litellm, MIT License; content outside the `enterprise/` directory).
- models.dev `api.json` (models.dev, MIT License).

The snapshot contains only provider, model name and the four prices (USD per million tokens). No text from these sources is reproduced.

## Runtime dependencies

- `@paperclipai/plugin-sdk` (MIT)
- `react` (MIT), provided by the host at runtime
