import { systemVersionResponseSchema } from "@renewlet/shared/schemas/app";
import packageJson from "../package.json";
import { requireAdmin } from "./auth";
import { HttpError, json, requestLocale, tr } from "./http";
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
    runtime: "cloudflare",
    updateSupported: false,
    unsupportedReason: tr(locale, "Cloudflare 部署不支持页面内一键更新，请在 GitHub Release 或 Cloudflare 部署流程中升级。", "Cloudflare deployments do not support in-app updates. Upgrade from GitHub Releases or the Cloudflare deployment workflow."),
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
  throw new HttpError(400, tr(locale, "Cloudflare 部署不支持页面内一键更新", "Cloudflare deployments do not support in-app updates"), "SYSTEM_UPDATE_UNSUPPORTED");
}

function cloudflareBuildValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (trimmed === "0.1.0" && PACKAGE_VERSION !== "0.1.0") return PACKAGE_VERSION;
  return trimmed;
}
