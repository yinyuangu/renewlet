import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AiRecognizeResponse } from "@/lib/api/schemas/ai-recognition";
import { aiRecognitionService } from "./ai-recognition-service";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiFetch: mocks.apiFetch,
}));

const response = {
  provider: "openai",
  model: "gpt-5-mini",
  subscriptions: [],
  warnings: [],
  diagnostics: {
    schemaVersion: "1",
    promptVersion: "test",
    schemaName: "test",
    prompt: {
      system: { value: "", truncated: false },
      user: { value: "", truncated: false },
    },
    output: {
      rawModelText: null,
      rawObjectJson: null,
    },
    request: {
      provider: "openai",
      model: "gpt-5-mini",
      thinkingControl: null,
      maxOutputTokens: 4096,
      textCharCount: 0,
      images: [],
    },
    response: {
      usage: null,
      finishReason: null,
      providerMetadata: null,
    },
  },
} satisfies AiRecognizeResponse;

describe("aiRecognitionService", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.apiFetch.mockResolvedValue(response);
  });

  it("omits thinkingControl from multipart requests when no control is selected", async () => {
    await aiRecognitionService.recognizeSubscriptions({
      text: "github copilot 20刀 一个月",
      images: [],
      thinkingControl: null,
    });

    const init = mocks.apiFetch.mock.calls[0]?.[2] as RequestInit;
    const body = init.body as FormData;
    expect(body.get("text")).toBe("github copilot 20刀 一个月");
    expect(body.has("thinkingControl")).toBe(false);
  });

  it("sends thinkingControl only when the current run has an explicit control", async () => {
    await aiRecognitionService.recognizeSubscriptions({
      text: "github copilot 20刀 一个月",
      images: [],
      thinkingControl: { provider: "openai", effort: "high" },
    });

    const init = mocks.apiFetch.mock.calls[0]?.[2] as RequestInit;
    const body = init.body as FormData;
    expect(body.get("thinkingControl")).toBe(JSON.stringify({ provider: "openai", effort: "high" }));
  });

  it("loads provider models through the authenticated app API", async () => {
    const modelList = {
      provider: "openai",
      models: [{
        id: "gpt-5.1",
        displayName: null,
        createdAt: null,
        ownedBy: "openai",
        inputTokenLimit: null,
        outputTokenLimit: null,
        capabilities: {
          textInput: null,
          imageInput: null,
          structuredOutput: null,
          thinking: null,
        },
      }],
      truncated: false,
    };
    mocks.apiFetch.mockResolvedValueOnce(modelList);

    await expect(aiRecognitionService.listModels({
      provider: "openai",
      baseUrl: "",
      apiKey: "sk-test",
    })).resolves.toEqual(modelList);

    expect(mocks.apiFetch.mock.calls[0]?.[0]).toBe("/api/app/ai/models/list");
    expect(mocks.apiFetch.mock.calls[0]?.[2]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ provider: "openai", baseUrl: "", apiKey: "sk-test" }),
      timeoutMs: 20_000,
    });
  });
});
