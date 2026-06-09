import { APICallError } from "ai";
import type { AiProviderResponse } from "@renewlet/shared/schemas/ai-recognition";

type APICallErrorLike = {
  statusCode?: unknown;
  responseHeaders?: unknown;
  responseBody?: unknown;
  cause?: unknown;
  errors?: unknown;
};

export function providerResponseFromFetchResponse(response: Response, body: string): AiProviderResponse {
  return {
    status: response.status,
    statusText: response.statusText || null,
    headers: headersToObject(response.headers),
    body: body || null,
    bodyTruncated: false,
  };
}

export function providerResponseFromError(error: unknown): AiProviderResponse | null {
  const apiError = findAPICallError(error);
  if (!apiError) return null;
  return {
    status: typeof apiError.statusCode === "number" ? apiError.statusCode : null,
    statusText: null,
    headers: recordToStringMap(apiError.responseHeaders),
    body: typeof apiError.responseBody === "string" && apiError.responseBody.length > 0 ? apiError.responseBody : null,
    bodyTruncated: false,
  };
}

function findAPICallError(error: unknown, seen = new WeakSet<object>()): APICallErrorLike | null {
  if (!error || typeof error !== "object") return null;
  if (seen.has(error)) return null;
  seen.add(error);
  let fallback: APICallErrorLike | null = null;
  if (isAPICallError(error)) {
    if (hasProviderResponseBody(error)) return error;
    fallback = error;
  }
  if ("cause" in error) {
    const causeMatch = findAPICallError((error as { cause?: unknown }).cause, seen);
    if (causeMatch && hasProviderResponseBody(causeMatch)) return causeMatch;
    fallback ??= causeMatch;
  }
  if ("errors" in error) {
    const nestedErrors = (error as { errors?: unknown }).errors;
    if (Array.isArray(nestedErrors)) {
      for (const item of nestedErrors) {
        const itemMatch = findAPICallError(item, seen);
        if (itemMatch && hasProviderResponseBody(itemMatch)) return itemMatch;
        fallback ??= itemMatch;
      }
    }
  }
  return fallback;
}

function isAPICallError(error: unknown): error is APICallErrorLike {
  const guard = APICallError as unknown as { isInstance?: (value: unknown) => boolean } | undefined;
  if (typeof guard?.isInstance === "function" && guard.isInstance(error)) return true;
  return Boolean(
    error
      && typeof error === "object"
      && (
        "responseBody" in error
          || "responseHeaders" in error
          || "statusCode" in error
      ),
  );
}

function hasProviderResponseBody(error: APICallErrorLike): boolean {
  return typeof error.responseBody === "string" && error.responseBody.length > 0;
}

function headersToObject(headers: Headers): Record<string, string> | null {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (key.trim() && value.trim()) out[key] = value;
  });
  return Object.keys(out).length > 0 ? out : null;
}

function recordToStringMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" && key.trim() && item.trim()) out[key] = item;
  }
  return Object.keys(out).length > 0 ? out : null;
}
