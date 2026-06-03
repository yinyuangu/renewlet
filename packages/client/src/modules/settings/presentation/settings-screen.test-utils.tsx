// SettingsScreen 测试夹具集中托管，避免页面主体测试和目录状态机测试再次长成单文件门禁问题。
import { render } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_CUSTOM_CONFIG } from "@/types/config";
import { DEFAULT_SETTINGS, type AppSettings, type NotificationChannel } from "@/types/subscription";
import type { ThemeMode } from "@/types/theme";
import { SettingsScreen } from "./settings-screen";

const mocks = vi.hoisted(() => ({
  useSettingsFormController: vi.fn(),
}));

export { mocks };

export const SETTINGS_SECTION_IDS = [
  "settings-account",
  "settings-appearance",
  "settings-display",
  "settings-icon-sources",
  "settings-budget",
  "settings-data-config",
  "settings-exchange",
  "settings-calendar-feed",
  "settings-timezone",
  "settings-notifications",
] as const;

export const TEST_MOBILE_ANCHOR_LINE_PX = 208;
export const TEST_ACTIVE_SECTION_TOP_PX = TEST_MOBILE_ANCHOR_LINE_PX - 24;
export const TEST_NEXT_SECTION_TOP_PX = TEST_MOBILE_ANCHOR_LINE_PX + 160;

type TestSettingsSectionId = typeof SETTINGS_SECTION_IDS[number];
type IntersectionObserverCallback = ConstructorParameters<typeof IntersectionObserver>[0];
type IntersectionObserverOptions = ConstructorParameters<typeof IntersectionObserver>[1];

export class SettingsIntersectionObserverMock implements IntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly scrollMargin: string;
  readonly thresholds: ReadonlyArray<number>;
  readonly observedElements: Element[] = [];

  static instances: SettingsIntersectionObserverMock[] = [];

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverOptions = {},
  ) {
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? "0px";
    this.scrollMargin = "0px";
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
    SettingsIntersectionObserverMock.instances.push(this);
  }

  disconnect = vi.fn(() => {
    this.observedElements.length = 0;
  });

  observe = vi.fn((target: Element) => {
    this.observedElements.push(target);
  });

  takeRecords = vi.fn((): IntersectionObserverEntry[] => []);

  unobserve = vi.fn((target: Element) => {
    const index = this.observedElements.indexOf(target);
    if (index >= 0) this.observedElements.splice(index, 1);
  });

  trigger(targetIds: string[]) {
    const visibleTargetIds = new Set(targetIds);
    this.callback(this.observedElements.map((target) => ({
      boundingClientRect: target.getBoundingClientRect(),
      intersectionRatio: visibleTargetIds.has(target.id) ? 1 : 0,
      intersectionRect: target.getBoundingClientRect(),
      isIntersecting: visibleTargetIds.has(target.id),
      rootBounds: null,
      target,
      time: performance.now(),
    } satisfies IntersectionObserverEntry)), this);
  }
}

export function setElementRect(element: Element | null, top: number, height = 160) {
  if (!element) throw new Error("Expected element to exist");
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: top + height,
      height,
      left: 0,
      right: 960,
      top,
      width: 960,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } satisfies DOMRect),
  });
}

export function setRootMetrics({
  top = 0,
  scrollTop = 0,
  clientHeight = 800,
  scrollHeight = 2400,
}: {
  top?: number;
  scrollTop?: number;
  clientHeight?: number;
  scrollHeight?: number;
} = {}) {
  const root = document.getElementById("root");
  if (!root) throw new Error("Expected #root test scroll container");
  setElementRect(root, top, clientHeight);
  Object.defineProperty(root, "scrollTop", { configurable: true, value: scrollTop, writable: true });
  Object.defineProperty(root, "clientHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(root, "scrollHeight", { configurable: true, value: scrollHeight });
  return root;
}

export function setSettingsSectionTops(tops: Partial<Record<string, number>>) {
  for (const [id, top] of Object.entries(tops)) {
    if (top !== undefined) setElementRect(document.getElementById(id), top);
  }
}

export function setSectionAnchorGeometry(
  activeId: TestSettingsSectionId,
  options: {
    activeTop?: number;
    nextTop?: number;
    rootMetrics?: Parameters<typeof setRootMetrics>[0];
  } = {},
) {
  const root = setRootMetrics(options.rootMetrics);
  const activeIndex = SETTINGS_SECTION_IDS.indexOf(activeId);
  const activeTop = options.activeTop ?? TEST_ACTIVE_SECTION_TOP_PX;
  const nextTop = options.nextTop ?? TEST_NEXT_SECTION_TOP_PX;

  SETTINGS_SECTION_IDS.forEach((id, index) => {
    const top = index < activeIndex
      ? activeTop - (activeIndex - index) * 240
      : activeTop + Math.max(index - activeIndex, 0) * (nextTop - activeTop);
    setElementRect(document.getElementById(id), top);
  });

  return root;
}

vi.mock("@/components/header", () => ({
  Header: () => <header data-testid="header" />,
}));

vi.mock("@/modules/custom-config/presentation/config-manager-dialog", () => ({
  ConfigManagerDialog: () => null,
}));

vi.mock("@/components/theme-selector", () => ({
  ThemeSelector: ({ mode }: { mode: ThemeMode }) => <div data-testid="theme-selector-mode">{mode}</div>,
}));

vi.mock("@/components/ui/searchable-select", () => ({
  SearchableSelect: ({ value }: { value: string }) => <div data-testid="searchable-select">{value}</div>,
}));

vi.mock("@/components/ui/time-picker", () => ({
  TimePicker: () => null,
}));

vi.mock("../application/use-settings-form-controller", () => ({
  useSettingsFormController: mocks.useSettingsFormController,
}));

export function createControllerState(overrides: {
  settings?: Partial<AppSettings>;
  effectiveThemeMode?: ThemeMode;
  canAccessPocketBaseAdmin?: boolean;
  testingChannel?: NotificationChannel | null;
  isSavingSettings?: boolean;
  hasUnsavedChanges?: boolean;
  calendarFeed?: {
    enabled?: boolean;
    feedUrl?: string | null;
  };
} = {}) {
  const fn = vi.fn();
  return {
    settings: {
      ...DEFAULT_SETTINGS,
      enabledChannels: ["email"],
      smtpHost: "smtp.example.com",
      smtpPort: "587",
      smtpSecure: false,
      smtpUser: "smtp-user",
      smtpPassword: "smtp-password",
      smtpFrom: "Renewlet <noreply@example.com>",
      smtpReplyTo: "support@example.com",
      recipientEmail: "alice@example.com",
      ...overrides.settings,
    },
    effectiveThemeMode: overrides.effectiveThemeMode ?? overrides.settings?.themeMode ?? DEFAULT_SETTINGS.themeMode,
    accountEmail: "alice@example.com",
    canAccessPocketBaseAdmin: overrides.canAccessPocketBaseAdmin ?? true,
    customConfig: DEFAULT_CUSTOM_CONFIG,
    subscriptionsQuery: { data: [] },
    categoryUsageCount: new Map(),
    rates: {},
    activeRateProvider: "floatrates",
    ratesLoading: false,
    lastUpdated: null,
    ratesError: null,
    getCurrencySymbol: () => "¥",
    updateCategories: fn,
    updateStatuses: fn,
    updatePaymentMethods: fn,
    updateSetting: fn,
    monthlyBudgetError: null,
    handleMonthlyBudgetInputChange: fn,
    toggleChannel: fn,
    handleRefreshRates: fn,
    handleUpdateCurrencies: fn,
    hasUnsavedChanges: overrides.hasUnsavedChanges ?? false,
    handleSaveChanges: fn,
    handleDiscardChanges: fn,
    handleDefaultCurrencyChange: fn,
    handleExchangeRateProviderChange: fn,
    handleThemeModeChange: fn,
    handleThemeVariantChange: fn,
    handleThemeCustomColorChange: fn,
    testingChannel: overrides.testingChannel ?? null,
    handleTestConnection: fn,
    isSavingSettings: overrides.isSavingSettings ?? false,
    notificationHistory: {
      data: undefined,
      isLoading: false,
      isFetching: false,
      error: null,
      historyStatus: "all",
      setStatus: fn,
      loadMore: fn,
      refetch: fn,
    },
    calendarFeed: {
      data: { enabled: overrides.calendarFeed?.enabled ?? false },
      feedUrl: overrides.calendarFeed?.feedUrl ?? null,
      isLoading: false,
      isCreating: false,
      isDeleting: false,
      createOrRotate: fn,
      copyUrl: fn,
      openSystem: fn,
      regenerate: fn,
      revoke: fn,
    },
    password: {
      passwordDialogOpen: false,
      setPasswordDialogOpen: fn,
      handlePasswordDialogOpenChange: fn,
      currentPassword: "",
      setCurrentPassword: fn,
      newPassword: "",
      setNewPassword: fn,
      confirmPassword: "",
      setConfirmPassword: fn,
      isUpdatingPassword: false,
      updatePassword: fn,
    },
    passwordResetEnabled: true,
  };
}

function RouteProbe() {
  const location = useLocation();
  return <div data-testid="route-path">{location.pathname}</div>;
}

export function renderSettingsScreen(initialEntries = ["/settings"]) {
  return render(
    <div id="root">
      <MemoryRouter initialEntries={initialEntries}>
        <TooltipProvider delayDuration={0}>
          <SettingsScreen />
        </TooltipProvider>
        <RouteProbe />
      </MemoryRouter>
    </div>,
  );
}
