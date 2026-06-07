import { generateObject, NoObjectGeneratedError, wrapLanguageModel, type JSONValue, type ModelMessage, type UserContent } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  AI_RECOGNITION_DIAGNOSTIC_JSON_MAX_CHARS,
  AI_RECOGNITION_DIAGNOSTIC_TEXT_MAX_CHARS,
  AI_RECOGNITION_MAX_IMAGES,
  AI_RECOGNITION_MAX_IMAGE_BYTES,
  AI_RECOGNITION_MAX_TEXT_CHARS,
  aiGeneratedRecognizeObjectSchema,
  aiRecognitionDiagnosticsSchema,
  aiRecognitionErrorDetailsSchema,
  aiRecognitionTestRequestSchema,
  aiRecognitionTestResponseSchema,
  aiThinkingControlSchema,
  type AiGeneratedRecognizeObject,
  type AiRecognitionDiagnostics,
  type AiRecognitionSettings,
  type AiThinkingControl,
  type AiRecognizeResponse,
} from "@renewlet/shared/schemas/ai-recognition";
import {
  AI_RECOGNITION_PROMPT_VERSION,
  AI_RECOGNITION_SCHEMA_NAME,
  type AIRecognitionPromptConfigContext,
  buildAIRecognitionSystemPrompt,
  buildAIRecognitionRepairUserPrompt,
  buildAIRecognitionUserPrompt,
} from "@renewlet/shared/ai-recognition-prompt";
import { getCustomConfig, getSettings, listSubscriptionTags } from "./db";
import { HttpError, json, readJson, requestLocale } from "./http";
import { serverText, type AppLocale } from "./server-i18n";
import { requireAuth } from "./auth";
import type { Env } from "./types";
import {
  aiRecognitionConfigContext,
  fillMissingNotesWithDynamicFallback,
  missingDescribableNoteNames,
  normalizeGeneratedAIRecognizeObject,
} from "./ai-recognition-normalize";

const AI_RECOGNITION_MULTIPART_OVERHEAD = 1024 * 1024;
const AI_RECOGNITION_MAX_BODY_BYTES =
  AI_RECOGNITION_MAX_TEXT_CHARS * 4
  + AI_RECOGNITION_MAX_IMAGES * AI_RECOGNITION_MAX_IMAGE_BYTES
  + AI_RECOGNITION_MULTIPART_OVERHEAD;
const AI_SECRET_PATTERN = /(sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:api[_-]?key|authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token)["'\s:=]+[A-Za-z0-9._~+/=-]{8,})/gi;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const AI_RECOGNITION_TEST_TEXT = "Renewlet AI connection test: Netflix, 9.99 USD, monthly subscription, website netflix.com.";
const EMPTY_AI_RECOGNITION_CONFIG_CONTEXT: AIRecognitionPromptConfigContext = { categories: [], paymentMethods: [], tags: [] };

type AIRecognitionInput = {
  text: string;
  images: Array<{ data: Uint8Array; mediaType: string }>;
  thinkingControl: AiThinkingControl | null;
};

type AIRecognitionCapture = {
  rawModelText: string | null;
  usage: unknown | null;
  finishReason: string | null;
  providerMetadata: unknown | null;
};

type AIRecognitionGeneration = AIRecognitionCapture & {
  object: AiGeneratedRecognizeObject;
};

class AIRecognitionRunError extends Error {
  constructor(
    readonly causeError: unknown,
    readonly diagnostics: AiRecognitionDiagnostics,
  ) {
    super(causeError instanceof Error ? causeError.message : String(causeError));
    this.name = "AIRecognitionRunError";
  }
}

class AIRecognitionGenerationError extends Error {
  constructor(
    readonly causeError: unknown,
    readonly capture: AIRecognitionCapture,
  ) {
    super(causeError instanceof Error ? causeError.message : String(causeError));
    this.name = "AIRecognitionGenerationError";
  }
}

/**
 * recognizeSubscriptions 只返回 AI 草稿。
 *
 * 真正写库仍必须由前端把草稿转成 import payload 后走 preview/apply，避免第三方模型输出绕过用户确认。
 */
export async function recognizeSubscriptions(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  assertAIRecognitionContentLength(request, locale);
  const settings = await getSettings(env, auth.user.id);
  const input = await readAIRecognitionInput(request, locale);
  const thinkingControl = input.thinkingControl;
  if (thinkingControl && thinkingControl.provider !== settings.aiRecognition.provider) {
    throw new HttpError(400, serverText(locale, "aiRecognition.thinkingProviderMismatch"), "AI_THINKING_PROVIDER_MISMATCH");
  }
  assertAIRecognitionSettings(settings.aiRecognition, locale);
  // 配置项只作为模型上下文和响应归一化依据；新增分类/支付方式仍必须走 import preview/apply 用户确认链路。
  const [customConfig, existingTags] = await Promise.all([
    getCustomConfig(env, auth.user.id),
    listSubscriptionTags(env, auth.user.id),
  ]);
  const configContext = aiRecognitionConfigContext(customConfig, locale, existingTags);

  try {
    const response = await runAIRecognition({
      settings: settings.aiRecognition,
      input,
      locale,
      timezone: settings.timezone,
      defaultCurrency: settings.defaultCurrency,
      configContext,
      thinkingControl,
      maxOutputTokens: 12000,
    });
    if (response.subscriptions.length === 0) {
      throw new HttpError(400, serverText(locale, "aiRecognition.noSubscriptions"), "AI_RECOGNITION_EMPTY", aiRecognitionErrorDetails("empty", null, response.diagnostics));
    }
    return json(response);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const diagnostics = aiRecognitionDiagnosticsFromError(error);
    const cause = aiRecognitionCauseFromError(error);
    if (isAIRecognitionSchemaMismatch(error)) {
      throw new HttpError(
        400,
        serverText(locale, "aiRecognition.schemaMismatch"),
        "AI_RECOGNITION_SCHEMA_MISMATCH",
        diagnostics ? aiRecognitionErrorDetails("schema_mismatch", cause, diagnostics) : safeAIRecognitionError(cause),
      );
    }
    throw new HttpError(
      400,
      serverText(locale, "aiRecognition.failed"),
      "AI_RECOGNITION_FAILED",
      diagnostics ? aiRecognitionErrorDetails("provider_failed", cause, diagnostics) : safeAIRecognitionError(cause),
    );
  }
}

/** testAIRecognitionConnection 使用当前表单配置做一次最小结构化调用；它不读取/写入持久设置。 */
export async function testAIRecognitionConnection(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  await requireAuth(request, env);
  const body = await readJson(request, aiRecognitionTestRequestSchema, locale);
  const settings = body.settings;
  const thinkingControl = settings.defaultThinkingControl?.provider === settings.provider
    ? settings.defaultThinkingControl
    : null;
  assertAIRecognitionSettings(settings, locale);
  try {
    await runAIRecognition({
      settings,
      input: { text: AI_RECOGNITION_TEST_TEXT, images: [], thinkingControl },
      locale,
      timezone: "UTC",
      defaultCurrency: "USD",
      configContext: EMPTY_AI_RECOGNITION_CONFIG_CONTEXT,
      thinkingControl,
      maxOutputTokens: 2000,
    });
    return json(aiRecognitionTestResponseSchema.parse({ ok: true, provider: settings.provider, model: settings.model }));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const diagnostics = aiRecognitionDiagnosticsFromError(error);
    const cause = aiRecognitionCauseFromError(error);
    if (isAIRecognitionSchemaMismatch(error)) {
      throw new HttpError(
        400,
        serverText(locale, "aiRecognition.schemaMismatch"),
        "AI_RECOGNITION_SCHEMA_MISMATCH",
        diagnostics ? aiRecognitionErrorDetails("schema_mismatch", cause, diagnostics) : safeAIRecognitionError(cause),
      );
    }
    throw new HttpError(
      400,
      serverText(locale, "aiRecognition.testFailed"),
      "AI_RECOGNITION_TEST_FAILED",
      diagnostics ? aiRecognitionErrorDetails("provider_failed", cause, diagnostics) : safeAIRecognitionError(cause),
    );
  }
}

function assertAIRecognitionContentLength(request: Request, locale: AppLocale): void {
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > AI_RECOGNITION_MAX_BODY_BYTES) {
    throw new HttpError(413, serverText(locale, "common.requestBodyTooLarge"), "BODY_TOO_LARGE");
  }
}

async function readAIRecognitionInput(
  request: Request,
  locale: AppLocale,
): Promise<AIRecognitionInput> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (message.includes("too large") || message.includes("body size")) {
      throw new HttpError(413, serverText(locale, "common.requestBodyTooLarge"), "BODY_TOO_LARGE");
    }
    throw new HttpError(400, serverText(locale, "common.invalidPayload"), "AI_RECOGNITION_MULTIPART_INVALID");
  }
  for (const key of form.keys()) {
    if (key !== "text" && key !== "thinkingControl" && key !== "images" && key !== "images[]") {
      throw new HttpError(400, serverText(locale, "common.invalidPayload"), "AI_RECOGNITION_FIELD_INVALID");
    }
  }

  const textEntry = form.get("text");
  const text = typeof textEntry === "string" ? textEntry.trim() : "";
  if ([...text].length > AI_RECOGNITION_MAX_TEXT_CHARS) {
    throw new HttpError(413, serverText(locale, "common.requestBodyTooLarge"), "BODY_TOO_LARGE");
  }

  const thinkingEntry = form.get("thinkingControl");
  // 识别请求只认本次 multipart 明确携带的 thinking；设置页默认值由前端初始化选择，缺字段必须等价于未选择。
  const thinkingControl = parseAIThinkingControl(thinkingEntry, locale);
  const imageEntries = [...form.getAll("images"), ...form.getAll("images[]")].filter((value): value is File => value instanceof File);
  if (imageEntries.length > AI_RECOGNITION_MAX_IMAGES) {
    throw new HttpError(413, serverText(locale, "common.requestBodyTooLarge"), "BODY_TOO_LARGE");
  }
  const images: AIRecognitionInput["images"] = [];
  for (const file of imageEntries) {
    if (file.size <= 0) continue;
    if (file.size > AI_RECOGNITION_MAX_IMAGE_BYTES) {
      throw new HttpError(413, serverText(locale, "common.requestBodyTooLarge"), "BODY_TOO_LARGE");
    }
    const data = new Uint8Array(await file.arrayBuffer());
    images.push({ data, mediaType: normalizeAIImageType(file.type, data, locale) });
  }
  if (!text && images.length === 0) {
    throw new HttpError(400, serverText(locale, "aiRecognition.inputRequired"), "AI_RECOGNITION_INPUT_REQUIRED");
  }
  const totalBytes = new TextEncoder().encode(text).byteLength + images.reduce((sum, image) => sum + image.data.byteLength, 0);
  if (totalBytes > AI_RECOGNITION_MAX_BODY_BYTES) {
    throw new HttpError(413, serverText(locale, "common.requestBodyTooLarge"), "BODY_TOO_LARGE");
  }
  return { text, images, thinkingControl };
}

function parseAIThinkingControl(
  value: FormDataEntryValue | null,
  locale: AppLocale,
): AiThinkingControl | null {
  if (value === null) return null;
  if (value instanceof File) {
    throw new HttpError(400, serverText(locale, "common.invalidPayload"), "AI_THINKING_CONTROL_INVALID");
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") return null;
  let jsonValue: unknown;
  try {
    jsonValue = JSON.parse(trimmed) as unknown;
  } catch {
    throw new HttpError(400, serverText(locale, "common.invalidPayload"), "AI_THINKING_CONTROL_INVALID");
  }
  const parsed = aiThinkingControlSchema.safeParse(jsonValue);
  if (!parsed.success) {
    throw new HttpError(400, serverText(locale, "common.invalidPayload"), "AI_THINKING_CONTROL_INVALID", parsed.error.flatten());
  }
  return parsed.data;
}

async function runAIRecognition({
  settings,
  input,
  locale,
  timezone,
  defaultCurrency,
  configContext,
  thinkingControl,
  maxOutputTokens,
}: {
  settings: AiRecognitionSettings;
  input: AIRecognitionInput;
  locale: AppLocale;
  timezone: string;
  defaultCurrency: string;
  configContext: AIRecognitionPromptConfigContext;
  thinkingControl: AiThinkingControl | null;
  maxOutputTokens: number;
}): Promise<AiRecognizeResponse> {
  const providerOptions = providerOptionsForThinking(thinkingControl);
  const systemPrompt = buildAIRecognitionSystemPrompt();
  const userPrompt = buildAIRecognitionUserPrompt({
    text: input.text,
    timezone,
    defaultCurrency,
    currentDate: todayDateOnly(timezone),
    imageCount: input.images.length,
    locale,
    configContext,
  });
  const capture: AIRecognitionCapture = {
    rawModelText: null,
    usage: null,
    finishReason: null,
    providerMetadata: null,
  };

  try {
    const initialGeneration = await generateAIRecognitionObject({
      settings,
      input,
      systemPrompt,
      userPrompt,
      providerOptions,
      maxOutputTokens,
    });
    let finalGeneration = initialGeneration;
    let diagnostics = diagnosticsFromGeneration(settings, input, thinkingControl, maxOutputTokens, systemPrompt, userPrompt, finalGeneration);
    let response = normalizeGeneratedAIRecognizeObject(finalGeneration.object, settings.provider, settings.model, diagnostics, configContext);
    const missingNames = missingDescribableNoteNames(response.subscriptions);
    if (missingNames.length > 0) {
      const repairPrompt = buildAIRecognitionRepairUserPrompt({
        originalUserPrompt: userPrompt,
        previousObject: finalGeneration.object,
        missingNoteNames: missingNames,
      });
      try {
        finalGeneration = await generateAIRecognitionObject({
          settings,
          input,
          systemPrompt,
          userPrompt: repairPrompt,
          providerOptions,
          maxOutputTokens,
        });
        diagnostics = diagnosticsFromGeneration(settings, input, thinkingControl, maxOutputTokens, systemPrompt, repairPrompt, finalGeneration);
        const repairedResponse = normalizeGeneratedAIRecognizeObject(finalGeneration.object, settings.provider, settings.model, diagnostics, configContext);
        if (repairedResponse.subscriptions.length > 0) response = repairedResponse;
      } catch {
        finalGeneration = initialGeneration;
        diagnostics = diagnosticsFromGeneration(settings, input, thinkingControl, maxOutputTokens, systemPrompt, userPrompt, finalGeneration);
        response = normalizeGeneratedAIRecognizeObject(finalGeneration.object, settings.provider, settings.model, diagnostics, configContext);
      }
      response = fillMissingNotesWithDynamicFallback(response, locale, configContext);
    }
    return response;
  } catch (error) {
    const cause = error instanceof AIRecognitionGenerationError ? error.causeError : error;
    const errorCapture = error instanceof AIRecognitionGenerationError ? error.capture : capture;
    const rawModelText = noObjectGeneratedText(cause) ?? errorCapture.rawModelText;
    const diagnostics = buildAIRecognitionDiagnostics({
      settings,
      input,
      thinkingControl,
      maxOutputTokens,
      systemPrompt,
      userPrompt,
      rawModelText,
      rawObject: null,
      usage: noObjectGeneratedUsage(cause) ?? errorCapture.usage,
      finishReason: noObjectGeneratedFinishReason(cause) ?? errorCapture.finishReason,
      providerMetadata: errorCapture.providerMetadata,
    });
    throw new AIRecognitionRunError(cause, diagnostics);
  }
}

async function generateAIRecognitionObject({
  settings,
  input,
  systemPrompt,
  userPrompt,
  providerOptions,
  maxOutputTokens,
}: {
  settings: AiRecognitionSettings;
  input: AIRecognitionInput;
  systemPrompt: string;
  userPrompt: string;
  providerOptions: Record<string, Record<string, JSONValue>> | undefined;
  maxOutputTokens: number;
}): Promise<AIRecognitionGeneration> {
  const capture: AIRecognitionCapture = {
    rawModelText: null,
    usage: null,
    finishReason: null,
    providerMetadata: null,
  };
  try {
    const result = await generateObject({
      model: createAIRecognitionModel(settings, capture),
      system: systemPrompt,
      messages: buildAIRecognitionMessages(input, userPrompt),
      schema: aiGeneratedRecognizeObjectSchema,
      schemaName: AI_RECOGNITION_SCHEMA_NAME,
      maxOutputTokens,
      ...(providerOptions ? { providerOptions } : {}),
      maxRetries: 1,
    });
    return {
      object: result.object,
      rawModelText: capture.rawModelText,
      usage: result.usage ?? capture.usage,
      finishReason: finishReasonText(result.finishReason) ?? capture.finishReason,
      providerMetadata: result.providerMetadata ?? capture.providerMetadata,
    };
  } catch (error) {
    throw new AIRecognitionGenerationError(error, capture);
  }
}

function diagnosticsFromGeneration(
  settings: AiRecognitionSettings,
  input: AIRecognitionInput,
  thinkingControl: AiThinkingControl | null,
  maxOutputTokens: number,
  systemPrompt: string,
  userPrompt: string,
  generation: AIRecognitionGeneration,
): AiRecognitionDiagnostics {
  return buildAIRecognitionDiagnostics({
    settings,
    input,
    thinkingControl,
    maxOutputTokens,
    systemPrompt,
    userPrompt,
    rawModelText: generation.rawModelText,
    rawObject: generation.object,
    usage: generation.usage,
    finishReason: generation.finishReason,
    providerMetadata: generation.providerMetadata,
  });
}

function normalizeAIImageType(type: string, data: Uint8Array, locale: AppLocale): string {
  const normalized = type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (ALLOWED_IMAGE_TYPES.has(normalized)) return normalized;
  const detected = detectAIImageType(data);
  if (detected) return detected;
  throw new HttpError(400, serverText(locale, "aiRecognition.imageTypeInvalid"), "AI_IMAGE_TYPE_INVALID");
}

function detectAIImageType(data: Uint8Array): string | null {
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (
    data.length >= 12
    && String.fromCharCode(...data.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...data.slice(8, 12)) === "WEBP"
  ) return "image/webp";
  return null;
}

function assertAIRecognitionSettings(settings: AiRecognitionSettings, locale: AppLocale): void {
  if (!settings.model.trim()) {
    throw new HttpError(400, serverText(locale, "aiRecognition.modelRequired"), "AI_MODEL_REQUIRED");
  }
  if (settings.provider === "openai-compatible") {
    if (!settings.baseUrl.trim()) {
      throw new HttpError(400, serverText(locale, "aiRecognition.baseUrlRequired"), "AI_BASE_URL_REQUIRED");
    }
    return;
  }
  if (!settings.apiKey.trim()) {
    throw new HttpError(400, serverText(locale, "aiRecognition.apiKeyRequired"), "AI_API_KEY_REQUIRED");
  }
}

function createAIRecognitionModel(settings: AiRecognitionSettings, capture: AIRecognitionCapture) {
  let model;
  if (settings.provider === "openai") {
    model = createOpenAI({ apiKey: settings.apiKey, ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}) })(settings.model);
  } else if (settings.provider === "gemini") {
    model = createGoogleGenerativeAI({ apiKey: settings.apiKey, ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}) })(settings.model);
  } else if (settings.provider === "anthropic") {
    model = createAnthropic({ apiKey: settings.apiKey, ...(settings.baseUrl ? { baseURL: settings.baseUrl } : {}) })(settings.model);
  } else {
    model = createOpenAICompatible({
      name: "openai-compatible",
      baseURL: settings.baseUrl,
      ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
      supportsStructuredOutputs: true,
    })(settings.model);
  }

  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      async wrapGenerate({ doGenerate }) {
        const result = await doGenerate();
        capture.rawModelText = extractAIModelText(result.content) ?? capture.rawModelText;
        capture.usage = result.usage ?? capture.usage;
        capture.finishReason = finishReasonText(result.finishReason) ?? capture.finishReason;
        capture.providerMetadata = result.providerMetadata ?? capture.providerMetadata;
        return result;
      },
    },
  });
}

function providerOptionsForThinking(control: AiThinkingControl | null): Record<string, Record<string, JSONValue>> | undefined {
  if (!control) return undefined;
  if (control.provider === "openai") {
    return { openai: { reasoningEffort: control.effort } };
  }
  if (control.provider === "gemini") {
    if (control.mode === "off") return { google: { thinkingConfig: { thinkingBudget: 0 } } };
    if (control.mode === "dynamic") return { google: { thinkingConfig: { thinkingBudget: -1 } } };
    if (control.mode === "budget") return { google: { thinkingConfig: { thinkingBudget: control.budget } } };
    return { google: { thinkingConfig: { thinkingLevel: control.level } } };
  }
  if (control.mode === "effort") {
    return { anthropic: { effort: control.effort } };
  }
  return { anthropic: { thinking: { type: "enabled", budgetTokens: control.budgetTokens } } };
}

function buildAIRecognitionMessages(input: AIRecognitionInput, userPrompt: string): ModelMessage[] {
  const content: UserContent = [
    { type: "text", text: userPrompt },
    ...input.images.map((image) => ({ type: "image" as const, image: image.data, mediaType: image.mediaType })),
  ];
  return [{ role: "user", content }];
}

function todayDateOnly(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function safeAIRecognitionError(error: unknown): string {
  return redactAIRecognitionSecrets(error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function isAIRecognitionSchemaMismatch(error: unknown): boolean {
  const cause = aiRecognitionCauseFromError(error);
  const message = (cause instanceof Error ? cause.message : String(cause)).toLowerCase();
  return message.includes("no object generated")
    || message.includes("did not match schema")
    || message.includes("schema validation")
    || message.includes("invalid object");
}

function buildAIRecognitionDiagnostics({
  settings,
  input,
  thinkingControl,
  maxOutputTokens,
  systemPrompt,
  userPrompt,
  rawModelText,
  rawObject,
  usage,
  finishReason,
  providerMetadata,
}: {
  settings: AiRecognitionSettings;
  input: AIRecognitionInput;
  thinkingControl: AiThinkingControl | null;
  maxOutputTokens: number;
  systemPrompt: string;
  userPrompt: string;
  rawModelText: string | null;
  rawObject: unknown;
  usage: unknown;
  finishReason: string | null;
  providerMetadata: unknown;
}): AiRecognitionDiagnostics {
  // diagnostics 只进入当前 API 响应，不能入库；这里集中截断/脱敏，避免 provider 原文泄漏密钥。
  return aiRecognitionDiagnosticsSchema.parse({
    schemaVersion: "1",
    promptVersion: AI_RECOGNITION_PROMPT_VERSION,
    schemaName: AI_RECOGNITION_SCHEMA_NAME,
    prompt: {
      system: diagnosticText(systemPrompt, AI_RECOGNITION_DIAGNOSTIC_TEXT_MAX_CHARS),
      user: diagnosticText(userPrompt, AI_RECOGNITION_DIAGNOSTIC_TEXT_MAX_CHARS),
    },
    output: {
      rawModelText: rawModelText === null ? null : diagnosticText(rawModelText, AI_RECOGNITION_DIAGNOSTIC_TEXT_MAX_CHARS),
      rawObjectJson: rawObject === null ? null : diagnosticText(safeJsonStringify(rawObject), AI_RECOGNITION_DIAGNOSTIC_JSON_MAX_CHARS),
    },
    request: {
      provider: settings.provider,
      model: settings.model,
      thinkingControl,
      maxOutputTokens,
      textCharCount: [...input.text].length,
      images: input.images.map((image) => ({ mediaType: image.mediaType, sizeBytes: image.data.byteLength })),
    },
    response: {
      usage: sanitizeDiagnosticJson(usage),
      finishReason,
      providerMetadata: sanitizeDiagnosticJson(providerMetadata),
    },
  });
}

function diagnosticText(value: string, maxChars: number) {
  const safe = redactAIRecognitionSecrets(value);
  const chars = [...safe];
  return {
    value: chars.slice(0, maxChars).join(""),
    truncated: chars.length > maxChars,
  };
}

function sanitizeDiagnosticJson(value: unknown): unknown | null {
  if (value === undefined || value === null) return null;
  const text = diagnosticText(safeJsonStringify(value), AI_RECOGNITION_DIAGNOSTIC_JSON_MAX_CHARS);
  if (text.truncated) return text;
  try {
    return JSON.parse(text.value) as unknown;
  } catch {
    return text;
  }
}

function safeJsonStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint") return item.toString();
      if (item && typeof item === "object") {
        if (seen.has(item)) return "[Circular]";
        seen.add(item);
      }
      return item;
    }, 2);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function redactAIRecognitionSecrets(value: string): string {
  return value.replace(AI_SECRET_PATTERN, "[redacted]");
}

function aiRecognitionErrorDetails(reason: string, error: unknown, diagnostics: AiRecognitionDiagnostics) {
  return aiRecognitionErrorDetailsSchema.parse({
    reason,
    providerMessage: error === null ? null : safeAIRecognitionError(error),
    diagnostics,
  });
}

function aiRecognitionDiagnosticsFromError(error: unknown): AiRecognitionDiagnostics | null {
  return error instanceof AIRecognitionRunError ? error.diagnostics : null;
}

function aiRecognitionCauseFromError(error: unknown): unknown {
  return error instanceof AIRecognitionRunError ? error.causeError : error;
}

function noObjectGeneratedText(error: unknown): string | null {
  return NoObjectGeneratedError.isInstance(error) && typeof error.text === "string" ? error.text : null;
}

function noObjectGeneratedUsage(error: unknown): unknown | null {
  return NoObjectGeneratedError.isInstance(error) ? error.usage ?? null : null;
}

function noObjectGeneratedFinishReason(error: unknown): string | null {
  return NoObjectGeneratedError.isInstance(error) ? finishReasonText(error.finishReason) : null;
}

function finishReasonText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (isRecord(value)) {
    const unified = value["unified"];
    if (typeof unified === "string" && unified.trim()) return unified;
    const raw = value["raw"];
    if (typeof raw === "string" && raw.trim()) return raw;
  }
  return null;
}

function extractAIModelText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  const text = content.map((part) => {
    if (!isRecord(part) || part["type"] !== "text") return "";
    const value = part["text"];
    return typeof value === "string" ? value : "";
  }).join("");
  return text || null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
