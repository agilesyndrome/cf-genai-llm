# @agilesyndrome/cf-genai-llm

Reusable Cloudflare Worker LLM access with typed generation, parallel batches,
reviews, one-shot schema repair, structured logs, and token accounting.

```js
import { createLLM } from "@agilesyndrome/cf-genai-llm";

const llm = createLLM({ env, metadata: { app: "cookbook" } });
const result = await llm.generate("Write a summary", schema, { schemaName: "summary" });
const reviews = await llm.reviewMulti(result, reviewerPrompts, reviewSchema);
```

## Providers and AI Gateway

OpenAI is the default inference provider. Requests may go directly to OpenAI or
through Cloudflare AI Gateway without changing the generation API.

```js
// Direct OpenAI API access remains the default.
const direct = createLLM({ apiKey: env.OPENAI_API_KEY });

// Gateway is a routing/control layer; OpenAI still performs inference.
const gateway = createLLM({
  apiKey: env.OPENAI_API_KEY,
  gateway: {
    url: "https://gateway.ai.cloudflare.com/v1/account-id/gateway-id/openai",
    token: env.CF_AI_GATEWAY_TOKEN,
  },
});
```

The gateway URL may be either the provider base URL or its `/responses`
endpoint. Model-list health checks use the matching `/models` route. An
authenticated Gateway token is sent in `cf-aig-authorization`; the provider
key remains in `Authorization`. When Gateway BYOK or Unified Billing stores the
provider credential, the Gateway token is sufficient and `apiKey` may be
omitted.

Cloudflare Workers AI is a separate inference provider and is not implemented
by this release. Provider selection and Gateway routing are deliberately
independent so a future Workers AI adapter can run either directly or through
AI Gateway.

### Environment configuration

| Variable | Purpose |
| --- | --- |
| `LLM_PROVIDER` | Inference provider; currently `openai` (default) |
| `LLM_API_KEY` | Provider API key; falls back to `OPENAI_API_KEY` |
| `LLM_MODEL` | Model name; falls back to `OPENAI_MODEL`, then `gpt-5.4` |
| `CF_AI_GATEWAY_URL` | Enables Gateway routing using the OpenAI provider URL |
| `CF_AI_GATEWAY_TOKEN` | Optional token for an authenticated Gateway |
| `LLM_ENDPOINT` | Explicit Responses endpoint override |
| `LLM_MODELS_ENDPOINT` | Explicit model-list endpoint override |

`OPENAI_COMPLETIONS_URL` remains supported for direct OpenAI-compatible
endpoints. `OPENAI_MODELS_URL` may explicitly configure its model-list route.
Pass `gateway: false` to `createLLM` to bypass an environment-configured
Gateway for a particular client.

A feature exports an object with middleware(request, env, ctx, next, state).
Applications layer it into @agilesyndrome/cf-genai-base:

    import { createWorker } from "@agilesyndrome/cf-genai-base";
    import { createFeature } from "@agilesyndrome/cf-genai-feature";

    const feature = createFeature();
    export default createWorker({ features: [feature], fetch: router });

Keep migrations, binding names, API clients, schemas, and route policy in the
feature package. The site supplies only its D1/R2 bindings and domain handlers.
Do not use module-level mutable request state.
