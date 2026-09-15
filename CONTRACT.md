# LLM feature contract

- createFeature(options) returns name and middleware.
- createLLM(options) returns `generate`, `generateMulti`, `review`, and `reviewMulti`.
- `generateMulti` and `reviewMulti` start all requests concurrently and preserve input order.
- OpenAI is the default provider; unsupported providers fail at the provider adapter boundary.
- Cloudflare AI Gateway routing is optional and independent of provider selection.
- Direct OpenAI access remains compatible with the existing `OPENAI_*` environment variables.
- Provider-neutral `LLM_*` variables take precedence over legacy `OPENAI_*` variables.
- An authenticated Gateway uses `cf-aig-authorization`; provider authentication remains in `Authorization`.
- A JSON Schema may be passed as the second argument or in `{ schema }`; invalid model data gets one repair request.
- Failed responses throw `LLMResponseError` with `code=response_failed`, `responseFailed=true`, and the raw `llmResponse`.
- Each request emits one-line JSON request/response logs with request ID, metadata, duration, status, and token counts.
- Middleware may return a response or call next().
- Request state belongs in the state object supplied by cf-genai-base.
- Cloudflare bindings are supplied by the consuming Worker environment.
- Feature-owned migrations and schemas must be versioned with the feature.
