import type { AdminUser } from "@renewlet/shared/schemas/admin";
import type { ApiAppSettings } from "@renewlet/shared/schemas/settings";
import type { ApiSubscription } from "@renewlet/shared/schemas/subscriptions";

/**
 * Env 描述 wrangler 绑定和 CI 注入的构建变量。
 *
 * DB/R2 binding 名必须与 wrangler.jsonc 保持一致；版本字段只用于展示，不参与页面内更新。
 */
export interface Env {
  DB: D1Database;
  ASSETS_BUCKET: R2Bucket;
  SETUP_ENABLED?: string;
  SESSION_TTL_DAYS?: string;
  RENEWLET_VERSION?: string;
  RENEWLET_COMMIT?: string;
  RENEWLET_BUILD_TIME?: string;
}

/** D1 users 行模型；只在 Worker 内部使用，公开用户响应必须经过 shared/admin schema。 */
export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: "user" | "admin";
  banned: number;
  ban_reason: string;
  password_hash: string;
  reset_token_hash: string | null;
  reset_token_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Worker session 表保存 token hash；浏览器只持有原始 Bearer token，不读取此行结构。 */
export interface SessionRow {
  id: string;
  token_hash: string;
  user_id: string;
  expires_at: string;
  created_at: string;
  last_seen_at: string;
}

/** 联表认证结果；字段前缀用于避免 users 与 sessions 同名列在 D1 查询中互相覆盖。 */
export interface SessionAuthRow extends UserRow {
  session_id: string;
  session_token_hash: string;
  session_user_id: string;
  session_expires_at: string;
  session_created_at: string;
  session_last_seen_at: string;
}

/** D1 订阅行模型；snake_case 与整数布尔必须在 `toApiSubscription` 里收敛到 shared schema。 */
export interface SubscriptionRow {
  id: string;
  user_id: string;
  name: string;
  logo: string | null;
  price: number;
  currency: string;
  billing_cycle: string;
  custom_days: number | null;
  category: string;
  status: string;
  pinned: number;
  payment_method: string | null;
  start_date: string;
  next_billing_date: string;
  auto_calculate_next_billing_date: number;
  trial_end_date: string | null;
  website: string | null;
  notes: string | null;
  tags_json: string;
  reminder_days: number;
  repeat_reminder_enabled: number;
  repeat_reminder_interval: string;
  repeat_reminder_window: string;
  extra_json: string;
  created_at: string;
  updated_at: string;
}

/** R2 私有资产的 D1 元数据索引；权限判断只能信任这里的 user_id，而不是 R2 key。 */
export interface AssetRow {
  id: string;
  user_id: string;
  kind: "logo" | "icon";
  r2_key: string;
  original_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  created_at: string;
  updated_at: string;
}

/** 通知任务审计行；本地计划时间和 UTC instant 同存，便于用户解释与后台排序。 */
export interface NotificationJobRow {
  id: string;
  user_id: string;
  scheduled_local_date: string;
  scheduled_local_time: string;
  time_zone: string;
  scheduled_instant_utc: string;
  status: "pending" | "sending" | "sent" | "failed" | "skipped";
  attempts: number;
  last_error: string | null;
  result_json: string;
  created_at: string;
  updated_at: string;
}

/** 日历订阅 token 是低权限 bearer secret，D1 保存明文以便登录用户可查看和撤销。 */
export interface CalendarFeedRow {
  id: string;
  user_id: string;
  scope: "all" | "subscription";
  subscription_id: string | null;
  token: string;
  created_at: string;
  updated_at: string;
}

/** 已通过 Worker session 校验的请求上下文。 */
export interface AuthContext {
  token: string;
  session: SessionRow;
  user: UserRow;
}

export type { AdminUser, ApiAppSettings, ApiSubscription };
