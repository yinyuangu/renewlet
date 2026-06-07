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
  AI_RECOGNITION_MAX_SUBSCRIPTIONS,
  AI_RECOGNITION_MAX_TEXT_CHARS,
  aiGeneratedRecognizeObjectSchema,
  aiRecognitionDiagnosticsSchema,
  aiRecognitionErrorDetailsSchema,
  aiRecognizeResponseSchema,
  aiRecognitionTestRequestSchema,
  aiRecognitionTestResponseSchema,
  aiThinkingControlSchema,
  type AiGeneratedRecognizeObject,
  type AiGeneratedSubscriptionDraft,
  type AiRecognizedSubscriptionDraft,
  type AiRecognitionDiagnostics,
  type AiRecognitionSettings,
  type AiThinkingControl,
  type AiRecognizeResponse,
} from "@renewlet/shared/schemas/ai-recognition";
import {
  AI_RECOGNITION_PROMPT_VERSION,
  AI_RECOGNITION_SCHEMA_NAME,
  type AIRecognitionPromptConfigContext,
  type AIRecognitionPromptConfigOption,
  buildAIRecognitionSystemPrompt,
  buildAIRecognitionRepairUserPrompt,
  buildAIRecognitionUserPrompt,
} from "@renewlet/shared/ai-recognition-prompt";
import { normalizeAIRecognitionUsefulNotes } from "@renewlet/shared/ai-recognition-notes";
import { customConfigSchema, type ApiCustomConfig } from "@renewlet/shared/schemas/custom-config";
import {
  BILLING_CYCLES,
  CUSTOM_CYCLE_UNITS,
  DISABLED_REMINDER_DAYS,
  MAX_REMINDER_DAYS,
  REPEAT_REMINDER_INTERVALS,
  REPEAT_REMINDER_WINDOWS,
  SUBSCRIPTION_STATUSES,
  isValidDateOnly,
} from "@renewlet/shared/runtime";
import { getCustomConfig, getSettings, listSubscriptionTags } from "./db";
import { HttpError, json, readJson, requestLocale } from "./http";
import { serverText, type AppLocale } from "./server-i18n";
import { requireAuth } from "./auth";
import type { Env } from "./types";

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

const BILLING_CYCLE_SET = new Set<string>(BILLING_CYCLES);
const CUSTOM_CYCLE_UNIT_SET = new Set<string>(CUSTOM_CYCLE_UNITS);
const STATUS_SET = new Set<string>(SUBSCRIPTION_STATUSES);
const REPEAT_REMINDER_INTERVAL_SET = new Set<string>(REPEAT_REMINDER_INTERVALS);
const REPEAT_REMINDER_WINDOW_SET = new Set<string>(REPEAT_REMINDER_WINDOWS);

function normalizeGeneratedAIRecognizeObject(
  raw: AiGeneratedRecognizeObject,
  provider: AiRecognitionSettings["provider"],
  model: string,
  diagnostics: AiRecognitionDiagnostics,
  configContext: AIRecognitionPromptConfigContext,
): AiRecognizeResponse {
  const warnings = compactAIWarnings(raw.warnings, 20);
  const subscriptions: AiRecognizedSubscriptionDraft[] = [];
  for (const draft of raw.subscriptions.slice(0, AI_RECOGNITION_MAX_SUBSCRIPTIONS)) {
    const normalized = normalizeGeneratedSubscriptionDraft(draft, configContext);
    if (normalized) {
      subscriptions.push(normalized);
    } else {
      warnings.push("AI_WARNING_EMPTY_SUBSCRIPTION_SKIPPED");
    }
  }
  return aiRecognizeResponseSchema.parse({
    provider,
    model,
    subscriptions,
    warnings: compactAIWarnings(warnings, 20),
    diagnostics,
  });
}

function normalizeGeneratedSubscriptionDraft(
  draft: AiGeneratedSubscriptionDraft,
  configContext: AIRecognitionPromptConfigContext,
): AiRecognizedSubscriptionDraft | null {
  const name = trimMax(draft.name, 120);
  if (!name) return null;
  const warnings = compactAIWarnings(draft.warnings, 12);
  const website = normalizeGeneratedSuggestedField(draft.website);
  const notes = normalizeGeneratedNotesField(draft.notes);
  const confidence = draft.confidence === "high" ? "high" : "low";
  return {
    name,
    price: normalizeGeneratedPrice(draft.price, warnings),
    currency: normalizeGeneratedCurrency(draft.currency, warnings),
    billingCycle: normalizeGeneratedBillingCycle(draft.billingCycle, warnings),
    customDays: normalizeGeneratedPositiveInteger(draft.customDays, MAX_REMINDER_DAYS, "AI_WARNING_CUSTOM_DAYS_INVALID", warnings),
    customCycleUnit: normalizeGeneratedEnum(draft.customCycleUnit, CUSTOM_CYCLE_UNIT_SET, "AI_WARNING_CUSTOM_CYCLE_UNIT_INVALID", warnings),
    oneTimeTermCount: normalizeGeneratedPositiveInteger(draft.oneTimeTermCount, MAX_REMINDER_DAYS, "AI_WARNING_ONE_TIME_TERM_COUNT_INVALID", warnings),
    oneTimeTermUnit: normalizeGeneratedEnum(draft.oneTimeTermUnit, CUSTOM_CYCLE_UNIT_SET, "AI_WARNING_ONE_TIME_TERM_UNIT_INVALID", warnings),
    category: normalizeGeneratedConfigValue(draft.category, configContext.categories),
    status: normalizeGeneratedEnum(draft.status, STATUS_SET, "AI_WARNING_STATUS_INVALID", warnings),
    paymentMethod: normalizeGeneratedConfigValue(draft.paymentMethod, configContext.paymentMethods),
    startDate: normalizeGeneratedDate(draft.startDate, "startDate", warnings),
    nextBillingDate: normalizeGeneratedDate(draft.nextBillingDate, "nextBillingDate", warnings),
    autoCalculateNextBillingDate: draft.autoCalculateNextBillingDate ?? null,
    trialEndDate: normalizeGeneratedDate(draft.trialEndDate, "trialEndDate", warnings),
    website,
    notes,
    tags: normalizeGeneratedTags(draft.tags, draft.name, configContext.tags),
    reminderDays: normalizeGeneratedReminderDays(draft.reminderDays, warnings),
    repeatReminderEnabled: draft.repeatReminderEnabled ?? null,
    repeatReminderInterval: normalizeGeneratedEnum(draft.repeatReminderInterval, REPEAT_REMINDER_INTERVAL_SET, "AI_WARNING_REPEAT_INTERVAL_INVALID", warnings),
    repeatReminderWindow: normalizeGeneratedEnum(draft.repeatReminderWindow, REPEAT_REMINDER_WINDOW_SET, "AI_WARNING_REPEAT_WINDOW_INVALID", warnings),
    confidence,
    warnings: compactAIWarnings(warnings, 12),
  };
}

function missingDescribableNoteNames(subscriptions: readonly AiRecognizedSubscriptionDraft[]): string[] {
  return subscriptions
    .filter((draft) => !draft.notes && isDescribableForAINotes(draft))
    .map((draft) => draft.name)
    .slice(0, 20);
}

function isDescribableForAINotes(draft: AiRecognizedSubscriptionDraft): boolean {
  return Boolean(draft.website || draft.category || draft.tags.length > 0 || draft.confidence === "high");
}

function fillMissingNotesWithDynamicFallback(
  response: AiRecognizeResponse,
  locale: AppLocale,
  configContext: AIRecognitionPromptConfigContext,
): AiRecognizeResponse {
  const subscriptions = response.subscriptions.map((draft) => {
    if (draft.notes || !isDescribableForAINotes(draft)) return draft;
    const note = buildDynamicFallbackNote(draft, locale, configContext);
    if (!note) return draft;
    return {
      ...draft,
      notes: { value: note, source: "suggested" as const },
      warnings: compactAIWarnings(draft.warnings.filter((warning) => warning !== "AI_WARNING_NOTES_MISSING"), 12),
    };
  });
  return aiRecognizeResponseSchema.parse({ ...response, subscriptions });
}

function buildDynamicFallbackNote(
  draft: AiRecognizedSubscriptionDraft,
  locale: AppLocale,
  configContext: AIRecognitionPromptConfigContext,
): string | null {
  const labels = dynamicNoteLabels(draft, configContext);
  const rawNote = labels.length > 0
    ? locale === "zh-CN"
      ? `${draft.name} 是提供 ${labels.join("、")}相关产品或服务的订阅服务。`
      : `${draft.name} is a subscription service related to ${labels.join(", ")}.`
    : dynamicWebsiteFallbackNote(draft, locale);
  return normalizeAIRecognitionUsefulNotes(rawNote);
}

function dynamicNoteLabels(
  draft: AiRecognizedSubscriptionDraft,
  configContext: AIRecognitionPromptConfigContext,
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    const label = trimMax(value ?? "", 80);
    const key = configMatchKey(label);
    if (!label || !key || key === configMatchKey(draft.name) || seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  };
  for (const tag of draft.tags) add(tag);
  if (draft.category) {
    const category = configContext.categories.find((option) => option.value === draft.category) ?? findAIRecognitionConfigOption(configContext.categories, draft.category);
    add(category?.label ?? draft.category);
  }
  return labels.slice(0, 3);
}

function dynamicWebsiteFallbackNote(draft: AiRecognizedSubscriptionDraft, locale: AppLocale): string | null {
  const domain = draft.website ? hostnameFromUrl(draft.website.value) : null;
  if (!domain) return null;
  return locale === "zh-CN"
    ? `${draft.name} 是与 ${domain} 相关的在线服务。`
    : `${draft.name} is an online service associated with ${domain}.`;
}

function hostnameFromUrl(value: string): string | null {
  try {
    const url = new URL(value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function normalizeGeneratedPrice(value: AiGeneratedSubscriptionDraft["price"], warnings: string[]): number | null {
  const parsed = parseGeneratedNumber(value);
  if (parsed === null) return null;
  if (parsed < 0 || parsed > 1_000_000_000) {
    warnings.push("AI_WARNING_PRICE_INVALID");
    return null;
  }
  return parsed;
}

function normalizeGeneratedCurrency(value: string | null | undefined, warnings: string[]): string | null {
  const text = stringValue(value).toUpperCase();
  if (!text) return null;
  const mapped = text === "元" || text === "人民币" || text === "RMB" || text === "YUAN" || text === "￥" || text === "¥"
    ? "CNY"
    : text;
  if (/^[A-Z]{3}$/.test(mapped)) return mapped;
  warnings.push("AI_WARNING_CURRENCY_INVALID");
  return null;
}

function normalizeGeneratedBillingCycle(value: string | null | undefined, warnings: string[]): AiRecognizedSubscriptionDraft["billingCycle"] {
  const text = stringValue(value).toLowerCase();
  if (!text) return null;
  if (BILLING_CYCLE_SET.has(text)) return text as AiRecognizedSubscriptionDraft["billingCycle"];
  const compact = text.replace(/\s+/g, "");
  const mapped = compact.includes("week") || compact.includes("周") ? "weekly"
    : compact.includes("quarter") || compact.includes("季") ? "quarterly"
      : compact.includes("semi") || compact.includes("half") || compact.includes("半年") ? "semi-annual"
        : compact.includes("year") || compact.includes("annual") || compact.includes("年") ? "annual"
          : compact.includes("month") || compact.includes("月") ? "monthly"
            : compact.includes("one-time") || compact.includes("lifetime") || compact.includes("一次") || compact.includes("买断") ? "one-time"
              : null;
  if (mapped) return mapped as AiRecognizedSubscriptionDraft["billingCycle"];
  warnings.push("AI_WARNING_BILLING_CYCLE_INVALID");
  return null;
}

function normalizeGeneratedPositiveInteger(
  value: AiGeneratedSubscriptionDraft["customDays"],
  max: number,
  warning: string,
  warnings: string[],
): number | null {
  const parsed = parseGeneratedInteger(value);
  if (parsed === null) return null;
  if (parsed <= 0 || parsed > max) {
    warnings.push(warning);
    return null;
  }
  return parsed;
}

function normalizeGeneratedReminderDays(value: AiGeneratedSubscriptionDraft["reminderDays"], warnings: string[]): number | null {
  const parsed = parseGeneratedInteger(value);
  if (parsed === null) return null;
  if (parsed < DISABLED_REMINDER_DAYS || parsed > MAX_REMINDER_DAYS) {
    warnings.push("AI_WARNING_REMINDER_DAYS_INVALID");
    return null;
  }
  return parsed;
}

function normalizeGeneratedEnum<T extends string>(
  value: string | null | undefined,
  allowed: Set<string>,
  warning: string,
  warnings: string[],
): T | null {
  const text = stringValue(value);
  if (!text) return null;
  if (allowed.has(text)) return text as T;
  warnings.push(warning);
  return null;
}

function normalizeGeneratedOptionalText(value: string | null | undefined, maxLength: number): string | null {
  return trimMax(stringValue(value), maxLength) || null;
}

function normalizeGeneratedConfigValue(
  value: string | null | undefined,
  options: readonly AIRecognitionPromptConfigOption[],
): string | null {
  const text = normalizeGeneratedOptionalText(value, 80);
  if (!text) return null;
  const matched = findAIRecognitionConfigOption(options, text);
  return matched?.value ?? text;
}

function normalizeGeneratedDate(value: string | null | undefined, field: string, warnings: string[]): string | null {
  const text = stringValue(value);
  if (!text) return null;
  if (isValidDateOnly(text)) return text;
  warnings.push(`AI_WARNING_DATE_INVALID:${field}`);
  return null;
}

function normalizeGeneratedSuggestedField(value: AiGeneratedSubscriptionDraft["website"]): AiRecognizedSubscriptionDraft["website"] {
  if (!value) return null;
  const text = trimMax(value.value ?? "", 5000);
  if (!text) return null;
  return { value: text, source: value.source === "input" ? "input" : "suggested" };
}

function normalizeGeneratedNotesField(value: AiGeneratedSubscriptionDraft["notes"]): AiRecognizedSubscriptionDraft["notes"] {
  if (!value || value.source === "none") return null;
  const text = normalizeAIRecognitionUsefulNotes(value.value);
  if (!text) return null;
  return { value: text, source: value.source === "input" ? "input" : "suggested" };
}

function normalizeGeneratedTags(tags: readonly string[], subscriptionName: string, existingTags: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const existing = existingTagMap(existingTags);
  const serviceKey = tagMatchKey(subscriptionName);
  for (const tag of tags) {
    const value = trimMax(tag, 40);
    const key = tagMatchKey(value);
    if (!value || seen.has(key)) continue;
    const existingValue = existing.get(key);
    const nextValue = existingValue ?? value;
    if (!existingValue && !isUsefulGeneratedTag(value, key, serviceKey)) continue;
    seen.add(key);
    out.push(nextValue);
    if (out.length >= 3) break;
  }
  return out;
}

function existingTagMap(tags: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const tag of tags) {
    const value = trimMax(tag, 40);
    const key = tagMatchKey(value);
    if (key && !out.has(key)) out.set(key, value);
  }
  return out;
}

function tagMatchKey(value: string): string {
  return configMatchKey(value);
}

function isUsefulGeneratedTag(value: string, key: string, serviceKey: string): boolean {
  if (!key || (serviceKey && key === serviceKey)) return false;
  const length = [...value.trim()].length;
  const lower = value.trim().toLowerCase();
  if (length < 2 || length > 20) return false;
  if (lower.includes("://") || lower.startsWith("www.") || ["#", "(", ")", "（", "）", "[", "]", "【", "】", "/", "\\", "|", ":", "："].some((separator) => value.includes(separator))) return false;
  if (/\p{Number}/u.test(value) || looksLikeBillingTag(lower) || looksLikeOrderAttributeTag(lower)) return false;
  if (isShortHanTag(value)) return false;
  return true;
}

function looksLikeBillingTag(value: string): boolean {
  return ["usd", "cny", "rmb", "eur", "gbp", "jpy", "¥", "￥", "$", "月", "年", "weekly", "monthly", "annual", "账单", "价格", "付款", "支付", "扣费", "续费"]
    .some((fragment) => value.includes(fragment));
}

function looksLikeOrderAttributeTag(value: string): boolean {
  return ["special", "promo", "promotion", "plan", "套餐", "促销", "机房", "节点", "区域", "地区", "线路", "location", "region", "datacenter"]
    .some((fragment) => value.includes(fragment));
}

function isShortHanTag(value: string): boolean {
  const chars = [...value.trim()];
  return chars.length > 0 && chars.length <= 2 && chars.every((char) => /\p{Script=Han}/u.test(char));
}

function parseGeneratedNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const text = stringValue(value).replace(/,/g, "");
  const match = /-?\d+(?:\.\d+)?/.exec(text);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGeneratedInteger(value: number | string | null | undefined): number | null {
  const parsed = parseGeneratedNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function compactAIWarnings(warnings: readonly string[], maxCount: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const warning of warnings) {
    const value = trimMax(warning, 240);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= maxCount) break;
  }
  return out;
}

function trimMax(value: string, maxLength: number): string {
  return [...value.trim()].slice(0, maxLength).join("");
}

function stringValue(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function aiRecognitionConfigContext(rawConfig: unknown, locale: AppLocale, tags: readonly string[] = []): AIRecognitionPromptConfigContext {
  const parsed = customConfigSchema.safeParse(rawConfig);
  const config = parsed.success ? parsed.data : { categories: [], paymentMethods: [], statuses: [], currencies: [] };
  return {
    categories: config.categories.map((item) => aiRecognitionConfigOption(item, locale)),
    paymentMethods: config.paymentMethods.map((item) => aiRecognitionConfigOption(item, locale)),
    tags,
  };
}

function aiRecognitionConfigOption(
  item: ApiCustomConfig["categories"][number],
  locale: AppLocale,
): AIRecognitionPromptConfigOption {
  return {
    value: item.value,
    label: locale === "en-US" ? item.labels["en-US"] : item.labels["zh-CN"],
    zhCN: item.labels["zh-CN"],
    enUS: item.labels["en-US"],
  };
}

function findAIRecognitionConfigOption(
  options: readonly AIRecognitionPromptConfigOption[],
  text: string,
): AIRecognitionPromptConfigOption | null {
  const key = configMatchKey(text);
  if (!key) return null;
  return options.find((option) => (
    configMatchKey(option.value) === key
    || configMatchKey(option.label) === key
    || configMatchKey(option.zhCN) === key
    || configMatchKey(option.enUS) === key
  )) ?? null;
}

function configMatchKey(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/[\s_\-—–/\\|&+，,、.。:：()（）[\]【】]+/g, "");
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
