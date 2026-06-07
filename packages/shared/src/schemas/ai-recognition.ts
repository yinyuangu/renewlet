import { z } from "zod";
import {
  BILLING_CYCLES,
  CUSTOM_CYCLE_UNITS,
  DISABLED_REMINDER_DAYS,
  MAX_REMINDER_DAYS,
  REPEAT_REMINDER_INTERVALS,
  REPEAT_REMINDER_WINDOWS,
  SUBSCRIPTION_STATUSES,
  isValidDateOnly,
} from "../runtime";

export const AI_RECOGNITION_MAX_TEXT_CHARS = 30_000;
export const AI_RECOGNITION_MAX_IMAGES = 5;
export const AI_RECOGNITION_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const AI_RECOGNITION_MAX_SUBSCRIPTIONS = 100;
export const AI_RECOGNITION_DIAGNOSTIC_TEXT_MAX_CHARS = 32_000;
export const AI_RECOGNITION_DIAGNOSTIC_JSON_MAX_CHARS = 32_000;
export const AI_RECOGNITION_MAX_MODEL_LIST_MODELS = 300;

export const aiRecognitionProviderSchema = z.enum(["openai", "gemini", "anthropic", "openai-compatible"]);
export type AiRecognitionProvider = z.infer<typeof aiRecognitionProviderSchema>;
export const aiRecognitionModelInputModeSchema = z.enum(["select", "manual"]);
export type AiRecognitionModelInputMode = z.infer<typeof aiRecognitionModelInputModeSchema>;

export const openaiReasoningEffortSchema = z.enum(["none", "minimal", "low", "medium", "high", "xhigh"]);
export const geminiThinkingLevelSchema = z.enum(["minimal", "low", "medium", "high"]);
export const anthropicThinkingEffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

export const openaiThinkingControlSchema = z.object({
  provider: z.literal("openai"),
  effort: openaiReasoningEffortSchema,
}).strict();

export const geminiThinkingControlSchema = z.discriminatedUnion("mode", [
  z.object({
    provider: z.literal("gemini"),
    mode: z.literal("off"),
  }).strict(),
  z.object({
    provider: z.literal("gemini"),
    mode: z.literal("dynamic"),
  }).strict(),
  z.object({
    provider: z.literal("gemini"),
    mode: z.literal("budget"),
    budget: z.number().int().min(1).max(32_768),
  }).strict(),
  z.object({
    provider: z.literal("gemini"),
    mode: z.literal("level"),
    level: geminiThinkingLevelSchema,
  }).strict(),
]);

export const anthropicThinkingControlSchema = z.discriminatedUnion("mode", [
  z.object({
    provider: z.literal("anthropic"),
    mode: z.literal("effort"),
    effort: anthropicThinkingEffortSchema,
  }).strict(),
  z.object({
    provider: z.literal("anthropic"),
    mode: z.literal("budget"),
    budgetTokens: z.number().int().min(1024).max(64_000),
  }).strict(),
]);

export const aiThinkingControlSchema = z.union([
  openaiThinkingControlSchema,
  geminiThinkingControlSchema,
  anthropicThinkingControlSchema,
]);
export type AiThinkingControl = z.infer<typeof aiThinkingControlSchema>;

const optionalProviderBaseUrlSchema = z.string().trim().max(2048).refine((value) => {
  if (!value) return true;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}, "AI base URL must be empty or an http(s) URL without credentials");

export const aiRecognitionSettingsSchema = z.object({
  provider: aiRecognitionProviderSchema,
  model: z.string().trim().max(160),
  modelInputMode: aiRecognitionModelInputModeSchema.default("select"),
  baseUrl: optionalProviderBaseUrlSchema,
  apiKey: z.string().trim().max(4096),
  defaultThinkingControl: aiThinkingControlSchema.nullable(),
}).strict();
export type AiRecognitionSettings = z.infer<typeof aiRecognitionSettingsSchema>;

const aiRecognitionDiagnosticTextSchema = z.object({
  value: z.string().max(AI_RECOGNITION_DIAGNOSTIC_TEXT_MAX_CHARS),
  truncated: z.boolean(),
}).strict();
export type AiRecognitionDiagnosticText = z.infer<typeof aiRecognitionDiagnosticTextSchema>;

export const aiRecognitionDiagnosticsSchema = z.object({
  schemaVersion: z.literal("1"),
  promptVersion: z.string().trim().min(1).max(80),
  schemaName: z.string().trim().min(1).max(120),
  prompt: z.object({
    system: aiRecognitionDiagnosticTextSchema,
    user: aiRecognitionDiagnosticTextSchema,
  }).strict(),
  output: z.object({
    rawModelText: aiRecognitionDiagnosticTextSchema.nullable(),
    rawObjectJson: aiRecognitionDiagnosticTextSchema.nullable(),
  }).strict(),
  request: z.object({
    provider: aiRecognitionProviderSchema,
    model: z.string().trim().min(1).max(160),
    thinkingControl: aiThinkingControlSchema.nullable(),
    maxOutputTokens: z.number().int().positive().max(128_000),
    textCharCount: z.number().int().nonnegative().max(AI_RECOGNITION_MAX_TEXT_CHARS),
    images: z.array(z.object({
      mediaType: z.string().trim().min(1).max(80),
      sizeBytes: z.number().int().nonnegative().max(AI_RECOGNITION_MAX_IMAGE_BYTES),
    }).strict()).max(AI_RECOGNITION_MAX_IMAGES),
  }).strict(),
  response: z.object({
    usage: z.unknown().nullable(),
    finishReason: z.string().trim().max(120).nullable(),
    providerMetadata: z.unknown().nullable(),
  }).strict(),
}).strict();
export type AiRecognitionDiagnostics = z.infer<typeof aiRecognitionDiagnosticsSchema>;

export const aiRecognitionErrorDetailsSchema = z.object({
  reason: z.string().trim().min(1).max(120),
  providerMessage: z.string().trim().max(1000).nullable(),
  diagnostics: aiRecognitionDiagnosticsSchema,
}).strict();
export type AiRecognitionErrorDetails = z.infer<typeof aiRecognitionErrorDetailsSchema>;

const dateOnlyNullableSchema = z.string().refine(isValidDateOnly, "Invalid date").nullable();
const suggestedFieldSourceSchema = z.enum(["input", "suggested"]);
const generatedNotesSourceSchema = z.enum(["input", "suggested", "none"]);
const suggestedTextFieldSchema = z.object({
  value: z.string().trim().max(5000),
  source: suggestedFieldSourceSchema,
}).strict();
const generatedNumberSchema = z.union([z.number().finite(), z.string().trim().max(80)]).nullable();
const generatedIntegerSchema = z.union([z.number().int(), z.string().trim().max(80)]).nullable();
const generatedTextSchema = z.string().trim().max(5000).nullable();
const generatedWebsiteFieldSchema = z.object({
  value: z.string().trim().max(5000),
  source: suggestedFieldSourceSchema,
}).strict().nullable().describe("Official or user-provided website for the subscribed service. Use null when the official site is ambiguous or unknown.");
const generatedNotesFieldSchema = z.object({
  value: z.string().trim().max(5000).nullable().describe("Concise neutral service/site description. Must be non-null for describable services; not a category, import advice, confirmation reminder, or AI process note."),
  source: generatedNotesSourceSchema,
}).strict().describe("Required service/site description decision object. Use value=null and source=none only when the service purpose is truly unknowable from input, domain, service name, category, tags, or high-confidence public knowledge.");
const generatedTagsSchema = z.array(z.string().trim().max(40))
  .max(3)
  .describe("User-facing reusable organization tags. Prefer existing user tags from prompt context; if none fit, generate only stable reusable service/product/domain tags, not one-off order attributes.");
const generatedCategorySchema = z.string().trim().max(80).nullable()
  .describe("Renewlet category value from provided options when possible; otherwise a concise user-facing category only when the service type is obvious.");
const generatedPaymentMethodSchema = z.string().trim().max(80).nullable()
  .describe("Renewlet payment method value from provided options when possible; otherwise a concise user-facing payment method only when the input explicitly names one.");
const generatedConfidenceSchema = z.enum(["high", "low"])
  .describe("Use high only when the extracted row can be directly confirmed; use low for ambiguous, partial, or inferred records.");
const generatedWarningsSchema = z.array(z.string().trim().min(1).max(240))
  .max(12)
  .describe("Stable warning codes for uncertain or invalid fields; keep uncertainty out of notes.");

export const aiRecognizedSubscriptionDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  price: z.number().finite().nonnegative().max(1_000_000_000).nullable(),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).nullable(),
  billingCycle: z.enum(BILLING_CYCLES).nullable(),
  customDays: z.number().int().positive().nullable(),
  customCycleUnit: z.enum(CUSTOM_CYCLE_UNITS).nullable(),
  oneTimeTermCount: z.number().int().positive().max(MAX_REMINDER_DAYS).nullable(),
  oneTimeTermUnit: z.enum(CUSTOM_CYCLE_UNITS).nullable(),
  category: z.string().trim().min(1).max(80).nullable(),
  status: z.enum(SUBSCRIPTION_STATUSES).nullable(),
  paymentMethod: z.string().trim().min(1).max(80).nullable(),
  startDate: dateOnlyNullableSchema,
  nextBillingDate: dateOnlyNullableSchema,
  autoCalculateNextBillingDate: z.boolean().nullable(),
  trialEndDate: dateOnlyNullableSchema,
  website: suggestedTextFieldSchema.nullable(),
  notes: suggestedTextFieldSchema.nullable(),
  tags: z.array(z.string().trim().min(1).max(40)).max(100),
  reminderDays: z.number().int().min(DISABLED_REMINDER_DAYS).max(MAX_REMINDER_DAYS).nullable(),
  repeatReminderEnabled: z.boolean().nullable(),
  repeatReminderInterval: z.enum(REPEAT_REMINDER_INTERVALS).nullable(),
  repeatReminderWindow: z.enum(REPEAT_REMINDER_WINDOWS).nullable(),
  confidence: z.enum(["high", "low"]),
  warnings: z.array(z.string().trim().min(1).max(240)).max(12),
}).strict();
export type AiRecognizedSubscriptionDraft = z.infer<typeof aiRecognizedSubscriptionDraftSchema>;

export const aiRecognizeResponseSchema = z.object({
  provider: aiRecognitionProviderSchema,
  model: z.string().trim().min(1).max(160),
  subscriptions: z.array(aiRecognizedSubscriptionDraftSchema).max(AI_RECOGNITION_MAX_SUBSCRIPTIONS),
  warnings: z.array(z.string().trim().min(1).max(240)).max(20),
  diagnostics: aiRecognitionDiagnosticsSchema,
}).strict();
export type AiRecognizeResponse = z.infer<typeof aiRecognizeResponseSchema>;

export const aiGeneratedSubscriptionDraftSchema = z.object({
  name: z.string().trim().max(120),
  price: generatedNumberSchema,
  currency: z.string().trim().max(40).nullable(),
  billingCycle: z.string().trim().max(80).nullable(),
  customDays: generatedIntegerSchema,
  customCycleUnit: z.string().trim().max(40).nullable(),
  oneTimeTermCount: generatedIntegerSchema,
  oneTimeTermUnit: z.string().trim().max(40).nullable(),
  category: generatedCategorySchema,
  status: z.string().trim().max(40).nullable(),
  paymentMethod: generatedPaymentMethodSchema,
  startDate: generatedTextSchema,
  nextBillingDate: generatedTextSchema,
  autoCalculateNextBillingDate: z.boolean().nullable(),
  trialEndDate: generatedTextSchema,
  website: generatedWebsiteFieldSchema,
  notes: generatedNotesFieldSchema,
  tags: generatedTagsSchema,
  reminderDays: generatedIntegerSchema,
  repeatReminderEnabled: z.boolean().nullable(),
  repeatReminderInterval: z.string().trim().max(40).nullable(),
  repeatReminderWindow: z.string().trim().max(40).nullable(),
  confidence: generatedConfidenceSchema,
  warnings: generatedWarningsSchema,
}).strict();
export type AiGeneratedSubscriptionDraft = z.infer<typeof aiGeneratedSubscriptionDraftSchema>;

export const aiGeneratedRecognizeObjectSchema = z.object({
  subscriptions: z.array(aiGeneratedSubscriptionDraftSchema).max(AI_RECOGNITION_MAX_SUBSCRIPTIONS),
  warnings: z.array(z.string().trim().min(1).max(240)).max(20),
}).strict();
export type AiGeneratedRecognizeObject = z.infer<typeof aiGeneratedRecognizeObjectSchema>;

export const aiRecognitionTestRequestSchema = z.object({
  settings: aiRecognitionSettingsSchema,
}).strict();
export type AiRecognitionTestRequest = z.infer<typeof aiRecognitionTestRequestSchema>;

export const aiRecognitionTestResponseSchema = z.object({
  ok: z.literal(true),
  provider: aiRecognitionProviderSchema,
  model: z.string().trim().min(1).max(160),
}).strict();
export type AiRecognitionTestResponse = z.infer<typeof aiRecognitionTestResponseSchema>;

const aiModelCapabilitySchema = z.object({
  textInput: z.boolean().nullable(),
  imageInput: z.boolean().nullable(),
  structuredOutput: z.boolean().nullable(),
  thinking: z.boolean().nullable(),
}).strict();
export type AiModelCapability = z.infer<typeof aiModelCapabilitySchema>;

export const aiModelListRequestSchema = z.object({
  provider: aiRecognitionProviderSchema,
  baseUrl: optionalProviderBaseUrlSchema,
  apiKey: z.string().trim().max(4096),
}).strict();
export type AiModelListRequest = z.infer<typeof aiModelListRequestSchema>;

export const aiModelListItemSchema = z.object({
  id: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200).nullable(),
  createdAt: z.string().trim().min(1).max(120).nullable(),
  ownedBy: z.string().trim().min(1).max(120).nullable(),
  inputTokenLimit: z.number().int().positive().max(10_000_000).nullable(),
  outputTokenLimit: z.number().int().positive().max(10_000_000).nullable(),
  capabilities: aiModelCapabilitySchema,
}).strict();
export type AiModelListItem = z.infer<typeof aiModelListItemSchema>;

export const aiModelListResponseSchema = z.object({
  provider: aiRecognitionProviderSchema,
  models: z.array(aiModelListItemSchema).max(AI_RECOGNITION_MAX_MODEL_LIST_MODELS),
  truncated: z.boolean(),
}).strict();
export type AiModelListResponse = z.infer<typeof aiModelListResponseSchema>;

export const aiModelListErrorDetailsSchema = z.object({
  reason: z.string().trim().min(1).max(120),
  providerMessage: z.string().trim().max(1000).nullable(),
}).strict();
export type AiModelListErrorDetails = z.infer<typeof aiModelListErrorDetailsSchema>;
