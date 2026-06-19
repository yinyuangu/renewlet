import { customConfigResponseSchema } from "@renewlet/shared/schemas/custom-config";
import { settingsUpdateBodySchema } from "@renewlet/shared/schemas/settings";
import { ensureSettings, getCustomConfig, mergeSettingsPatch, putCustomConfig, putSettings } from "./db";
import { json, readJson, requestLocale } from "./http";
import { requireAuth } from "./auth";
import type { Env } from "./types";

/**
 * readSettings 返回当前用户的完整应用设置。
 *
 * Cloudflare 运行面按用户隔离 D1 setting 行；前端收到的是已合并默认值后的完整契约，不需要知道存储层是否缺省。
 */
export async function readSettings(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  return json({ settings: await ensureSettings(env, auth.user.id, requestLocale(request)) });
}

/**
 * updateSettings 执行设置 PATCH 并返回规范化后的完整设置。
 *
 * Worker 必须复用 shared schema 作为事实来源，保证 Cloudflare/D1 与 Go/PocketBase 在字段默认值和内置图标来源上不漂移。
 */
export async function updateSettings(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const patch = await readJson(request, settingsUpdateBodySchema, locale);
  const current = await ensureSettings(env, auth.user.id, locale);
  // PATCH 语义由“当前设置 + 局部字段”合成，最终仍过完整 schema，防止删除隐式默认项。
  const next = mergeSettingsPatch(current, patch);
  return json({ settings: await putSettings(env, auth.user.id, next) });
}

/**
 * readCustomConfig 读取当前用户的自定义配置。
 *
 * 自定义配置允许用户持久化标签/分类等业务文本，因此只做形状校验与用户隔离，不把内容转成产品内置文案。
 */
export async function readCustomConfig(request: Request, env: Env): Promise<Response> {
  const auth = await requireAuth(request, env);
  const config = await getCustomConfig(env, auth.user.id);
  return json(customConfigResponseSchema.parse({ config }));
}

/**
 * updateCustomConfig 写入当前用户的自定义配置。
 *
 * 请求体和响应都通过同一个 shared schema，避免 Cloudflare 版接受 Docker 版不会保存的数据形状。
 */
export async function updateCustomConfig(request: Request, env: Env): Promise<Response> {
  const locale = requestLocale(request);
  const auth = await requireAuth(request, env);
  const body = await readJson(request, customConfigResponseSchema, locale);
  const config = await putCustomConfig(env, auth.user.id, body.config);
  return json(customConfigResponseSchema.parse({ config }));
}
