// 设置目录测试聚焦 scrollspy 状态机，避免页面主体测试文件再次超过 CI 行数门禁。
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createControllerState,
  mocks,
  renderSettingsScreen,
  SETTINGS_SECTION_IDS,
  SettingsIntersectionObserverMock,
  setRootMetrics,
  setSectionAnchorGeometry,
  setSettingsSectionTops,
  TEST_ACTIVE_SECTION_TOP_PX,
  TEST_NEXT_SECTION_TOP_PX,
} from "./settings-screen.test-utils";

describe("SettingsScreen section navigation", () => {
  beforeEach(() => {
    SettingsIntersectionObserverMock.instances = [];
    Element.prototype.hasPointerCapture = vi.fn(() => false);
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    vi.stubGlobal("IntersectionObserver", SettingsIntersectionObserverMock);
    mocks.useSettingsFormController.mockReturnValue(createControllerState());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("renders section navigation links that target every settings section", () => {
    const { container } = renderSettingsScreen();
    const sections = [
      ["settings-account", "账户"],
      ["settings-appearance", "外观"],
      ["settings-display", "显示"],
      ["settings-icon-sources", "图标来源"],
      ["settings-budget", "预算"],
      ["settings-data-config", "数据配置"],
      ["settings-exchange", "汇率"],
      ["settings-calendar-feed", "日历订阅"],
      ["settings-timezone", "时区"],
      ["settings-notifications", "通知"],
    ] as const;

    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    expect(desktopNav).toHaveClass("sticky", "top-28", "bg-card/70", "backdrop-blur", "overflow-y-auto");
    expect(within(desktopNav).getByRole("link", { name: "账户" })).toHaveAttribute("aria-current", "location");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    expect(scrollSpy).toBeDefined();
    expect(scrollSpy?.root).toBe(document.getElementById("root"));
    expect(scrollSpy?.rootMargin).toBe("-20% 0px -65% 0px");
    expect(screen.queryByTestId("settings-section-content-scroll")).not.toBeInTheDocument();
    const content = screen.getByTestId("settings-section-content");
    expect(content).not.toHaveClass("lg:overflow-y-auto");
    const headings = within(content).getAllByRole("heading", { name: "系统配置" });
    expect(headings).toHaveLength(2);
    const [mobileHeading, desktopHeading] = headings;
    expect(mobileHeading).toBeDefined();
    expect(desktopHeading).toBeDefined();
    expect(mobileHeading?.closest("[data-testid='settings-mobile-page-header']")).not.toBeNull();
    expect(desktopHeading?.closest(".hidden.lg\\:block")).not.toBeNull();
    const subtitles = within(content).getAllByText("管理您的账户、显示和通知设置");
    expect(subtitles).toHaveLength(2);
    const [mobileSubtitle, desktopSubtitle] = subtitles;
    expect(mobileSubtitle).toBeDefined();
    expect(desktopSubtitle).toBeDefined();
    expect(mobileSubtitle).toHaveAttribute("data-testid", "settings-mobile-page-subtitle");
    expect(mobileSubtitle?.closest("[data-testid='settings-mobile-page-header']")).toBeNull();
    expect(mobileSubtitle?.compareDocumentPosition(mobileHeading as Element)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    expect(desktopSubtitle?.closest(".hidden.lg\\:block")).not.toBeNull();
    expect(within(content).getByRole("heading", { name: "管理员账户" })).toBeInTheDocument();
    expect(screen.queryByTestId("settings-section-nav-floating-trigger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-section-nav-toolbar")).not.toBeInTheDocument();
    const mobileHeader = within(content).getByTestId("settings-mobile-page-header");
    expect(mobileHeader).toHaveClass(
      "sticky",
      "top-[calc(8.25rem+env(safe-area-inset-top))]",
      "bg-background/90",
      "border-b",
      "lg:hidden",
    );
    const accountSection = container.querySelector("#settings-account");
    expect(accountSection).not.toBeNull();
    expect(mobileHeader.compareDocumentPosition(accountSection as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const mobileTrigger = within(mobileHeader).getByRole("button", { name: /打开设置目录/ });
    expect(mobileTrigger).toHaveClass("h-9", "w-9", "rounded-lg", "bg-card/80");
    expect(mobileTrigger).not.toHaveTextContent("目录");
    expect(mobileTrigger).not.toHaveTextContent("时区");
    expect(within(mobileHeader).queryByText("管理您的账户、显示和通知设置")).not.toBeInTheDocument();
    const sectionNav = within(desktopNav);

    sections.forEach(([id, label]) => {
      expect(container.querySelector(`section#${id}`)).toHaveClass(
        "scroll-mt-[calc(13rem+env(safe-area-inset-top))]",
        "lg:scroll-mt-24",
      );
      const links = sectionNav.getAllByRole("link", { name: label });
      expect(links).toHaveLength(1);
      links.forEach((link) => expect(link).toHaveAttribute("href", `#${id}`));
      expect(scrollSpy?.observedElements).toContain(container.querySelector(`section#${id}`));
    });
    expect(scrollSpy?.observedElements.map((element) => element.id)).toEqual([...SETTINGS_SECTION_IDS]);
  });

  it("opens mobile section navigation as a left drawer", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    await user.click(within(screen.getByTestId("settings-mobile-page-header")).getByRole("button", { name: /打开设置目录/ }));

    const drawer = await screen.findByTestId("settings-section-nav-drawer");
    expect(drawer).toHaveClass(
      "fixed",
      "left-0",
      "top-[var(--app-visual-viewport-offset-top)]",
      "h-[var(--app-viewport-height)]",
      "max-h-[var(--app-viewport-height)]",
      "z-[80]",
      "rounded-r-xl",
      "bg-card/95",
    );
    const notificationLink = within(drawer).getByRole("link", { name: "通知" });
    expect(notificationLink).toHaveClass("rounded-lg", "px-3", "py-2", "text-sm");
    expect(notificationLink).not.toHaveClass("h5-mobile-option-item");
    expect(notificationLink).not.toHaveClass("border", "bg-secondary/30");
    expect(drawer.querySelector(".overflow-x-auto")).toBeNull();
  });

  it("marks the active section navigation item with aria-current", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    const nav = screen.getByTestId("settings-section-nav-desktop");
    const notificationLink = within(nav).getByRole("link", { name: "通知" });
    await user.click(notificationLink);

    expect(notificationLink).toHaveAttribute("aria-current", "location");
  });

  it("updates the active section from the app scroll container observer without changing the hash", async () => {
    renderSettingsScreen();

    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    expect(scrollSpy).toBeDefined();
    expect(window.location.hash).toBe("");

    setSectionAnchorGeometry("settings-timezone");
    scrollSpy?.trigger(["settings-timezone"]);

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "时区" })).toHaveAttribute("aria-current", "location");
    });
    expect(window.location.hash).toBe("");

    setSectionAnchorGeometry("settings-notifications");
    scrollSpy?.trigger(["settings-notifications"]);

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "通知" })).toHaveAttribute("aria-current", "location");
    });
    expect(window.location.hash).toBe("");
  });

  it("keeps clicked target active while smooth scrolling passes intermediate sections", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    await user.click(within(desktopNav).getByRole("link", { name: "通知" }));

    setSectionAnchorGeometry("settings-appearance");
    scrollSpy?.trigger(["settings-appearance"]);
    setSectionAnchorGeometry("settings-display");
    scrollSpy?.trigger(["settings-display"]);
    setSectionAnchorGeometry("settings-timezone");
    scrollSpy?.trigger(["settings-timezone"]);

    expect(within(desktopNav).getByRole("link", { name: "通知" })).toHaveAttribute("aria-current", "location");

    setSectionAnchorGeometry("settings-notifications");
    scrollSpy?.trigger(["settings-notifications"]);
    scrollSpy?.trigger(["settings-timezone"]);

    expect(within(desktopNav).getByRole("link", { name: "通知" })).toHaveAttribute("aria-current", "location");
  });

  it("keeps icon sources active when the adjacent budget section is also visible", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    const root = setSectionAnchorGeometry("settings-icon-sources");
    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    await user.click(within(desktopNav).getByRole("link", { name: "图标来源" }));

    setSettingsSectionTops({
      "settings-icon-sources": TEST_ACTIVE_SECTION_TOP_PX,
      "settings-budget": TEST_NEXT_SECTION_TOP_PX,
    });
    scrollSpy?.trigger(["settings-icon-sources", "settings-budget"]);
    root.dispatchEvent(new Event("scrollend"));

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "图标来源" })).toHaveAttribute("aria-current", "location");
    });
    expect(within(desktopNav).getByRole("link", { name: "预算" })).not.toHaveAttribute("aria-current");
  });

  it("hands active state back to scrollspy when the user interrupts a menu scroll", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    const root = setSectionAnchorGeometry("settings-account");
    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    await user.click(within(desktopNav).getByRole("link", { name: "通知" }));

    setSectionAnchorGeometry("settings-timezone");
    scrollSpy?.trigger(["settings-timezone"]);
    root.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    scrollSpy?.trigger(["settings-timezone"]);

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "时区" })).toHaveAttribute("aria-current", "location");
    });
  });

  it("releases menu scroll intent on scrollend", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    const root = setSectionAnchorGeometry("settings-account");
    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    await user.click(within(desktopNav).getByRole("link", { name: "通知" }));

    setSectionAnchorGeometry("settings-timezone");
    scrollSpy?.trigger(["settings-timezone"]);
    root.dispatchEvent(new Event("scrollend"));
    scrollSpy?.trigger(["settings-timezone"]);

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "时区" })).toHaveAttribute("aria-current", "location");
    });
  });

  it("keeps mobile section navigation active state in sync with scrollspy", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    setSectionAnchorGeometry("settings-notifications", {
      rootMetrics: { scrollTop: 1600, clientHeight: 800, scrollHeight: 2400 },
    });
    scrollSpy?.trigger(["settings-notifications"]);

    await user.click(within(screen.getByTestId("settings-mobile-page-header")).getByRole("button", { name: /打开设置目录/ }));

    const drawer = await screen.findByTestId("settings-section-nav-drawer");
    const activeNotificationLink = within(drawer).getByRole("link", { name: "通知" });
    expect(activeNotificationLink).toHaveAttribute("aria-current", "location");
    expect(activeNotificationLink).toHaveClass("bg-primary/10", "text-primary");
  });

  it("activates the last section only near the bottom edge", async () => {
    renderSettingsScreen();

    const desktopNav = screen.getByTestId("settings-section-nav-desktop");
    const scrollSpy = SettingsIntersectionObserverMock.instances[0];
    setSectionAnchorGeometry("settings-timezone", {
      rootMetrics: { scrollTop: 1200, clientHeight: 800, scrollHeight: 2400 },
    });
    scrollSpy?.trigger(["settings-timezone", "settings-notifications"]);

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "时区" })).toHaveAttribute("aria-current", "location");
    });

    setRootMetrics({ scrollTop: 1600, clientHeight: 800, scrollHeight: 2400 });
    scrollSpy?.trigger(["settings-notifications"]);

    await waitFor(() => {
      expect(within(desktopNav).getByRole("link", { name: "通知" })).toHaveAttribute("aria-current", "location");
    });
  });

  it("closes the mobile drawer after selecting a settings section", async () => {
    const user = userEvent.setup();
    renderSettingsScreen();

    await user.click(within(screen.getByTestId("settings-mobile-page-header")).getByRole("button", { name: /打开设置目录/ }));
    const drawer = await screen.findByTestId("settings-section-nav-drawer");
    await user.click(within(drawer).getByRole("link", { name: "通知" }));

    await waitFor(() => expect(screen.queryByTestId("settings-section-nav-drawer")).not.toBeInTheDocument());
    expect(window.location.hash).toBe("#settings-notifications");

    await user.click(within(screen.getByTestId("settings-mobile-page-header")).getByRole("button", { name: /打开设置目录/ }));
    const reopenedDrawer = await screen.findByTestId("settings-section-nav-drawer");
    const activeNotificationLink = within(reopenedDrawer).getByRole("link", { name: "通知" });
    expect(activeNotificationLink).toHaveAttribute("aria-current", "location");
    expect(activeNotificationLink).toHaveClass("bg-primary/10", "text-primary");
    expect(activeNotificationLink.querySelector(".absolute.left-0")).not.toBeNull();
    expect(activeNotificationLink.querySelector("svg")).toBeNull();
  });

  it("does not ask for leave confirmation when unsaved changes navigate within settings hash", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    mocks.useSettingsFormController.mockReturnValue(createControllerState({
      hasUnsavedChanges: true,
    }));

    renderSettingsScreen();

    const nav = screen.getByTestId("settings-section-nav-desktop");
    await user.click(within(nav).getByRole("link", { name: "通知" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#settings-notifications");
    confirmSpy.mockRestore();
  });
});
