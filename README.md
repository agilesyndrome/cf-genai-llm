# @agilesyndrome/cf-genai-llm

Reusable Cloudflare Worker LLM access with typed generation, parallel batches,
reviews, one-shot schema repair, structured logs, and token accounting.

```js
import { createLLM } from "@agilesyndrome/cf-genai-llm";

const llm = createLLM({ env, metadata: { app: "cookbook" } });
const result = await llm.generate("Write a summary", schema, { schemaName: "summary" });
const reviews = await llm.reviewMulti(result, reviewerPrompts, reviewSchema);
```

A feature exports an object with middleware(request, env, ctx, next, state).
Applications layer it into @agilesyndrome/cf-genai-base:

    import { createWorker } from "@agilesyndrome/cf-genai-base";
    import { createFeature } from "@agilesyndrome/cf-genai-feature";

    const feature = createFeature();
    export default createWorker({ features: [feature], fetch: router });

Keep migrations, binding names, API clients, schemas, and route policy in the
feature package. The site supplies only its D1/R2 bindings and domain handlers.
Do not use module-level mutable request state.
