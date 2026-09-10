import test from "node:test";
import assert from "node:assert/strict";
import { createFeature, createLLM, LLMResponseError } from "../src/index.js";

test("feature delegates to the next handler", async () => {
  const feature = createFeature({ name: "example" });
  const response = await feature.middleware(new Request("https://example.test/"), {}, {}, () => Response.json({ ok: true }), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

const schema = { type: "object", additionalProperties: false, properties: { answer: { type: "string" } }, required: ["answer"] };
function response(text, usage = { input_tokens: 3, output_tokens: 2, total_tokens: 5 }) { return new Response(JSON.stringify({ output_text: text, usage }), { status: 200, headers: { "content-type": "application/json" } }); }

test("generate sends metadata, validates typed output, and logs token counts", async () => {
  const calls = []; const logs = [];
  const llm = createLLM({ apiKey: "test", fetch: async (_url, init) => { calls.push(JSON.parse(init.body)); return response("{\"answer\":\"ok\"}"); }, logger: { debug: (line) => logs.push(JSON.parse(line)), info: (line) => logs.push(JSON.parse(line)) }, metadata: { app: "test" } });
  assert.deepEqual(await llm.generate("hello", schema, { schemaName: "answer", metadata: { type: "unit" } }), { answer: "ok" });
  assert.equal(calls[0].metadata.type, "unit");
  assert.equal(logs.find((entry) => entry.event === "llm.response").usage.totalTokens, 5);
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
