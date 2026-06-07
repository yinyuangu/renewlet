import type { AiRecognizedSubscriptionDraft } from "@/lib/api/schemas/ai-recognition";

export type AIRecognitionInputMode = "text" | "image";

export interface AIRecognitionImageItem {
  id: string;
  file: File;
  thumbnailUrl: string | null;
}

export interface AIDraftListItem {
  id: string;
  draft: AiRecognizedSubscriptionDraft;
}

export type AIDraftFilter = "all" | "warning" | "low-confidence" | "missing-core";
