import { describe, expect, it } from "vitest";
import {
  AI_RECOGNITION_MAX_IMAGES,
  aiGeneratedRecognizeObjectSchema,
  aiModelListRequestSchema,
  aiModelListResponseSchema,
  aiRecognitionDiagnosticsSchema,
  aiRecognitionSettingsSchema,
} from "./ai-recognition";

function generatedDraft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "youtube",
    price: 15,
    currency: "USD",
    billingCycle: "annual",
    customDays: null,
    customCycleUnit: null,
    oneTimeTermCount: null,
    oneTimeTermUnit: null,
    category: "entertainment",
    status: "active",
    paymentMethod: null,
    startDate: null,
    nextBillingDate: null,
    autoCalculateNextBillingDate: true,
    trialEndDate: null,
    website: { value: "https://www.youtube.com/", source: "suggested" },
    notes: { value: "YouTube 是 Google 旗下的视频分享和流媒体平台。", source: "suggested" },
    tags: ["流媒体"],
    reminderDays: null,
    repeatReminderEnabled: null,
    repeatReminderInterval: null,
    repeatReminderWindow: null,
    confidence: "high",
    warnings: [],
    ...overrides,
  };
}

describe("AI recognition generated schema", () => {
  it("requires complete draft fields and a notes decision object", () => {
    expect(aiGeneratedRecognizeObjectSchema.safeParse({
      subscriptions: [generatedDraft()],
      warnings: [],
    }).success).toBe(true);

    const withoutNotes = generatedDraft();
    delete withoutNotes.notes;
    expect(aiGeneratedRecognizeObjectSchema.safeParse({
      subscriptions: [withoutNotes],
      warnings: [],
    }).success).toBe(false);

    expect(aiGeneratedRecognizeObjectSchema.safeParse({
      subscriptions: [generatedDraft({ notes: {} })],
      warnings: [],
    }).success).toBe(false);

    expect(aiGeneratedRecognizeObjectSchema.safeParse({
      subscriptions: [generatedDraft({ notes: null })],
      warnings: [],
    }).success).toBe(false);

    expect(aiGeneratedRecognizeObjectSchema.safeParse({
      subscriptions: [generatedDraft({ notes: { value: null, source: "none" } })],
      warnings: [],
    }).success).toBe(true);
  });

  it("requires top-level warnings and draft warning arrays", () => {
    expect(aiGeneratedRecognizeObjectSchema.safeParse({
      subscriptions: [generatedDraft()],
    }).success).toBe(false);

    const withoutDraftWarnings = generatedDraft();
    delete withoutDraftWarnings.warnings;
    expect(aiGeneratedRecognizeObjectSchema.safeParse({
      subscriptions: [withoutDraftWarnings],
      warnings: [],
    }).success).toBe(false);
  });

  it("limits generated tags to a small reusable set", () => {
    expect(aiGeneratedRecognizeObjectSchema.safeParse({
      subscriptions: [generatedDraft({ tags: ["VPS", "云服务器", "流媒体"] })],
      warnings: [],
    }).success).toBe(true);

    expect(aiGeneratedRecognizeObjectSchema.safeParse({
      subscriptions: [generatedDraft({ tags: ["VPS", "云服务器", "流媒体", "Debian 12"] })],
      warnings: [],
    }).success).toBe(false);
  });
});

describe("AI recognition diagnostics schema", () => {
  it("allows five image metadata entries and rejects more", () => {
    const diagnostics = {
      schemaVersion: "1",
      promptVersion: "test",
      schemaName: "renewlet_ai_subscription_recognition",
      prompt: {
        system: { value: "system", truncated: false },
        user: { value: "user", truncated: false },
      },
      output: {
        rawModelText: null,
        rawObjectJson: null,
      },
      request: {
        provider: "openai",
        model: "gpt-5.1",
        thinkingControl: null,
        maxOutputTokens: 12000,
        textCharCount: 0,
        images: Array.from({ length: AI_RECOGNITION_MAX_IMAGES }, () => ({ mediaType: "image/png", sizeBytes: 4 })),
      },
      response: {
        usage: null,
        finishReason: null,
        providerMetadata: null,
      },
    };

    expect(aiRecognitionDiagnosticsSchema.safeParse(diagnostics).success).toBe(true);
    expect(aiRecognitionDiagnosticsSchema.safeParse({
      ...diagnostics,
      request: {
        ...diagnostics.request,
        images: [...diagnostics.request.images, { mediaType: "image/png", sizeBytes: 4 }],
      },
    }).success).toBe(false);
  });
});

describe("AI model list schema", () => {
  it("accepts normalized provider model list items", () => {
    expect(aiModelListRequestSchema.parse({
      provider: "gemini",
      baseUrl: "",
      apiKey: "AIza-test-key",
    })).toEqual({
      provider: "gemini",
      baseUrl: "",
      apiKey: "AIza-test-key",
    });

    expect(aiModelListResponseSchema.safeParse({
      provider: "gemini",
      models: [{
        id: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        createdAt: null,
        ownedBy: null,
        inputTokenLimit: 1048576,
        outputTokenLimit: 65536,
        capabilities: {
          textInput: true,
          imageInput: null,
          structuredOutput: null,
          thinking: true,
        },
      }],
      truncated: false,
    }).success).toBe(true);
  });

  it("rejects model list payloads with unexpected fields", () => {
    expect(aiModelListRequestSchema.safeParse({
      provider: "openai",
      baseUrl: "",
      apiKey: "sk-test",
      model: "gpt-5.1",
    }).success).toBe(false);

    expect(aiModelListResponseSchema.safeParse({
      provider: "openai",
      models: [{
        id: "gpt-5.1",
        displayName: null,
        createdAt: null,
        ownedBy: null,
        inputTokenLimit: null,
        outputTokenLimit: null,
        capabilities: {
          textInput: null,
          imageInput: null,
          structuredOutput: null,
          thinking: null,
          hidden: true,
        },
      }],
      truncated: false,
    }).success).toBe(false);
  });
});

describe("AI recognition settings schema", () => {
  it("defaults the model input mode to select for existing settings", () => {
    expect(aiRecognitionSettingsSchema.parse({
      provider: "openai",
      model: "gpt-5.1",
      baseUrl: "",
      apiKey: "sk-test",
      defaultThinkingControl: null,
    }).modelInputMode).toBe("select");

    expect(aiRecognitionSettingsSchema.parse({
      provider: "openai",
      model: "custom-model",
      modelInputMode: "manual",
      baseUrl: "",
      apiKey: "sk-test",
      defaultThinkingControl: null,
    }).modelInputMode).toBe("manual");
  });
});
