import { describe, expect, it } from "vitest";
import { EMAIL_MAX_HTML_BYTES, buildNotificationEmail, type NotificationEmailMessage, type NotificationEmailSettings } from "./email-template";

function settings(overrides: Partial<NotificationEmailSettings> = {}): NotificationEmailSettings {
  return {
    locale: "zh-CN",
    themeVariant: "emerald",
    themeCustomColor: { h: 160, s: 84, l: 39 },
    ...overrides,
  };
}

describe("buildNotificationEmail", () => {
  it("renders zh-CN reminder groups with the branded table template", () => {
    const email = buildNotificationEmail(settings({ themeVariant: "ocean" }), {
      title: "Renewlet 订阅提醒",
      content: "即将续费：Renewlet",
      timestamp: "2026-05-14 08:00:00 Asia/Shanghai",
      hasPayload: true,
      items: [
        item("renewal", "Renewal", 18, "CNY", "2026-05-17", 3),
        item("trial", "Trial", 9.9, "USD", "2026-05-15", 1),
        item("expired", "Expired", 12, "EUR", "2026-05-01", 7),
      ],
    }, { appUrl: "https://renewlet.example/app/" });

    expect(email.subject).toBe("Renewlet 订阅提醒");
    expect(email.text).toContain("即将续费：Renewlet");
    expect(email.html).toContain('<table role="presentation"');
    expect(email.html).toContain('width="600"');
    expect(email.html).toContain('<html lang="zh-CN">');
    expect(email.html).toContain("今日提醒");
    expect(email.html).toContain("即将续费");
    expect(email.html).toContain("试用结束");
    expect(email.html).toContain("已过期");
    expect(email.html).toContain("18 CNY");
    expect(email.html).toContain('href="https://renewlet.example/app/subscriptions"');
    expect(email.html).not.toContain("display:flex");
    expect(email.html).not.toContain("display:grid");
  });

  it("renders en-US test notifications and settings CTA", () => {
    const email = buildNotificationEmail(settings({ locale: "en-US" }), {
      title: "Renewlet test notification",
      content: "If you received this message, the channel is ready.",
      timestamp: "2026-05-14 08:00:00 UTC",
      hasPayload: true,
      items: [],
    }, { appUrl: "https://renewlet.example" });

    expect(email.html).toContain('<html lang="en-US">');
    expect(email.html).toContain("Channel check");
    expect(email.html).toContain("Message");
    expect(email.html).toContain("If you received this message");
    expect(email.html).toContain("Generated at");
    expect(email.html).toContain('href="https://renewlet.example/settings"');
  });

  it("escapes user content and omits item logo urls", () => {
    const email = buildNotificationEmail(settings(), {
      title: '<script>alert("title")</script>',
      content: "Line <b>one</b>\nLine two",
      timestamp: "2026-05-14 08:00:00 Asia/Shanghai",
      hasPayload: true,
      items: [{
        ...item("renewal", "<img src=x onerror=alert(1)>", 8, "<USD>", "2026-05-17", 3),
        logoUrl: "https://cdn.example.com/private-logo.png",
      }],
    });

    expect(email.html).toContain("&lt;script&gt;alert(&quot;title&quot;)&lt;/script&gt;");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(email.html).toContain("&lt;USD&gt;");
    expect(email.html).not.toContain("<script");
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain("https://cdn.example.com/private-logo.png");
  });

  it("maps custom theme colors and dark-mode client css", () => {
    const email = buildNotificationEmail(settings({
      themeVariant: "custom",
      themeCustomColor: { h: 210, s: 90, l: 45 },
    }), testMessage());

    expect(email.html).toContain("#0B73DA");
    expect(email.html).toContain("@media (prefers-color-scheme: dark)");
    expect(email.html).not.toContain("ZgotmplZ");
  });

  it("falls back to compact content when html would exceed the clipping guard", () => {
    const items = Array.from({ length: 800 }, (_, index) => item("renewal", `Very Long Subscription Name ${index}`, 18, "CNY", "2026-05-17", 3));
    const email = buildNotificationEmail(settings(), {
      title: "Renewlet 订阅提醒",
      content: "即将续费：Renewlet\n".repeat(2_000),
      timestamp: "2026-05-14 08:00:00 UTC",
      hasPayload: true,
      items,
    });

    expect(new TextEncoder().encode(email.html).length).toBeLessThan(EMAIL_MAX_HTML_BYTES);
    expect(email.html).toContain("内容较长");
    expect(email.html).toContain("提醒项目");
    expect(email.html).toContain(">800</strong>");
  });
});

function testMessage(): NotificationEmailMessage {
  return {
    title: "Renewlet 测试通知",
    content: "如果你收到这条消息，说明通知渠道已经配置成功。",
    timestamp: "2026-05-14 08:00:00 UTC",
    hasPayload: true,
    items: [],
  };
}

function item(type: "renewal" | "trial" | "expired", name: string, price: number, currency: string, targetDate: string, reminderDays: number) {
  return {
    type,
    subscriptionId: type,
    name,
    price,
    currency,
    status: type === "trial" ? "trial" : "active",
    targetDate,
    reminderDays,
    daysUntil: reminderDays,
  };
}
