/**
 * 订阅 API 的 Zod 契约。
 *
 * 架构位置：
 * - 前端使用这些 schema 描述 collection 字段边界。
 * - 前端可复用响应 schema 做防御性解析，避免 UI 直接信任网络返回。
 *
 * 关键约束：
 * - 日期必须是 date-only，不能携带时间或时区，防止扣费日因 SSR/浏览器时区漂移。
 * - 创建与更新共用同一字段定义，PATCH 通过 partial 派生，减少请求契约分叉。
 */
import { z } from "zod";
import {
  BILLING_CYCLES,
  MAX_SUBSCRIPTION_TAG_LENGTH,
  MAX_SUBSCRIPTION_TAGS,
  REPEAT_REMINDER_INTERVALS,
  REPEAT_REMINDER_WINDOWS,
  SUBSCRIPTION_STATUSES,
  type BillingCycle,
  type Category,
  type PaymentMethod,
  type RepeatReminderInterval,
  type RepeatReminderWindow,
  type SubscriptionStatus,
} from "@/types/subscription";
import { isValidDateOnly } from "@/lib/time/date-only";

const maxLogoReferenceLength = 64 * 1024;
const privateAssetPathPattern = /^\/api\/app\/assets\/[A-Za-z0-9_-]+$/;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * API 中使用的日期字符串（date-only）。
 *
 * 说明：
 * - 推荐使用 `YYYY-MM-DD`（最清晰、无时区歧义）
 * - 不兼容 ISO datetime，避免浏览器时区导致日期漂移。
 */
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

const optionalLogoReferenceSchema = z
  .string()
  .trim()
  .max(maxLogoReferenceLength)
  .nullable()
  .optional()
  .refine((value) => {
    if (!value) return true;
    if (value.startsWith("data:image/")) return true;
    if (privateAssetPathPattern.test(value)) return true;
    return isHttpUrl(value);
  }, "Invalid logo URL");

const tagsSchema = z
  .array(z.string().trim().min(1).max(MAX_SUBSCRIPTION_TAG_LENGTH))
  .max(MAX_SUBSCRIPTION_TAGS)
  .optional()
  .describe("标签数组（可选，最多 100 个）。");

/** 创建订阅请求体（PocketBase subscriptions collection）。 */
export const subscriptionCreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120).describe("订阅名称，例如：Netflix。"),
  logo: optionalLogoReferenceSchema.describe("Logo（HTTP(S) URL、私有资产路径或历史 data URL，可为空）。"),
  price: z.number().finite().nonnegative().max(1_000_000_000).describe("单次扣费金额（>=0）。"),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).describe("货币代码，例如：CNY、USD。"),
  billingCycle: z.enum(BILLING_CYCLES).describe("扣费周期。"),
  customDays: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("自定义周期天数（仅 billingCycle=custom 时生效，可为空）。"),
  category: z.string().trim().min(1).max(80).describe("订阅分类（来自用户自定义配置）。"),
  status: z.enum(SUBSCRIPTION_STATUSES).describe("订阅状态。"),
  paymentMethod: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .nullable()
    .optional()
    .describe("支付方式（来自用户自定义配置，可为空）。"),
  startDate: dateInputSchema.describe("开始日期。"),
  nextBillingDate: dateInputSchema.describe("下次扣费日期。"),
  autoCalculateNextBillingDate: z.boolean().describe("是否自动根据开始日期和扣费周期计算下次扣费日期。"),
  trialEndDate: dateInputSchema.nullable().optional().describe("试用结束日期（可为空）。"),
  website: optionalUrlSchema.describe("官网地址（可为空）。"),
  notes: z.string().max(5000).nullable().optional().describe("备注（可为空）。"),
  tags: tagsSchema,
  reminderDays: z.number().int().nonnegative().max(3650).describe("提前多少天提醒（>=0）。"),
  repeatReminderEnabled: z.boolean().describe("是否启用重复提醒。"),
  repeatReminderInterval: z.enum(REPEAT_REMINDER_INTERVALS).describe("重复提醒间隔。"),
  repeatReminderWindow: z.enum(REPEAT_REMINDER_WINDOWS).describe("重复提醒窗口。"),
}).strict();

/** 更新订阅请求体（PocketBase subscriptions collection）。 */
export const subscriptionUpdateBodySchema = subscriptionCreateBodySchema
  .partial()
  .refine((obj) => Object.keys(obj).length > 0, { message: "Empty payload" })
  .describe("支持部分字段更新；至少包含 1 个字段。");

/** API 返回的订阅对象（字段与 UI 直接对齐）。 */
export const apiSubscriptionSchema = z.object({
  id: z.string().describe("订阅 ID（UUID 字符串）。"),
  name: z.string().describe("订阅名称。"),
  logo: z.string().optional().describe("Logo（可选）。"),
  price: z.number().describe("单次扣费金额。"),
  currency: z.string().describe("货币代码。"),
  billingCycle: z.enum(BILLING_CYCLES).describe("扣费周期。"),
  customDays: z.number().int().optional().describe("自定义周期天数（可选）。"),
  category: z.string().min(1).describe("分类（来自用户自定义配置）。"),
  status: z.enum(SUBSCRIPTION_STATUSES).describe("状态。"),
  paymentMethod: z.string().min(1).optional().describe("支付方式（来自用户自定义配置，可选）。"),
  startDate: z.string().describe("开始日期（YYYY-MM-DD）。"),
  nextBillingDate: z.string().describe("下次扣费日期（YYYY-MM-DD）。"),
  autoCalculateNextBillingDate: z.boolean().describe("是否自动根据开始日期和扣费周期计算下次扣费日期。"),
  trialEndDate: z.string().optional().describe("试用结束日期（可选，YYYY-MM-DD）。"),
  website: z.string().optional().describe("官网地址（可选）。"),
  notes: z.string().optional().describe("备注（可选）。"),
  tags: z.array(z.string()).optional().describe("标签数组（可选）。"),
  reminderDays: z.number().int().nonnegative().describe("提前多少天提醒。"),
  repeatReminderEnabled: z.boolean().describe("是否启用重复提醒。"),
  repeatReminderInterval: z.enum(REPEAT_REMINDER_INTERVALS).describe("重复提醒间隔。"),
  repeatReminderWindow: z.enum(REPEAT_REMINDER_WINDOWS).describe("重复提醒窗口。"),
  createdAt: z.string().optional().describe("创建时间（ISO 字符串，可选）。"),
  updatedAt: z.string().optional().describe("更新时间（ISO 字符串，可选）。"),
}).strict();

/** 订阅列表响应结构。 */
export const subscriptionsListResponseSchema = z.object({
  subscriptions: z.array(apiSubscriptionSchema).describe("订阅列表。"),
}).strict();

/** 订阅写入响应结构。 */
export const subscriptionResponseSchema = z.object({
  subscription: apiSubscriptionSchema.describe("订阅对象。"),
}).strict();

/** 订阅删除响应结构。 */
export const subscriptionDeleteResponseSchema = z.object({
  ok: z.literal(true).describe("是否成功（固定 true）。"),
}).strict();

/**
 * 前端使用的订阅 API 类型。
 *
 * 为什么需要交叉类型：Zod `enum` 推导会保留基础字符串 union，但 UI 层还希望沿用领域类型别名，
 * 这样业务函数能继续表达 BillingCycle/Category/PaymentMethod 的语义。
 */
export type ApiSubscription = z.infer<typeof apiSubscriptionSchema> & {
  billingCycle: BillingCycle;
  category: Category;
  status: SubscriptionStatus;
  paymentMethod?: PaymentMethod;
  repeatReminderInterval: RepeatReminderInterval;
  repeatReminderWindow: RepeatReminderWindow;
};
