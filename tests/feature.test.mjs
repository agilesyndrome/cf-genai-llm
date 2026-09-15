import test from "node:test";
import assert from "node:assert/strict";
import { createFeature, createLLM, LLMResponseError } from "../src/index.js";

test("feature delegates to the next handler", async () => {
  const feature = createFeature({ name: "example" });
  assert.equal(feature.version, "4.1.0");
  const response = await feature.middleware(new Request("https://example.test/"), {}, {}, () => Response.json({ ok: true }), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

const schema = { type: "object", additionalProperties: false, properties: { answer: { type: "string" } }, required: ["answer"] };
function response(text, usage = { input_tokens: 3, output_tokens: 2, total_tokens: 5 }) { return new Response(JSON.stringify({ output_text: text, usage }), { status: 200, headers: { "content-type": "application/json" } }); }

test("generate sends metadata, validates typed output, and logs token counts", async () => {
  const calls = []; const logs = [];
  const llm = createLLM({ apiKey: "test", fetch: async (url, init) => { calls.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return response("{\"answer\":\"ok\"}"); }, logger: { debug: (line) => logs.push(JSON.parse(line)), info: (line) => logs.push(JSON.parse(line)) }, metadata: { app: "test" } });
  assert.deepEqual(await llm.generate("hello", schema, { schemaName: "answer", metadata: { type: "unit" } }), { answer: "ok" });
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].headers.Authorization, "Bearer test");
  assert.equal(calls[0].body.metadata.type, "unit");
  const responseLog = logs.find((entry) => entry.event === "llm.response");
  assert.equal(responseLog.usage.totalTokens, 5);
  assert.equal(responseLog.provider, "openai");
  assert.equal(responseLog.gateway, false);
});

test("Cloudflare AI Gateway routes Responses and model health through the gateway", async () => {
  const calls = [];
  const llm = createLLM({
    apiKey: "openai-key",
    gateway: { url: "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/", token: "gateway-key" },
    fetch: async (url, init) => {
      calls.push({ url, headers: init.headers });
      return init.method === "GET"
        ? new Response(JSON.stringify({ data: [{ id: "gpt-5.4" }] }), { status: 200 })
        : response("gateway response");
    },
  });

  assert.equal(await llm.generate("hello"), "gateway response");
  assert.deepEqual(await llm.listModels(), [{ id: "gpt-5.4" }]);
  assert.equal(calls[0].url, "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/responses");
  assert.equal(calls[1].url, "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/models");
  assert.equal(calls[0].headers.Authorization, "Bearer openai-key");
  assert.equal(calls[0].headers["cf-aig-authorization"], "Bearer gateway-key");
});

test("environment configuration supports Gateway routing and provider-neutral names", async () => {
  const calls = [];
  const llm = createLLM({
    env: {
      LLM_API_KEY: "provider-key",
      LLM_MODEL: "gpt-5.4-mini",
      CF_AI_GATEWAY_URL: "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/responses",
      CF_AI_GATEWAY_TOKEN: "gateway-key",
      // A legacy URL must not bypass an explicitly enabled Gateway.
      OPENAI_COMPLETIONS_URL: "https://legacy.example/responses",
    },
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return response("ok"); },
  });

  assert.equal(await llm.generate("hello"), "ok");
  assert.equal(calls[0].url, "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/responses");
  assert.equal(calls[0].body.model, "gpt-5.4-mini");
});

test("Gateway supports Cloudflare-stored provider keys", async () => {
  const calls = [];
  const llm = createLLM({
    gateway: { url: "https://gateway.ai.cloudflare.com/v1/account/gateway/openai", token: "gateway-key" },
    fetch: async (url, init) => { calls.push({ url, headers: init.headers }); return response("ok"); },
  });

  assert.equal(await llm.generate("hello"), "ok");
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].headers["cf-aig-authorization"], "Bearer gateway-key");
});

test("gateway false preserves direct OpenAI routing", async () => {
  const calls = [];
  const llm = createLLM({
    env: { OPENAI_API_KEY: "openai-key", CF_AI_GATEWAY_URL: "https://gateway.example/openai" },
    gateway: false,
    fetch: async (url) => { calls.push(url); return response("ok"); },
  });

  assert.equal(await llm.generate("hello"), "ok");
  assert.equal(calls[0], "https://api.openai.com/v1/responses");
});

test("unsupported providers fail at the adapter boundary", async () => {
  const llm = createLLM({ provider: "workers-ai", apiKey: "test", fetch: async () => response("unused") });
  await assert.rejects(() => llm.generate("hello"), /Unsupported LLM provider: workers-ai/);
});

test("generateMulti starts parallel typed requests and reviewMulti preserves order", async () => {
  let active = 0; let peak = 0;
  const llm = createLLM({ apiKey: "test", fetch: async (_url, init) => { active++; peak = Math.max(peak, active); const body = JSON.parse(init.body); await new Promise((resolve) => setTimeout(resolve, 5)); active--; return response(JSON.stringify({ answer: body.input.includes("two") ? "two" : "one" })); } });
  const results = await llm.generateMulti(["one", "two"], schema);
  assert.deepEqual(results, [{ answer: "one" }, { answer: "two" }]); assert.equal(peak, 2);
  assert.deepEqual(await llm.reviewMulti("source", ["first", "second"], schema), [{ answer: "one" }, { answer: "one" }]);
});

test("invalid typed output gets one repair, then exposes the raw model response", async () => {
  let count = 0;
  const llm = createLLM({ apiKey: "test", fetch: async () => { count++; return response(count === 1 ? "{\"wrong\":true}" : "{\"answer\":\"fixed\"}"); } });
  assert.deepEqual(await llm.generate("repair me", schema), { answer: "fixed" }); assert.equal(count, 2);
  const failing = createLLM({ apiKey: "test", fetch: async () => response("{\"wrong\":true}") });
  await assert.rejects(() => failing.generate("fail", schema), (error) => error instanceof LLMResponseError && error.responseFailed && error.llmResponse.output_text === "{\"wrong\":true}");
});
