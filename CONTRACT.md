# LLM feature contract

- createFeature(options) returns name and middleware.
- createLLM(options) returns `generate`, `generateMulti`, `review`, and `reviewMulti`.
- `generateMulti` and `reviewMulti` start all requests concurrently and preserve input order.
- The client uses the OpenAI Responses-compatible contract; OpenAI is the default endpoint and arbitrary compatible endpoints are supported.
- `LLM_API_URL`, `LLM_API_TOKEN`, and `LLM_MODEL` are the universal configuration variables.
- Cloudflare AI Gateway is detected from its URL and uses `cf-aig-authorization`; direct compatible endpoints use `Authorization`.
- `LLM_MODEL=auto` selects the first model returned by the configured `/models` endpoint.
- A JSON Schema may be passed as the second argument or in `{ schema }`; invalid model data gets one repair request.
- Failed responses throw `LLMResponseError` with `code=response_failed`, `responseFailed=true`, and the raw `llmResponse`.
- Each request emits one-line JSON request/response logs with request ID, metadata, duration, status, and token counts.
- Middleware may return a response or call next().
- Request state belongs in the state object supplied by cf-genai-base.
- Cloudflare bindings are supplied by the consuming Worker environment.
- Feature-owned migrations and schemas must be versioned with the feature.
