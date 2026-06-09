import { ApiError } from "@/lib/api-client";
import {
  aiProviderResponseSchema,
  aiRecognitionDiagnosticsSchema,
  type AiProviderResponse,
  type AiRecognitionDiagnostics,
} from "@/lib/api/schemas/ai-recognition";

export interface AIErrorDetails {
  message: string;
  status: number;
  code: string | null;
  reason: string | null;
  providerMessage: string | null;
  providerResponse: AiProviderResponse | null;
  diagnostics: AiRecognitionDiagnostics | null;
  payload: unknown;
}

export function extractAIErrorDetails(error: unknown): AIErrorDetails | null {
  if (!(error instanceof ApiError)) return null;
  const envelope = record(error.details);
  const nestedDetails = record(envelope?.["details"]) ?? record(error.details);
  const providerResponse = parseProviderResponse(nestedDetails?.["providerResponse"]);
  const diagnostics = parseDiagnostics(nestedDetails?.["diagnostics"]);
  const reason = stringField(nestedDetails, "reason");
  const providerMessage = stringField(nestedDetails, "providerMessage");
  const code = error.code ?? stringField(envelope, "code");
  const payload = buildAIErrorPayload({
    message: error.message,
    status: error.status,
    code,
    reason,
    providerMessage,
    providerResponse,
    diagnostics,
    raw: error.details,
  });

  if (!providerResponse && !providerMessage && !diagnostics && !code?.startsWith("AI_")) return null;
  return {
    message: error.message,
    status: error.status,
    code: code ?? null,
    reason,
    providerMessage,
    providerResponse,
    diagnostics,
    payload,
  };
}

export function createAIErrorDetails(error: unknown, fallbackMessage: string): AIErrorDetails {
  const extracted = extractAIErrorDetails(error);
  if (extracted) return extracted;
  const message = error instanceof Error && error.message.trim() ? error.message : fallbackMessage;
  const status = error instanceof ApiError ? error.status : 0;
  const code = error instanceof ApiError ? error.code ?? null : null;
  const payload = {
    message,
    status,
    code,
    reason: null,
    providerMessage: null,
    providerResponse: null,
    diagnostics: null,
    raw: error instanceof ApiError ? error.details : null,
  };
  return {
    message,
    status,
    code,
    reason: null,
    providerMessage: null,
    providerResponse: null,
    diagnostics: null,
    payload,
  };
}

export function aiErrorDetailsToClipboardText(details: AIErrorDetails): string {
  return aiErrorRawResponseText(details);
}

export function aiErrorRawResponseText(details: AIErrorDetails | null): string {
  if (!details) return "";
  const providerBody = details.providerResponse?.body;
  if (providerBody && providerBody.length > 0) return providerBody;
  const rawModelText = details.diagnostics?.output.rawModelText?.value;
  return rawModelText && rawModelText.length > 0 ? rawModelText : "";
}

function buildAIErrorPayload(input: Omit<AIErrorDetails, "payload"> & { raw: unknown }): unknown {
  return {
    message: input.message,
    status: input.status,
    code: input.code,
    reason: input.reason,
    providerMessage: input.providerMessage,
    providerResponse: input.providerResponse,
    diagnostics: input.diagnostics,
    raw: input.raw,
  };
}

function parseProviderResponse(value: unknown): AiProviderResponse | null {
  const parsed = aiProviderResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseDiagnostics(value: unknown): AiRecognitionDiagnostics | null {
  const parsed = aiRecognitionDiagnosticsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function stringField(value: Record<string, unknown> | null, key: string): string | null {
  if (!value) return null;
  const item = value[key];
  return typeof item === "string" && item.trim().length > 0 ? item : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
