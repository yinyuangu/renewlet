import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { assertDateOnly } from "@/lib/time/date-only";
import type { Subscription } from "@/types/subscription";
import { SubscriptionDialog } from "./subscription-dialog";

const mocks = vi.hoisted(() => ({
  config: {
    categories: [{ id: "productivity", value: "productivity", labels: { "zh-CN": "效率工具", "en-US": "Productivity" } }],
    statuses: [{ id: "active", value: "active", labels: { "zh-CN": "活跃", "en-US": "Active" } }],
    paymentMethods: [{ id: "alipay", value: "alipay", labels: { "zh-CN": "支付宝", "en-US": "Alipay" } }],
    currencies: [
      { id: "CNY", value: "CNY", labels: { "zh-CN": "人民币 (¥)", "en-US": "Chinese yuan (¥)" }, enabled: true },
      { id: "USD", value: "USD", labels: { "zh-CN": "美元 ($)", "en-US": "US dollar ($)" }, enabled: true },
      { id: "EUR", value: "EUR", labels: { "zh-CN": "欧元 (€)", "en-US": "Euro (€)" }, enabled: true },
    ],
  },
}));

vi.mock("@/contexts/CustomConfigContext", () => ({
  useCustomConfig: () => ({
    config: mocks.config,
    updateCategories: vi.fn(),
    updateStatuses: vi.fn(),
    updatePaymentMethods: vi.fn(),
    updateCurrencies: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-settings", () => ({
  useSettings: () => ({
    data: { defaultCurrency: "USD" },
  }),
}));

vi.mock("@/components/logo-picker", () => ({
  LogoPicker: () => null,
}));

function makeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    name: "Critical SaaS",
    logo: undefined,
    price: 99,
    currency: "USD",
    billingCycle: "monthly",
    customDays: undefined,
    category: "productivity",
    status: "active",
    paymentMethod: "alipay",
    startDate: assertDateOnly("2026-05-14"),
    nextBillingDate: assertDateOnly("2026-06-13"),
    autoCalculateNextBillingDate: false,
    trialEndDate: undefined,
    website: undefined,
    notes: undefined,
    reminderDays: 3,
    tags: [],
    repeatReminderEnabled: true,
    repeatReminderInterval: "1h",
    repeatReminderWindow: "72h",
    ...overrides,
  } as Subscription;
}

describe("SubscriptionDialog", () => {
  it("shows field errors on empty create submit instead of relying on native validation", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="create"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
        />
      </TooltipProvider>,
    );

    expect(document.querySelector("form")).toHaveAttribute("novalidate");

    await user.click(screen.getByRole("button", { name: "添加订阅" }));

    expect(screen.getByText("请输入服务名称")).toBeInTheDocument();
    expect(screen.getByText("金额必须是 0 到 1,000,000,000 之间的有效数字")).toBeInTheDocument();
    expect(screen.getByText("请选择开始日期和下次扣费日期")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps a manually selected create currency instead of syncing back to the default", async () => {
    const user = userEvent.setup();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="create"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
        />
      </TooltipProvider>,
    );

    const dialog = screen.getByRole("dialog", { name: "添加新订阅" });
    expect(dialog).toHaveAccessibleDescription(/填写订阅名称/);
    expect(screen.getByLabelText("服务名称")).toBeInTheDocument();
    const priceInput = screen.getByLabelText("价格");
    expect(priceInput).toHaveAttribute("type", "text");
    expect(priceInput).toHaveAttribute("inputmode", "decimal");
    expect(screen.queryByRole("spinbutton", { name: "价格" })).not.toBeInTheDocument();

    const currencySelect = screen.getByRole("combobox", { name: "选择货币" });
    expect(currencySelect).toHaveTextContent("美元 ($)");

    await user.click(currencySelect);
    await user.click(await screen.findByText("人民币 (¥)"));

    expect(screen.getByRole("combobox", { name: "选择货币" })).toHaveTextContent("人民币 (¥)");
  });

  it("opens the date picker on the month of the selected field value", async () => {
    const user = userEvent.setup();
    const subscription: Subscription = {
      id: "sub-1",
      name: "OpenAI",
      logo: undefined,
      price: 20,
      currency: "USD",
      billingCycle: "monthly",
      customDays: undefined,
      category: "productivity",
      status: "active",
      paymentMethod: "alipay",
      startDate: assertDateOnly("2026-04-16"),
      nextBillingDate: assertDateOnly("2026-05-16"),
      autoCalculateNextBillingDate: false,
      trialEndDate: undefined,
      website: undefined,
      notes: undefined,
      reminderDays: 3,
      tags: [],
      repeatReminderEnabled: true,
      repeatReminderInterval: "1h",
      repeatReminderWindow: "72h",
    };

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={subscription}
        />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: /2026年4月16日/ }));

    expect(await screen.findByRole("button", { name: "2026年" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "四月" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2026年4月16日.*selected/ })).toBeInTheDocument();
  });

  it("shows website and notes fields for an edited subscription", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={makeSubscription({
            website: "https://billing.example.com",
            notes: "团队年度订阅",
          })}
        />
      </TooltipProvider>,
    );

    expect(screen.getByLabelText("网站")).toHaveValue("https://billing.example.com");
    expect(screen.getByLabelText("备注")).toHaveValue("团队年度订阅");
  });

  it("submits edited website and notes while preserving the subscription id", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
          subscription={makeSubscription({
            id: "sub-edit-website-notes",
            website: "https://old.example.com",
            notes: "旧备注",
          })}
        />
      </TooltipProvider>,
    );

    await user.clear(screen.getByLabelText("网站"));
    await user.type(screen.getByLabelText("网站"), "https://new.example.com");
    await user.clear(screen.getByLabelText("备注"));
    await user.type(screen.getByLabelText("备注"), "新备注");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      id: "sub-edit-website-notes",
      website: "https://new.example.com",
      notes: "新备注",
    }));
  });

  it("shows repeat reminder controls when enabled for an edited subscription", () => {
    const subscription: Subscription = {
      id: "sub-1",
      name: "Critical SaaS",
      logo: undefined,
      price: 99,
      currency: "USD",
      billingCycle: "monthly",
      customDays: undefined,
      category: "productivity",
      status: "active",
      paymentMethod: "alipay",
      startDate: assertDateOnly("2026-05-14"),
      nextBillingDate: assertDateOnly("2026-05-17"),
      autoCalculateNextBillingDate: false,
      trialEndDate: undefined,
      website: undefined,
      notes: undefined,
      reminderDays: 3,
      tags: [],
      repeatReminderEnabled: true,
      repeatReminderInterval: "3h",
      repeatReminderWindow: "full",
    };

    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={subscription}
        />
      </TooltipProvider>,
    );

    expect(screen.getByLabelText("重复提醒")).toBeChecked();
    expect(screen.getByRole("combobox", { name: "间隔" })).toHaveTextContent("每 3 小时");
    expect(screen.getByRole("combobox", { name: "重复范围" })).toHaveTextContent("从首次提醒后开始");
  });

  it("explains repeat reminders from the first reminder when the range covers the lead time", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={makeSubscription({ reminderDays: 1 })}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("首次提醒后，每 1 小时重复一次，直到到期日通知时间。")).toBeInTheDocument();
  });

  it("explains that repeats only run in the final range when the lead time is longer", () => {
    render(
      <TooltipProvider delayDuration={0}>
        <SubscriptionDialog
          mode="edit"
          open
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          subscription={makeSubscription({ reminderDays: 30 })}
        />
      </TooltipProvider>,
    );

    expect(screen.getByText("首次提醒照常发送，重复提醒只在到期前最后 72 小时内发送。")).toBeInTheDocument();
  });
});
