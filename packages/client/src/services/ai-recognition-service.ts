import { apiFetch } from "@/lib/api-client";
import {
  aiModelListResponseSchema,
  aiRecognitionTestResponseSchema,
  aiRecognizeResponseSchema,
  type AiModelListRequest,
  type AiModelListResponse,
  type AiRecognitionSettings,
  type AiRecognitionTestResponse,
  type AiRecognizeResponse,
  type AiThinkingControl,
} from "@/lib/api/schemas/ai-recognition";

interface RecognizeSubscriptionsInput {
  text: string;
  images: File[];
  thinkingControl: AiThinkingControl | null;
}

export const aiRecognitionService = {
  async listModels(input: AiModelListRequest): Promise<AiModelListResponse> {
    return await apiFetch("/api/app/ai/models/list", aiModelListResponseSchema, {
      method: "POST",
      body: JSON.stringify(input),
      timeoutMs: 20_000,
    });
  },

  async recognizeSubscriptions(input: RecognizeSubscriptionsInput): Promise<AiRecognizeResponse> {
    const formData = new FormData();
    formData.set("text", input.text);
    if (input.thinkingControl) {
      formData.set("thinkingControl", JSON.stringify(input.thinkingControl));
    }
    for (const image of input.images) {
      formData.append("images[]", image, image.name);
    }
    return await apiFetch("/api/app/ai/subscriptions/recognize", aiRecognizeResponseSchema, {
      method: "POST",
      body: formData,
      timeoutMs: 120_000,
    });
  },

  async testConnection(settings: AiRecognitionSettings): Promise<AiRecognitionTestResponse> {
    return await apiFetch("/api/app/ai/subscriptions/test", aiRecognitionTestResponseSchema, {
      method: "POST",
      body: JSON.stringify({ settings }),
      timeoutMs: 60_000,
    });
  },
};
