import {
  AI_RECOGNITION_MAX_MODEL_LIST_MODELS,
  aiModelListRequestSchema,
  aiModelListResponseSchema,
  type AiModelListItem,
  type AiModelListRequest,
  type AiRecognitionProvider,
} from "@renewlet/shared/schemas/ai-recognition";
import { requireAuth } from "./auth";
import { HttpError, json, readJson, requestLocale } from "./http";
import { serverText, type AppLocale } from "./server-i18n";
import type { Env } from "./types";

const AI_MODEL_LIST_TIMEOUT_MS = 15_000;
const AI_MODEL_LIST_RESPONSE_BYTES = 1 << 20;
const AI_MODEL_SECRET_PATTERN = /(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|(?:api[_-]?key|authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token)["'\s:=]+[A-Za-z0-9._~+/=-]{8,})/gi;

type ModelListEndpoint = {
  url: string;
  headers: Headers;
};

type NormalizedModelList = {
  models: AiModelListItem[];
  truncated: boolean;
};

export async function listAIModels(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  await requireAuth(request, env);
  const body = await readJson(request, aiModelListRequestSchema, locale);
  const input = normalizeAIModelListRequest(body);
  assertAIModelListRequest(input, locale);

  try {
    const endpoint = buildAIModelListEndpoint(input);
    const raw = await fetchAIModelListJSON(endpoint, locale);
    const normalized = normalizeAIModelList(input.provider, raw);
    return json(aiModelListResponseSchema.parse({
      provider: input.provider,
      models: normalized.models,
      truncated: normalized.truncated,
    }));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      serverText(locale, "aiRecognition.modelListFailed"),
      "AI_MODEL_LIST_FAILED",
      aiModelListErrorDetails("provider_failed", error),
    );
  }
}

function normalizeAIModelListRequest(input: AiModelListRequest): AiModelListRequest {
  return {
    provider: input.provider,
    baseUrl: input.baseUrl.trim(),
    apiKey: input.apiKey.trim(),
  };
}

function assertAIModelListRequest(input: AiModelListRequest, locale: AppLocale): void {
  if (input.provider === "openai-compatible" && !input.baseUrl) {
    throw new HttpError(400, serverText(locale, "aiRecognition.baseUrlRequired"), "AI_MODEL_LIST_BASE_URL_REQUIRED");
  }
  if (input.provider !== "openai-compatible" && !input.apiKey) {
    throw new HttpError(400, serverText(locale, "aiRecognition.apiKeyRequired"), "AI_MODEL_LIST_API_KEY_REQUIRED");
  }
}

function buildAIModelListEndpoint(input: AiModelListRequest): ModelListEndpoint {
  const headers = new Headers({ accept: "application/json" });
  switch (input.provider) {
    case "openai":
      headers.set("authorization", `Bearer ${input.apiKey}`);
      return { url: appendModelListPath(input.baseUrl || "https://api.openai.com/v1"), headers };
    case "gemini":
      headers.set("x-goog-api-key", input.apiKey);
      return { url: appendModelListPath(input.baseUrl || "https://generativelanguage.googleapis.com/v1beta"), headers };
    case "anthropic":
      headers.set("x-api-key", input.apiKey);
      headers.set("anthropic-version", "2023-06-01");
      return { url: appendModelListPath(input.baseUrl || "https://api.anthropic.com/v1"), headers };
    case "openai-compatible":
      if (input.apiKey) headers.set("authorization", `Bearer ${input.apiKey}`);
      return { url: appendModelListPath(input.baseUrl), headers };
  }
}

function appendModelListPath(baseUrl: string): string {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path.endsWith("/models") ? path : `${path}/models`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function fetchAIModelListJSON(endpoint: ModelListEndpoint, locale: AppLocale): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_MODEL_LIST_TIMEOUT_MS);
  let response: Response;
  try {
    // 这是用户显式点击刷新后才触发的第三方请求；API Key 只在 Worker 侧使用，不返回、不持久化。
    response = await fetch(endpoint.url, {
      method: "GET",
      headers: endpoint.headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new HttpError(
        408,
        serverText(locale, "aiRecognition.modelListTimeout"),
        "AI_MODEL_LIST_TIMEOUT",
        aiModelListErrorDetails("timeout", null),
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const text = await readAIModelListResponseText(response, locale);
  if (!response.ok) {
    throw new HttpError(
      response.status,
      serverText(locale, "aiRecognition.modelListFailed"),
      "AI_MODEL_LIST_FAILED",
      aiModelListErrorDetails(`http_${response.status}`, text),
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(
      400,
      serverText(locale, "aiRecognition.modelListFailed"),
      "AI_MODEL_LIST_INVALID_JSON",
      aiModelListErrorDetails("invalid_json", text),
    );
  }
}

async function readAIModelListResponseText(response: Response, locale: AppLocale): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > AI_MODEL_LIST_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new HttpError(
        413,
        serverText(locale, "common.requestBodyTooLarge"),
        "AI_MODEL_LIST_RESPONSE_TOO_LARGE",
        aiModelListErrorDetails("response_too_large", null),
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function normalizeAIModelList(provider: AiRecognitionProvider, raw: unknown): NormalizedModelList {
  const models = provider === "gemini"
    ? normalizeGeminiModels(raw)
    : provider === "anthropic"
      ? normalizeAnthropicModels(raw)
      : normalizeOpenAIShapeModels(raw);
  const deduped = dedupeModels(models);
  return {
    models: deduped.slice(0, AI_RECOGNITION_MAX_MODEL_LIST_MODELS),
    truncated: deduped.length > AI_RECOGNITION_MAX_MODEL_LIST_MODELS,
  };
}

function normalizeOpenAIShapeModels(raw: unknown): AiModelListItem[] {
  const data = arrayField(record(raw), "data");
  return data.map((item) => {
    const model = record(item);
    const id = stringField(model, "id");
    if (!id) return null;
    return modelItem({
      id,
      displayName: stringField(model, "display_name") || stringField(model, "displayName"),
      createdAt: epochSecondsToISO(numberField(model, "created")),
      ownedBy: stringField(model, "owned_by") || stringField(model, "ownedBy"),
    });
  }).filter((item): item is AiModelListItem => item !== null);
}

function normalizeGeminiModels(raw: unknown): AiModelListItem[] {
  const models = arrayField(record(raw), "models");
  return models.map((item) => {
    const model = record(item);
    const methods = stringArrayField(model, "supportedGenerationMethods");
    if (methods.length > 0 && !methods.includes("generateContent")) return null;
    const name = stringField(model, "name");
    const id = stringField(model, "baseModelId") || stripGeminiModelPrefix(name);
    if (!id) return null;
    const thinking = model["thinking"];
    return modelItem({
      id,
      displayName: stringField(model, "displayName"),
      inputTokenLimit: numberField(model, "inputTokenLimit"),
      outputTokenLimit: numberField(model, "outputTokenLimit"),
      capabilities: {
        textInput: true,
        imageInput: null,
        structuredOutput: null,
        thinking: typeof thinking === "boolean" ? thinking : thinking == null ? null : true,
      },
    });
  }).filter((item): item is AiModelListItem => item !== null);
}

function normalizeAnthropicModels(raw: unknown): AiModelListItem[] {
  const data = arrayField(record(raw), "data");
  return data.map((item) => {
    const model = record(item);
    const id = stringField(model, "id");
    if (!id) return null;
    const capabilities = record(model["capabilities"]);
    return modelItem({
      id,
      displayName: stringField(model, "display_name") || stringField(model, "displayName"),
      createdAt: stringField(model, "created_at") || stringField(model, "createdAt"),
      ownedBy: stringField(model, "type"),
      capabilities: {
        textInput: booleanField(capabilities, "text") ?? null,
        imageInput: booleanField(capabilities, "vision") ?? null,
        structuredOutput: null,
        thinking: booleanField(capabilities, "thinking") ?? null,
      },
    });
  }).filter((item): item is AiModelListItem => item !== null);
}

function modelItem(input: {
  id: string;
  displayName?: string | null;
  createdAt?: string | null;
  ownedBy?: string | null;
  inputTokenLimit?: number | null;
  outputTokenLimit?: number | null;
  capabilities?: Partial<AiModelListItem["capabilities"]>;
}): AiModelListItem {
  return {
    id: input.id,
    displayName: input.displayName || null,
    createdAt: input.createdAt || null,
    ownedBy: input.ownedBy || null,
    inputTokenLimit: input.inputTokenLimit ?? null,
    outputTokenLimit: input.outputTokenLimit ?? null,
    capabilities: {
      textInput: input.capabilities?.textInput ?? null,
      imageInput: input.capabilities?.imageInput ?? null,
      structuredOutput: input.capabilities?.structuredOutput ?? null,
      thinking: input.capabilities?.thinking ?? null,
    },
  };
}

function dedupeModels(models: readonly AiModelListItem[]): AiModelListItem[] {
  const out: AiModelListItem[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const key = model.id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(model);
  }
  return out;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayField(value: Record<string, unknown>, key: string): unknown[] {
  const field = value[key];
  return Array.isArray(field) ? field : [];
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const field = value[key];
  return Array.isArray(field) ? field.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
}

function numberField(value: Record<string, unknown>, key: string): number | null {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? Math.trunc(field) : null;
}

function booleanField(value: Record<string, unknown>, key: string): boolean | null {
  const field = value[key];
  return typeof field === "boolean" ? field : null;
}

function epochSecondsToISO(value: number | null): string | null {
  return value && value > 0 ? new Date(value * 1000).toISOString() : null;
}

function stripGeminiModelPrefix(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/^models\//, "");
}

function aiModelListErrorDetails(reason: string, providerMessage: unknown) {
  const message = providerMessage instanceof Error
    ? providerMessage.message
    : typeof providerMessage === "string"
      ? providerMessage
      : null;
  return {
    reason,
    providerMessage: message ? redactAIModelListSecrets(message).slice(0, 1000) : null,
  };
}

function redactAIModelListSecrets(value: string): string {
  return value.replace(AI_MODEL_SECRET_PATTERN, "[redacted]");
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error && error.name === "AbortError"
  );
}
