import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { apiFetch } from "@/lib/api-client";
import { SystemUpdateDialog, SystemVersionBadge } from "./system-update-dialog";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiFetch: mocks.apiFetch,
  };
});

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        "system.badgeUpdate": "可更新到 v{version}",
        "system.badgeVersion": "v{version}",
        "system.buildType": "构建类型",
        "system.checking": "正在检查版本...",
        "system.currentVersion": "当前版本",
        "system.latestVersion": "最新版本",
        "system.noUpdateDescription": "当前部署不需要更新。",
        "system.noUpdateTitle": "已是最新版本",
        "system.openUpdateDialog": "打开系统更新",
        "system.recheck": "重新检查",
        "system.releaseLink": "发布页",
        "system.restartDescription": "Docker restart 策略会拉起新版本；如果页面短暂断开，请稍后刷新。",
        "system.restartTitle": "等待自动重启",
        "system.runtime": "运行面",
        "system.runtime.docker": "Docker",
        "system.runtime.cloudflare": "Cloudflare",
        "system.runtime.source": "源码/手动部署",
        "system.unsupportedDescription": "请使用原部署方式升级。",
        "system.unsupportedTitle": "当前部署不支持一键更新",
        "system.updateAvailableDescription": "可以更新到 v{version}。",
        "system.updateAvailableTitle": "发现新版本",
        "system.updateDescription": "检查 GitHub Release，并在支持的 Docker 部署中一键替换运行二进制。",
        "system.updateFailedDescription": "更新失败，请稍后重试。",
        "system.updateFailedTitle": "更新失败",
        "system.updateNow": "立即更新",
        "system.updateStartedTitle": "更新已开始",
        "system.updateTitle": "系统更新",
        "system.updating": "更新中...",
        "system.warningTitle": "检查提示",
      };
      let value = messages[key] ?? key;
      for (const [name, param] of Object.entries(params ?? {})) {
        value = value.split(`{${name}}`).join(String(param));
      }
      return value;
    },
    formatDateTime: (value: string) => value,
  }),
}));

function versionFixture(overrides: Record<string, unknown> = {}) {
  return {
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    hasUpdate: true,
    runtime: "docker",
    updateSupported: true,
    releaseInfo: {
      tagName: "v1.1.0",
      version: "1.1.0",
      name: "Renewlet 1.1.0",
      body: "更新日志",
      publishedAt: "2026-05-26T00:00:00Z",
      htmlUrl: "https://github.com/zhiyingzzhou/renewlet/releases/tag/v1.1.0",
      assets: [],
    },
    cached: false,
    build: {
      version: "1.0.0",
      commit: "abc",
      buildTime: "2026-05-26T00:00:00Z",
      buildType: "release",
    },
    ...overrides,
  };
}

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("SystemUpdateDialog", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.toast.mockReset();
  });

  it("shows update details and triggers update", async () => {
    mocks.apiFetch.mockImplementation((input: string, _schema: unknown, init?: RequestInit) => {
      if (input.startsWith("/api/app/admin/system/version")) return Promise.resolve(versionFixture());
      if (input === "/api/app/admin/system/update" && init?.method === "POST") {
        return Promise.resolve({ ok: true, currentVersion: "1.0.0", targetVersion: "1.1.0", needsRestart: true, message: "更新已完成" });
      }
      return Promise.reject(new Error(`Unexpected request ${input}`));
    });

    const user = userEvent.setup();
    renderWithQuery(<SystemUpdateDialog open onOpenChange={vi.fn()} />);

    expect(await screen.findByText("发现新版本")).toBeInTheDocument();
    expect(screen.getByText("Renewlet 1.1.0")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "立即更新" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "更新已开始" })));
    expect(apiFetch).toHaveBeenCalledWith("/api/app/admin/system/update", expect.anything(), expect.objectContaining({ method: "POST" }));
  });

  it("disables update when runtime is unsupported", async () => {
    mocks.apiFetch.mockResolvedValueOnce(versionFixture({
      hasUpdate: false,
      runtime: "cloudflare",
      updateSupported: false,
      unsupportedReason: "Cloudflare 不支持",
      releaseInfo: null,
    }));

    renderWithQuery(<SystemUpdateDialog open onOpenChange={vi.fn()} />);

    expect(await screen.findByText("当前部署不支持一键更新")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "立即更新" })).toBeDisabled();
  });
});

describe("SystemVersionBadge", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
  });

  it("shows available update version", async () => {
    mocks.apiFetch.mockResolvedValueOnce(versionFixture());

    renderWithQuery(<SystemVersionBadge />);

    expect(await screen.findByText("可更新到 v1.1.0")).toBeInTheDocument();
  });
});
