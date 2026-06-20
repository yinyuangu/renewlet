import { z } from "zod";
import { SUBSCRIPTION_STATUSES } from "../runtime";
import {
  apiSubscriptionSchema,
  subscriptionResponseSchema,
  subscriptionsListQuerySchema,
  subscriptionsListResponseSchema,
} from "./subscriptions";

export const publicApiTokenPlainSchema = z.string().trim().regex(/^rlt_[A-Za-z0-9_-]{43}$/);
export const publicApiScopeSchema = z.literal("read");
export const publicApiScopesSchema = z.array(publicApiScopeSchema).length(1);

/**
 * Public API token 管理响应只返回 prefix 和元信息。
 *
 * plainToken 只允许出现在创建响应；列表、删除和 Public API 响应都不能再次泄漏明文 token。
 */
export const apiTokenSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(80),
  tokenPrefix: z.string().trim().min(6).max(16),
  scopes: publicApiScopesSchema,
  createdAt: z.string().trim().min(1),
  lastUsedAt: z.string().trim().min(1).nullable().optional(),
}).strict();

export const apiTokensListResponseSchema = z.object({
  tokens: z.array(apiTokenSchema),
}).strict();

export const apiTokenCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
}).strict();

export const apiTokenCreateResponseSchema = z.object({
  token: apiTokenSchema,
  plainToken: publicApiTokenPlainSchema,
}).strict();

export const apiTokenDeleteResponseSchema = z.object({
  ok: z.literal(true),
}).strict();

export const publicApiMeResponseSchema = z.object({
  ok: z.literal(true),
  scopes: publicApiScopesSchema,
}).strict();

export const publicApiSubscriptionsQuerySchema = subscriptionsListQuerySchema;
export const publicApiSubscriptionsListResponseSchema = subscriptionsListResponseSchema;
export const publicApiSubscriptionResponseSchema = subscriptionResponseSchema;

export const publicApiStatusResponseSchema = z.object({
  generatedAt: z.string().trim().min(1),
  total: z.number().int().nonnegative(),
  byStatus: z.object(
    Object.fromEntries(SUBSCRIPTION_STATUSES.map((status) => [status, z.number().int().nonnegative()])) as Record<
      (typeof SUBSCRIPTION_STATUSES)[number],
      z.ZodNumber
    >,
  ).strict(),
}).strict();

export const publicApiDueQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
}).strict();

export const publicApiDueItemSchema = z.object({
  dueDate: z.string().trim().min(1),
  dueType: z.enum(["renewal", "trial", "expiry"]),
  subscription: apiSubscriptionSchema,
}).strict();

export const publicApiDueResponseSchema = z.object({
  days: z.number().int().min(1).max(366),
  generatedAt: z.string().trim().min(1),
  items: z.array(publicApiDueItemSchema),
}).strict();

export type ApiToken = z.infer<typeof apiTokenSchema>;
export type ApiTokensListResponse = z.infer<typeof apiTokensListResponseSchema>;
export type ApiTokenCreateRequest = z.infer<typeof apiTokenCreateRequestSchema>;
export type ApiTokenCreateResponse = z.infer<typeof apiTokenCreateResponseSchema>;
export type PublicApiMeResponse = z.infer<typeof publicApiMeResponseSchema>;
export type PublicApiStatusResponse = z.infer<typeof publicApiStatusResponseSchema>;
export type PublicApiDueItem = z.infer<typeof publicApiDueItemSchema>;
export type PublicApiDueResponse = z.infer<typeof publicApiDueResponseSchema>;
