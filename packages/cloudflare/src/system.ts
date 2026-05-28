import { systemVersionResponseSchema } from "@renewlet/shared/schemas/app";
import packageJson from "../package.json";
import { requireAdmin } from "./auth";
import { HttpError, json, requestLocale } from "./http";
import { serverText } from "./server-i18n";
import type { Env } from "./types";

const PACKAGE_VERSION = packageJson.version;

export async function systemVersion(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const locale = requestLocale(request);
  const version = cloudflareBuildValue(env.RENEWLET_VERSION, PACKAGE_VERSION);
  // Cloudflare Worker 没有可替换的容器内二进制；这里只暴露发布信息，执行入口始终返回不支持。
  return json(systemVersionResponseSchema.parse({
    currentVersion: version,
    latestVersion: version,
    hasUpdate: false,
    checkSucceeded: true,
    runtime: "cloudflare",
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

export async function systemUpdate(request: Request, env: Env): Promise<Response> {
  await requireAdmin(request, env);
  const locale = requestLocale(request);
  throw new HttpError(400, serverText(locale, "system.cloudflareUpdateUnsupported"), "SYSTEM_UPDATE_UNSUPPORTED");
}

function cloudflareBuildValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  // wrangler.jsonc 的本地占位版本不能泄漏到线上；CI 未注入时退回 package 版本比显示 0.1.0 更可诊断。
  if (trimmed === "0.1.0" && PACKAGE_VERSION !== "0.1.0") return PACKAGE_VERSION;
  return trimmed;
}
