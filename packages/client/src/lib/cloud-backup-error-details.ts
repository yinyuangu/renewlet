import { ApiError } from "@/lib/api-client";
import {
  cloudBackupErrorDetailsSchema,
  type CloudBackupErrorDetails,
  type CloudBackupProviderAttempt,
  type CloudBackupProviderResponse,
} from "@/lib/api/schemas/cloud-backup";

export interface CloudBackupErrorDetailsView {
  message: string;
  status: number;
  code: string | null;
  reason: string | null;
  providerMessage: string | null;
  providerResponse: CloudBackupProviderResponse | null;
  providerAttempts: CloudBackupProviderAttempt[];
  diagnostics: Record<string, string | null> | null;
  payload: unknown;
}

export function extractCloudBackupErrorDetails(error: unknown): CloudBackupErrorDetailsView | null {
  if (!(error instanceof ApiError)) return null;
  const envelope = record(error.details);
  const nestedDetails = parseCloudBackupErrorDetails(envelope?.["details"]) ?? parseCloudBackupErrorDetails(error.details);
  const code = error.code ?? stringField(envelope, "code");
  if (!nestedDetails && !code?.startsWith("CLOUD_BACKUP_")) return null;
  const providerResponse = nestedDetails?.providerResponse ?? null;
  const providerAttempts = nestedDetails?.providerAttempts ?? [];
  const diagnostics = nestedDetails?.diagnostics ?? null;
  return {
    message: error.message,
    status: error.status,
    code: code ?? null,
    reason: nestedDetails?.reason ?? null,
    providerMessage: nestedDetails?.providerMessage ?? null,
    providerResponse,
    providerAttempts,
    diagnostics,
    payload: buildCloudBackupErrorPayload({
      message: error.message,
      status: error.status,
      code: code ?? null,
      reason: nestedDetails?.reason ?? null,
      providerMessage: nestedDetails?.providerMessage ?? null,
      providerResponse,
      providerAttempts,
      diagnostics,
      raw: error.details,
    }),
  };
}

export function createCloudBackupErrorDetails(error: unknown, fallbackMessage: string): CloudBackupErrorDetailsView {
  const extracted = extractCloudBackupErrorDetails(error);
  if (extracted) return extracted;
  const message = error instanceof Error && error.message.trim() ? error.message : fallbackMessage;
  const status = error instanceof ApiError ? error.status : 0;
  const code = error instanceof ApiError ? error.code ?? null : null;
  return {
    message,
    status,
    code,
    reason: null,
    providerMessage: null,
    providerResponse: null,
    providerAttempts: [],
    diagnostics: null,
    payload: {
      message,
      status,
      code,
      reason: null,
      providerMessage: null,
      providerResponse: null,
      providerAttempts: [],
      diagnostics: null,
      raw: error instanceof ApiError ? error.details : null,
    },
  };
}

export function cloudBackupErrorRawResponseText(details: CloudBackupErrorDetailsView | null): string {
  if (!details) return "";
  // 错误详情里的 HTTP 段必须是 status/header/body 的完整事实；空 body 的 401/403 也不能显示成空白。
  const responses: string[] = [];
  if (details.providerResponse) responses.push(formatProviderResponse(details.providerResponse));
  responses.push(...details.providerAttempts
    .filter((attempt) => attempt.providerResponse)
    .map((attempt) => [
      `# ${attempt.provider.toUpperCase()} ${attempt.code}`,
      formatProviderResponse(attempt.providerResponse as CloudBackupProviderResponse),
    ].join("\n")));
  return responses.join("\n\n");
}

export function cloudBackupErrorTroubleshootingText(details: CloudBackupErrorDetailsView | null): string {
  if (!details) return "";
  const rawResponse = cloudBackupErrorRawResponseText(details);
  if (rawResponse) return rawResponse;

  // 第一屏只放上游 HTTP 事实；没拿到 Response 时才展示本地错误字段，避免把本地化摘要当成远端内容。
  const lines = [
    formatDiagnosticField("code", details.code),
    formatDiagnosticField("reason", details.reason),
  ].filter(Boolean);
  if (details.providerMessage) {
    lines.push("providerMessage:", details.providerMessage);
  }
  if (details.diagnostics && Object.keys(details.diagnostics).length > 0) {
    lines.push("diagnostics:", ...formatDiagnostics(details.diagnostics));
  }
  if (details.providerAttempts.length > 0) {
    lines.push(
      "providerAttempts:",
      ...details.providerAttempts.map((attempt) => {
        const parts = [attempt.provider, attempt.code, attempt.reason].filter(Boolean);
        return `- ${parts.join(" ")}${attempt.providerMessage ? `: ${attempt.providerMessage}` : ""}`;
      }),
    );
  }
  return lines.join("\n\n");
}

export function cloudBackupErrorDetailsToClipboardText(details: CloudBackupErrorDetailsView): string {
  return cloudBackupErrorTroubleshootingText(details) || stringifyPretty(details.payload);
}

function parseCloudBackupErrorDetails(value: unknown): CloudBackupErrorDetails | null {
  const parsed = cloudBackupErrorDetailsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function buildCloudBackupErrorPayload(input: Omit<CloudBackupErrorDetailsView, "payload"> & { raw: unknown }): unknown {
  return {
    message: input.message,
    status: input.status,
    code: input.code,
    reason: input.reason,
    providerMessage: input.providerMessage,
    providerResponse: input.providerResponse,
    providerAttempts: input.providerAttempts,
    diagnostics: input.diagnostics,
    raw: input.raw,
  };
}

function stringifyPretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function formatProviderResponse(response: CloudBackupProviderResponse): string {
  const statusLine = response.statusText
    ? `HTTP ${response.status ?? "unknown"} ${response.statusText}`
    : `HTTP ${response.status ?? "unknown"}`;
  const headers = Object.entries(response.headers ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}: ${value}`);
  // 上游 HTTP 响应不能等同于 body；很多认证/权限错误会返回空 body，但 status 和 headers 才是事实源。
  const body = response.body && response.body.length > 0 ? response.body : "<empty body>";
  return [
    statusLine,
    ...headers,
    "",
    body,
    ...(response.bodyTruncated ? ["<body truncated>"] : []),
  ].join("\n");
}

function formatDiagnosticField(key: string, value: string | null): string | null {
  return value && value.trim() ? `${key}: ${value}` : null;
}

function formatDiagnostics(diagnostics: Record<string, string | null>): string[] {
  return Object.entries(diagnostics)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => (value && value.trim() ? [`${key}: ${value}`] : []));
}

function stringField(value: Record<string, unknown> | null, key: string): string | null {
  if (!value) return null;
  const item = value[key];
  return typeof item === "string" && item.trim().length > 0 ? item : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
