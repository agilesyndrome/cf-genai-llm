const DEFAULT_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-5.4";

const DEFAULT_MODELS_ENDPOINT = "https://api.openai.com/v1/models";
export class LLMCircuitBreakerError extends Error { constructor(message = "LLM generation is temporarily unavailable") { super(message); this.name = "LLMCircuitBreakerError"; this.code = "circuit_breaker_open"; this.circuitBreakerOpen = true; } }

import { getCircuitBreaker, registerCircuitBreaker, registerHealthcheck, setCircuitBreaker } from "@agilesyndrome/cf-genai-base";
export class LLMResponseError extends Error {
  constructor(message, llmResponse, cause) {
    super(message, { cause });
    this.name = "LLMResponseError";
    this.code = "response_failed";
    this.responseFailed = true;
    this.llmResponse = llmResponse;
  }
}

export function createLLM(options = {}) {
  const fetcher = options.fetch || globalThis.fetch;
  const logger = options.logger || console;
  const endpoint = options.endpoint || ((env) => env?.OPENAI_COMPLETIONS_URL || DEFAULT_ENDPOINT);
  const model = options.model || ((env) => env?.OPENAI_MODEL || DEFAULT_MODEL);
  const defaults = options.metadata || {};
  const debugLogging = options.debugLogging === true;
  const featureName = options.feature || options.featureName || "cf-genai-llm";
  const breakerId = options.breakerId || featureName + ":openai-models";
  const healthcheckId = options.healthcheckId || featureName + ":openai-models";
  if (typeof fetcher !== "function") throw new TypeError("createLLM requires fetch");

  const log = (level, event) => {
    if (level === "debug" && !debugLogging) return;
    try { (logger[level] || logger.info || (() => {})).call(logger, JSON.stringify({ source: "cf-genai-llm", ...event })); } catch { /* logging cannot break a request */ }
  };

  async function assertAvailable(requestOptions = {}) { const env = requestOptions.env || options.env; if (!env || !env.DB || requestOptions.allowWhenCircuitTripped) return; const breaker = await getCircuitBreaker(env, breakerId, { who: requestOptions.who || "system:read" }).catch(() => null); if (breaker && breaker.state !== "on") throw new LLMCircuitBreakerError(); }

  async function listModels(requestOptions = {}) { const env = requestOptions.env || options.env; const apiKey = requestOptions.apiKey || options.apiKey || (env && env.OPENAI_API_KEY); if (!apiKey) throw new Error("OPENAI_API_KEY is not configured"); const modelsEndpoint = requestOptions.modelsEndpoint || options.modelsEndpoint || (typeof endpoint === "string" && endpoint.endsWith("/responses") ? endpoint.slice(0, -10) + "models" : DEFAULT_MODELS_ENDPOINT); try { const response = await fetcher(typeof modelsEndpoint === "function" ? modelsEndpoint(env) : modelsEndpoint, { method: "GET", headers: { Authorization: "Bearer " + apiKey }, signal: requestOptions.signal }); const payload = await response.json(); if (!response.ok) throw new LLMResponseError("OpenAI model list failed (" + response.status + ")", payload); if (env && env.DB) { await registerHealthcheck(env, { id: healthcheckId, feature: featureName, component: "openai-models", displayName: "OpenAI model availability", state: "green", metadata: { count: Array.isArray(payload.data) ? payload.data.length : 0 } }, { who: requestOptions.who || "system:update" }); await registerCircuitBreaker(env, { id: breakerId, feature: featureName, name: "openai-models", displayName: "OpenAI model access", state: "on", allowSelfHealing: true, healthchecks: [healthcheckId] }, { who: requestOptions.who || "system:update" }); await setCircuitBreaker(env, breakerId, "on", { who: requestOptions.who || "system:update", automated: true }).catch(() => {}); } return payload.data || []; } catch (error) { if (env && env.DB) { await registerHealthcheck(env, { id: healthcheckId, feature: featureName, component: "openai-models", displayName: "OpenAI model availability", state: "red", metadata: { error: error.message } }, { who: requestOptions.who || "system:update" }).catch(() => {}); await registerCircuitBreaker(env, { id: breakerId, feature: featureName, name: "openai-models", displayName: "OpenAI model access", state: "on", allowSelfHealing: true, healthchecks: [healthcheckId] }, { who: requestOptions.who || "system:update" }).then(() => setCircuitBreaker(env, breakerId, "tripped", { who: requestOptions.who || "system:update", automated: true })).catch(() => {}); } throw error; } }

  async function request(prompt, schema, requestOptions = {}) { await assertAvailable(requestOptions);
    const started = Date.now();
    const requestId = requestOptions.requestId || crypto.randomUUID();
    const env = requestOptions.env || options.env;
    const apiKey = requestOptions.apiKey || options.apiKey || env?.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    const metadata = { ...defaults, ...(requestOptions.metadata || {}) };
    const body = { model: requestOptions.model || (typeof model === "function" ? model(env) : model), input: prompt, store: false };
    if (Object.keys(metadata).length) body.metadata = metadata;
    if (schema) body.text = { format: { type: "json_schema", name: requestOptions.schemaName || "response", strict: true, schema } };
    log("debug", { event: "llm.request", requestId, metadata, model: body.model, hasSchema: Boolean(schema) });
    let response, payload;
    try {
      response = await fetcher(typeof endpoint === "function" ? endpoint(env) : endpoint, { method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: requestOptions.signal });
      payload = await response.json();
    } catch (error) {
      log("error", { event: "llm.error", requestId, durationMs: Date.now() - started, error: error.message });
      throw error;
    }
    const usage = normalizeUsage(payload?.usage);
    if (requestOptions.onUsage) await requestOptions.onUsage(usage);
    log(response.ok ? "info" : "error", { event: "llm.response", requestId, status: response.status, durationMs: Date.now() - started, usage, metadata });
    if (!response.ok) throw new LLMResponseError(`LLM request failed (${response.status})`, payload);
    const text = extractText(payload);
    if (!text) throw new LLMResponseError("LLM returned no text", payload);
    if (requestOptions.onText) await requestOptions.onText(text);
    return { text, payload, usage, requestId, metadata };
  }

  async function generate(promptOrRequest, schemaOrOptions, maybeOptions) {
    const input = normalizeGenerateArgs(promptOrRequest, schemaOrOptions, maybeOptions);
    const first = await request(input.prompt, input.schema, input.options);
    if (!input.schema) return parseBestEffort(first.text);
    try { return validateAndReturn(first.text, input.schema); } catch (error) {
      const repairPrompt = `${input.prompt}\n\nYour previous response was invalid for the required schema. Return only corrected JSON matching this schema exactly.\nSchema: ${JSON.stringify(input.schema)}\nPrevious response: ${first.text}\nValidation error: ${error.message}`;
      let repairedResponse;
      try {
        repairedResponse = await request(repairPrompt, input.schema, { ...input.options, schemaName: `${input.options.schemaName || "response"}_repair` });
        return validateAndReturn(repairedResponse.text, input.schema);
      } catch (repairError) {
        if (repairError instanceof LLMResponseError) throw repairError;
        throw new LLMResponseError(`LLM response did not match the requested schema after one repair attempt: ${repairError.message}`, repairedResponse?.payload || first.payload, repairError);
      }
    }
  }

  async function generateMulti(requests, options = {}) {
    const items = Array.isArray(requests) ? requests : requests.requests;
    if (!Array.isArray(items)) throw new TypeError("generateMulti requires an array of requests");
    const shared = options?.type ? { schema: options, options: {} } : { schema: options.schema, options };
    return Promise.all(items.map((item) => generate(typeof item === "string" ? { prompt: item, schema: shared.schema } : { ...item, schema: item.schema || shared.schema }, { ...shared.options, ...(item.options || {}) })));
  }

  async function review(originalTextOrRequest, reviewPromptOrPrompts, schemaOrOptions, maybeOptions) {
    if (Array.isArray(reviewPromptOrPrompts)) return reviewMulti(originalTextOrRequest, reviewPromptOrPrompts, schemaOrOptions, maybeOptions);
    const args = normalizeReviewArgs(originalTextOrRequest, reviewPromptOrPrompts, schemaOrOptions, maybeOptions);
    return generate(`${args.prompt}\n\nOriginal output to review:\n${args.originalText}`, args.schema, args.options);
  }

  async function reviewMulti(originalText, reviewPrompts, schemaOrOptions, maybeOptions) {
    const { schema, options: shared } = normalizeSchemaOptions(schemaOrOptions, maybeOptions);
    return Promise.all(reviewPrompts.map((item) => {
      const prompt = typeof item === "string" ? item : item.prompt;
      const name = typeof item === "string" ? undefined : item.name;
      return review(originalText, prompt, schema, { ...shared, ...(typeof item === "object" ? item.options : {}), metadata: { ...shared.metadata, ...(name ? { reviewer: name } : {}) } });
    }));
  }

  return { listModels, generate, generateMulti, generateWithSchema: generate, generateMultiWithSchema: generateMulti, review, reviewMulti, reviewWithSchema: review, reviewMultiWithSchema: reviewMulti };
}

function normalizeGenerateArgs(promptOrRequest, schemaOrOptions, maybeOptions) {
  if (promptOrRequest && typeof promptOrRequest === "object" && !Array.isArray(promptOrRequest)) return { prompt: String(promptOrRequest.prompt || ""), schema: promptOrRequest.schema, options: { ...promptOrRequest.options, ...maybeOptions } };
  const { schema, options } = normalizeSchemaOptions(schemaOrOptions, maybeOptions);
  return { prompt: String(promptOrRequest || ""), schema, options };
}
function normalizeReviewArgs(originalText, reviewPrompt, schemaOrOptions, maybeOptions) { const { schema, options } = normalizeSchemaOptions(schemaOrOptions, maybeOptions); return { originalText: String(originalText || ""), prompt: String(reviewPrompt || ""), schema, options }; }
function normalizeSchemaOptions(value, options) { if (value && value.type) return { schema: value, options: options || {} }; return { schema: value?.schema, options: { ...(value || {}), ...(options || {}) } }; }
function extractText(payload) { return payload?.output_text || payload?.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text || ""; }
function parseBestEffort(text) { try { return JSON.parse(text); } catch { return text; } }
function validateAndReturn(text, schema) { let value; try { value = JSON.parse(text); } catch (error) { throw new Error(`response is not JSON: ${error.message}`); } validate(value, schema, "$root"); return value; }
function validate(value, schema, path) {
  if (!schema) return;
  if (schema.type === "object") { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object`); for (const key of schema.required || []) if (!(key in value)) throw new Error(`${path}.${key} is required`); if (schema.additionalProperties === false) for (const key of Object.keys(value)) if (!schema.properties?.[key]) throw new Error(`${path}.${key} is not allowed`); for (const [key, child] of Object.entries(schema.properties || {})) if (key in value) validate(value[key], child, `${path}.${key}`); return; }
  if (schema.type === "array") { if (!Array.isArray(value)) throw new Error(`${path} must be an array`); if (schema.minItems !== undefined && value.length < schema.minItems) throw new Error(`${path} has too few items`); if (schema.maxItems !== undefined && value.length > schema.maxItems) throw new Error(`${path} has too many items`); value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`)); return; }
  if (schema.type === "string" && typeof value !== "string") throw new Error(`${path} must be a string`);
  if (schema.type === "integer" && !Number.isInteger(value)) throw new Error(`${path} must be an integer`);
  if (schema.type === "number" && (typeof value !== "number" || Number.isNaN(value))) throw new Error(`${path} must be a number`);
  if (schema.type === "boolean" && typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} must be one of ${schema.enum.join(", ")}`);
  if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`${path} is below minimum`);
  if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`${path} is above maximum`);
}
function normalizeUsage(usage = {}) { return { inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0, outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0, totalTokens: usage.total_tokens ?? 0 }; }

export function createFeature(options = {}) { const name = options.name || "cf-genai-llm"; const client = createLLM({ ...options, feature: name }); return { name, healthcheck: async (env) => { if (!env || !env.OPENAI_API_KEY) return [{ feature: name, component: "configuration", displayName: "OpenAI configuration", state: "red" }]; try { await client.listModels({ env, who: "system:update" }); return [{ feature: name, component: "configuration", displayName: "OpenAI configuration", state: "green" }]; } catch { return [{ feature: name, component: "configuration", displayName: "OpenAI configuration", state: "yellow" }]; } }, healthchecks: [{ feature: name, component: "openai-models", displayName: "OpenAI model availability", state: "yellow" }], circuitBreakers: [{ id: name + ":openai-models", feature: name, name: "openai-models", displayName: "OpenAI model access", state: "on", allowSelfHealing: true, healthchecks: [name + ":openai-models"] }], middleware: async (request, env, ctx, next, state) => { if (options.boot) await options.boot(env, { request, ctx, state }); return options.handle ? options.handle(request, env, ctx, next, state) : next(); } }; }
