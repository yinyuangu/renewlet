import type { MessageKey } from "@/i18n/messages";
import type { AiRecognitionSettings } from "@/lib/api/schemas/ai-recognition";

export function getAIRecognitionSettingsBlocker(settings: AiRecognitionSettings): MessageKey | null {
  if (!settings.model.trim()) return "aiRecognition.modelRequired";
  if (settings.provider === "openai-compatible" && !settings.baseUrl.trim()) {
    return "aiRecognition.baseUrlRequired";
  }
  if (settings.provider !== "openai-compatible" && !settings.apiKey.trim()) {
    return "aiRecognition.apiKeyRequired";
  }
  return null;
}
