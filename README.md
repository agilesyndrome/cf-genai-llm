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

The client speaks the OpenAI Responses-compatible API. OpenAI is the default
endpoint, while any compatible service (including OpenRelay-style endpoints)
can be selected with the same URL, token, and model variables.

```js
// Direct OpenAI API access remains the default.
const direct = createLLM({ env });

// Gateway is a routing/control layer; OpenAI still performs inference.
const gateway = createLLM({ env });
```

The URL may be either a provider base URL or its `/responses` endpoint. Model
list requests use the matching `/models` route. Cloudflare AI Gateway is
detected from its hostname and receives the token in `cf-aig-authorization`;
direct compatible endpoints use `Authorization: Bearer ...`.

Cloudflare Workers AI can be reached through an OpenAI-compatible Gateway URL;
the package does not use the Workers AI binding directly.

### Environment configuration

| Variable | Purpose |
| --- | --- |
| `LLM_API_URL` | Universal OpenAI-compatible Responses URL or API base URL |
| `LLM_API_TOKEN` | Universal provider or Gateway token |
| `LLM_MODEL` | Universal model name; use `auto` to select from `/models` |

Set `LLM_MODEL=auto` when the provider supports a `/models` endpoint.

A feature exports an object with middleware(request, env, ctx, next, state).
Applications layer it into @agilesyndrome/cf-genai-base:

    import { createWorker } from "@agilesyndrome/cf-genai-base";
    import { createFeature } from "@agilesyndrome/cf-genai-feature";

    const feature = createFeature();
    export default createWorker({ features: [feature], fetch: router });

Keep migrations, binding names, API clients, schemas, and route policy in the
feature package. The site supplies only its D1/R2 bindings and domain handlers.
Do not use module-level mutable request state.
