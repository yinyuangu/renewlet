/**
 * ICS 生成器是 Go/PocketBase 和 Cloudflare 公开日历 Feed 的共同输出层。
 *
 * 它只接收应用已经计算好的下一次 date-only 事件；不生成 RRULE，避免外部日历复刻 Renewlet 续订算法。
 */
import ical, { ICalAlarmType, ICalCalendarMethod } from "ical-generator";

/** ICS 中的单个续费事件；date 始终是 YYYY-MM-DD，不是 datetime。 */
export interface RenewalCalendarEvent {
  uid: string;
  kind: "renewal" | "expiry";
  date: string;
  summary: string;
  description: string;
  categories?: string;
  url?: string;
  reminderDays?: number;
}

/** 生成 ICS 事件所需的订阅窄视图，避免日历模块依赖完整 API subscription。 */
export interface RenewalCalendarSubscription {
  id: string;
  name: string;
  price: number;
  currency: string;
  billingCycle: string;
  oneTimeTermCount?: number | undefined;
  category: string;
  paymentMethod?: string | undefined;
  nextBillingDate: string;
  website?: string | undefined;
  notes?: string | undefined;
}

export interface RenewalCalendarEventLabels {
  amount: string;
  billingCycle: string;
  category: string;
  paymentMethod?: string | undefined;
}

/** 文案由调用方按用户 locale 传入，ICS 模块只负责结构和转义，不依赖服务端 i18n runtime。 */
export interface RenewalCalendarEventText {
  amount: (value: { amount: string; currency: string }) => string;
  billingCycle: (cycle: string) => string;
  category: (category: string) => string;
  paymentMethod: (paymentMethod: string) => string;
  notes: (notes: string) => string;
}

export interface RenewalCalendarEventMapperOptions {
  subscription: RenewalCalendarSubscription;
  labels: RenewalCalendarEventLabels;
  reminderDays?: number | undefined;
  text: RenewalCalendarEventText;
}

export interface RenewalCalendarOptions {
  name: string;
  sourceUrl?: string;
  generatedAt: Date;
  events: RenewalCalendarEvent[];
}

const CALENDAR_TTL_SECONDS = 60 * 60;
const PROD_ID = {
  company: "Renewlet",
  language: "EN",
  product: "Renewal Calendar",
} as const;

export function buildRenewalCalendarEvent(options: RenewalCalendarEventMapperOptions): RenewalCalendarEvent {
  const { subscription, labels, reminderDays, text } = options;
  const kind = subscription.billingCycle === "one-time" ? "expiry" : "renewal";
  const lines = [
    text.amount({ amount: labels.amount, currency: subscription.currency }),
    text.billingCycle(labels.billingCycle),
    text.category(labels.category),
  ];
  if (labels.paymentMethod) {
    lines.push(text.paymentMethod(labels.paymentMethod));
  }
  if (subscription.notes?.trim()) {
    lines.push(text.notes(subscription.notes.trim()));
  }

  const event: RenewalCalendarEvent = {
    uid: `renewlet-${kind}-${subscription.id}@renewlet`,
    kind,
    date: subscription.nextBillingDate,
    summary: subscription.name,
    description: lines.join("\n"),
    categories: labels.category,
  };
  if (typeof reminderDays === "number") {
    event.reminderDays = reminderDays;
  }
  if (subscription.website) {
    event.url = subscription.website;
  }
  return event;
}

/**
 * 生成公开日历订阅内容。
 *
 * Renewlet 只导出当前 nextBillingDate 的全日事件，不写 RRULE；
 * 续费算法仍由应用自己计算，外部日历只负责订阅展示。
 */
export function buildRenewalCalendarIcs(options: RenewalCalendarOptions): string {
  const calendar = ical({
    method: ICalCalendarMethod.PUBLISH,
    name: options.name,
    prodId: PROD_ID,
    scale: "GREGORIAN",
  });
  if (options.sourceUrl) {
    calendar.source(options.sourceUrl);
    calendar.ttl(CALENDAR_TTL_SECONDS);
  }

  const events = [...options.events].sort((left, right) => {
    const dateOrder = left.date.localeCompare(right.date);
    return dateOrder === 0 ? left.summary.localeCompare(right.summary) : dateOrder;
  });

  for (const event of events) {
    // date-only 续费事件只承载 Renewlet 已计算出的下一次日期；不写 RRULE，避免外部日历自行推算后漂移。
    const calendarEvent = calendar.createEvent({
      allDay: true,
      description: event.description,
      end: dateOnlyToUtcDate(addDateOnly(event.date, 1)),
      id: event.uid,
      stamp: options.generatedAt,
      start: dateOnlyToUtcDate(event.date),
      summary: event.summary,
    });
    calendarEvent.uid(event.uid);
    if (event.categories) {
      calendarEvent.createCategory({ name: event.categories });
    }
    if (event.url) {
      calendarEvent.url(event.url);
    }
    if (typeof event.reminderDays === "number" && event.reminderDays >= 0) {
      calendarEvent.createAlarm({
        description: event.summary,
        trigger: Math.max(0, event.reminderDays) * 86_400,
        type: ICalAlarmType.display,
      });
    }
  }

  return calendar.toString();
}

function addDateOnly(date: string, days: number): string {
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  return new Date(timestamp + days * 86_400_000).toISOString().slice(0, 10);
}

function dateOnlyToUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}
