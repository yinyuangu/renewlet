import { systemVersionResponseSchema } from "@renewlet/shared/schemas/app";
import { requireAdmin } from "./auth";
import { HttpError, json, requestLocale } from "./http";
import { serverText } from "./server-i18n";
import type { Env } from "./types";

const DEV_VERSION = "0.0.0-dev";

/**
 * systemVersion 返回 Cloudflare 运行面的版本状态。
 *
 * Worker 部署没有可替换的本地二进制，前端只能展示版本和 Release 链接，不能复用 Docker 页面内更新流程。
 */
export async function systemVersion(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const locale = requestLocale(request);
  const version = cloudflareBuildValue(env.RENEWLET_VERSION, DEV_VERSION);
  // Cloudflare Worker 没有可替换的容器内二进制；未接入 GitHub latest 检查前不能声明“已是最新版本”。
  return json(systemVersionResponseSchema.parse({
    currentVersion: version,
    latestVersion: version,
    hasUpdate: false,
    checkSucceeded: false,
    deployment: "cloudflare",
    updateMode: "cloudflare-deploy",
    updateSupported: false,
    unsupportedReason: serverText(locale, "system.cloudflareVersionUnsupportedReason"),
    releaseInfo: {
      tagName: `v${version}`,
      version,
      name: "Renewlet",
      body: "",
      publishedAt: cloudflareBuildValue(env.RENEWLET_BUILD_TIME, ""),
      htmlUrl: `https://github.com/zhiyingzzhou/renewlet/releases/tag/v${version}`,
      assets: [],
    },
    cached: false,
    build: {
      version,
      commit: cloudflareBuildValue(env.RENEWLET_COMMIT, ""),
      buildTime: cloudflareBuildValue(env.RENEWLET_BUILD_TIME, ""),
      buildType: "cloudflare",
    },
  }));
}

/**
 * systemUpdate 明确拒绝 Cloudflare 页面内更新。
 *
 * Cloudflare 的发布入口是 Wrangler/Workers Builds，管理员按钮不能触发容器式下载、校验和重启状态机。
 */
export async function systemUpdate(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const locale = requestLocale(request);
  throw new HttpError(400, serverText(locale, "system.cloudflareUpdateUnsupported"), "SYSTEM_UPDATE_UNSUPPORTED");
}

function cloudflareBuildValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed;
}
