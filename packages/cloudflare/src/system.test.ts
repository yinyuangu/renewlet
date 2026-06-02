// Worker 系统更新测试保护 Cloudflare 只读升级契约，避免前端误暴露 Docker 页面内更新入口。
import { describe, expect, it, vi } from "vitest";
import { systemUpdate, systemVersion } from "./system";
import type { Env } from "./types";

vi.mock("./auth", () => ({
  requireAdmin: vi.fn(async () => ({
    token: "session-token",
    user: { id: "usr_admin", email: "admin@example.com", name: "Admin", role: "admin", banned: 0 },
  })),
}));

describe("Cloudflare system update contract", () => {
  it("returns deploy-only version capability", async () => {
    const response = await systemVersion(new Request("https://renewlet.example/api/app/admin/system/version", {
      headers: { "accept-language": "en-US" },
    }), envFixture());

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      currentVersion: "1.2.3",
      latestVersion: "1.2.3",
      deployment: "cloudflare",
      updateMode: "cloudflare-deploy",
      updateSupported: false,
      checkSucceeded: false,
      hasUpdate: false,
      build: {
        version: "1.2.3",
        commit: "abc123",
        buildType: "cloudflare",
      },
    });
    expect(body).not.toHaveProperty("runtime");
  });

  it("uses an explicit dev version when release metadata is not injected", async () => {
    const env = envFixture();
    delete env.RENEWLET_VERSION;

    const response = await systemVersion(new Request("https://renewlet.example/api/app/admin/system/version", {
      headers: { "accept-language": "en-US" },
    }), env);

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      currentVersion: "0.0.0-dev",
      latestVersion: "0.0.0-dev",
      checkSucceeded: false,
      hasUpdate: false,
      deployment: "cloudflare",
      build: {
        version: "0.0.0-dev",
        commit: "abc123",
        buildType: "cloudflare",
      },
    });
  });

  it("rejects executable updates in the Worker runtime", async () => {
    await expect(systemUpdate(new Request("https://renewlet.example/api/app/admin/system/update", {
      headers: { "accept-language": "en-US" },
      method: "POST",
    }), envFixture())).rejects.toMatchObject({
      status: 400,
      code: "SYSTEM_UPDATE_UNSUPPORTED",
    });
  });
});

function envFixture(): Env {
  return {
    DB: {} as D1Database,
    ASSETS_BUCKET: {} as R2Bucket,
    RENEWLET_VERSION: "1.2.3",
    RENEWLET_COMMIT: "abc123",
    RENEWLET_BUILD_TIME: "2026-06-02T00:00:00Z",
  };
}
