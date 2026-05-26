import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SystemVersionResponse } from "@/lib/api/schemas/app";
import { Header } from "./header";

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  signOut: vi.fn(),
  useSystemVersion: vi.fn(),
  useSystemUpdate: vi.fn(),
  toast: vi.fn(),
  setTheme: vi.fn(),
  writeAppearancePendingToStorage: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: mocks.useSession,
    signOut: mocks.signOut,
  },
}));

vi.mock("@/hooks/use-system-version", () => ({
  useSystemVersion: mocks.useSystemVersion,
  useSystemUpdate: mocks.useSystemUpdate,
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/theme-provider", () => ({
  useTheme: () => ({
    theme: "dark",
    setTheme: mocks.setTheme,
  }),
}));

vi.mock("@/lib/theme-storage", () => ({
  writeAppearancePendingToStorage: mocks.writeAppearancePendingToStorage,
}));

vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string | number>) => {
      const messages: Record<string, string> = {
        "app.tagline": "订阅账本",
        "header.logout": "退出登录",
        "header.toggleTheme": "切换主题",
        "nav.calendar": "日历",
        "nav.dashboard": "仪表盘",
        "nav.settings": "设置",
        "nav.statistics": "统计",
        "nav.subscriptions": "订阅",
        "system.badgeUpdate": "可更新到 v{version}",
        "system.badgeVersion": "v{version}",
        "system.buildType": "构建类型",
        "system.currentVersion": "当前版本",
        "system.latestVersion": "最新版本",
        "system.noUpdateDescription": "当前部署不需要更新。",
        "system.noUpdateTitle": "已是最新版本",
        "system.openUpdateDialog": "打开系统更新",
        "system.recheck": "重新检查",
        "system.runtime": "运行面",
        "system.runtime.docker": "Docker",
        "system.updateDescription": "检查 GitHub Release，并在支持的 Docker 部署中一键替换运行二进制。",
        "system.updateNow": "立即更新",
        "system.updateTitle": "系统更新",
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

function versionFixture(overrides: Partial<SystemVersionResponse> = {}): SystemVersionResponse {
  return {
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    hasUpdate: true,
    runtime: "docker",
    updateSupported: true,
    unsupportedReason: undefined,
    releaseInfo: null,
    cached: false,
    warning: undefined,
    build: {
      version: "1.0.0",
      commit: "abc",
      buildTime: "2026-05-26T00:00:00Z",
      buildType: "release",
    },
    ...overrides,
  };
}

function adminSession(role: "admin" | "user") {
  return {
    data: {
      session: { id: "session-1" },
      user: { id: "user-1", email: "alice@example.com", name: "Alice", role, banned: false },
    },
    isPending: false,
  };
}

function renderHeader(ui: ReactElement = <Header />) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Header system version entry", () => {
  beforeEach(() => {
    mocks.useSession.mockReset();
    mocks.signOut.mockReset();
    mocks.useSystemVersion.mockReset();
    mocks.useSystemUpdate.mockReset();
    mocks.toast.mockReset();
    mocks.setTheme.mockReset();
    mocks.writeAppearancePendingToStorage.mockReset();
    mocks.useSystemVersion.mockReturnValue({
      data: versionFixture(),
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    });
    mocks.useSystemUpdate.mockReturnValue({
      isPending: false,
      isSuccess: false,
      mutateAsync: vi.fn(),
    });
  });

  it("shows the version badge for administrators and opens the update dialog", async () => {
    mocks.useSession.mockReturnValue(adminSession("admin"));
    const user = userEvent.setup();

    renderHeader();

    await user.click(screen.getByRole("button", { name: "打开系统更新" }));

    expect(screen.getByText("可更新到 v1.1.0")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent("系统更新");
  });

  it("hides the version badge from non-admin users", () => {
    mocks.useSession.mockReturnValue(adminSession("user"));

    renderHeader();

    expect(screen.queryByRole("button", { name: "打开系统更新" })).not.toBeInTheDocument();
  });
});
