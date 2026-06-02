import { z } from "zod";
import {
  BILLING_CYCLES,
  INHERIT_REMINDER_DAYS,
  MAX_REMINDER_DAYS,
  REPEAT_REMINDER_INTERVALS,
  REPEAT_REMINDER_WINDOWS,
  SUBSCRIPTION_STATUSES,
  isValidDateOnly,
  isValidReminderDays,
  type BillingCycle,
  type RepeatReminderInterval,
  type RepeatReminderWindow,
  type SubscriptionStatus,
} from "../runtime";

const maxLogoReferenceLength = 2048;
const privateAssetPathPattern = /^\/api\/app\/assets\/[A-Za-z0-9_-]+$/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isLogoHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const dateInputSchema = z
  .string()
  .min(1)
  .refine(isValidDateOnly, "Invalid date")
  .describe("日期字符串：必须是 YYYY-MM-DD，不接受带时间或时区的 ISO datetime。");

const optionalUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .nullable()
  .optional()
  .refine((value) => !value || isHttpUrl(value), "Invalid URL");

const logoReferenceSchema = z
  .string()
  .trim()
  .max(maxLogoReferenceLength)
  .refine((value) => {
    // Logo 持久化契约只允许私有资产代理路径或浏览器直连 http(s) 外链；服务端不抓取用户 URL。
    if (privateAssetPathPattern.test(value)) return true;
    return isLogoHttpUrl(value);
  }, "Invalid logo URL");
const optionalLogoReferenceSchema = logoReferenceSchema.nullable().optional();

const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(100).optional();
const extraSchema = z.record(z.string(), z.unknown()).optional();
export const reminderDaysSchema = z
  .number()
  .int()
  .min(INHERIT_REMINDER_DAYS)
  .max(MAX_REMINDER_DAYS)
  .refine(isValidReminderDays, "Invalid reminder days");

/**
 * 订阅写入请求的跨运行面事实来源。
 *
 * Go route、Cloudflare Worker 和前端表单都应接受这组字段；新增或收窄字段时必须同步
 * PocketBase schema/hooks、D1 row 转换和前端 domain 类型，不能只改某一个运行面。
 */
export const subscriptionCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  logo: optionalLogoReferenceSchema,
  price: z.number().finite().nonnegative().max(1_000_000_000),
  currency: z.string().trim().regex(/^[A-Z]{3}$/),
  billingCycle: z.enum(BILLING_CYCLES),
  customDays: z.number().int().positive().nullable().optional(),
  category: z.string().trim().min(1).max(80),
  status: z.enum(SUBSCRIPTION_STATUSES),
  pinned: z.boolean().default(false),
  paymentMethod: z.string().trim().min(1).max(80).nullable().optional(),
  startDate: dateInputSchema,
  nextBillingDate: dateInputSchema,
  autoCalculateNextBillingDate: z.boolean(),
  trialEndDate: dateInputSchema.nullable().optional(),
  website: optionalUrlSchema,
  notes: z.string().max(5000).nullable().optional(),
  tags: tagsSchema,
  reminderDays: reminderDaysSchema,
  repeatReminderEnabled: z.boolean(),
  repeatReminderInterval: z.enum(REPEAT_REMINDER_INTERVALS),
  repeatReminderWindow: z.enum(REPEAT_REMINDER_WINDOWS),
  // extra 是跨运行面的非展示元数据通道；seed/import 依赖它做幂等，不参与订阅 UI。
  extra: extraSchema,
}).strict();

export const subscriptionUpdateBodySchema = subscriptionCreateBodySchema
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, { message: "Empty payload" });

/**
 * 订阅读取响应的稳定 API 形状。
 *
 * Worker 会把 D1 snake_case/int boolean 重新映射到这里，PocketBase 记录也会在前端先收敛再解析；
 * 这样 UI 只消费一种契约，运行面差异停留在 service/adapter 层。
 */
export const apiSubscriptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  logo: logoReferenceSchema.optional(),
  price: z.number(),
  currency: z.string(),
  billingCycle: z.enum(BILLING_CYCLES),
  customDays: z.number().int().optional(),
  category: z.string().min(1),
  status: z.enum(SUBSCRIPTION_STATUSES),
  pinned: z.boolean(),
  paymentMethod: z.string().min(1).optional(),
  startDate: z.string(),
  nextBillingDate: z.string(),
  autoCalculateNextBillingDate: z.boolean(),
  trialEndDate: z.string().optional(),
  website: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  reminderDays: reminderDaysSchema,
  repeatReminderEnabled: z.boolean(),
  repeatReminderInterval: z.enum(REPEAT_REMINDER_INTERVALS),
  repeatReminderWindow: z.enum(REPEAT_REMINDER_WINDOWS),
  extra: extraSchema,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}).strict();

export const subscriptionsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).max(512).optional(),
}).strict();

export const subscriptionsListResponseSchema = z.object({
  subscriptions: z.array(apiSubscriptionSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative().optional(),
}).strict();

export const subscriptionResponseSchema = z.object({
  subscription: apiSubscriptionSchema,
}).strict();

export const subscriptionDeleteResponseSchema = z.object({
  ok: z.literal(true),
}).strict();

export type ApiSubscription = z.infer<typeof apiSubscriptionSchema> & {
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  repeatReminderInterval: RepeatReminderInterval;
  repeatReminderWindow: RepeatReminderWindow;
};
export type SubscriptionsListQuery = z.infer<typeof subscriptionsListQuerySchema>;
