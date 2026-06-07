import type { MessageKey } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import type { AiRecognizedSubscriptionDraft } from "@/lib/api/schemas/ai-recognition";
import { hasAIDraftBlockingIssues } from "@/modules/ai-recognition/domain/ai-draft-preflight";
import type { BillingCycle, CustomCycleUnit, SubscriptionStatus } from "@/types/subscription";

export const BILLING_CYCLE_LABEL_KEYS: Record<BillingCycle, MessageKey> = {
  weekly: "cycle.weekly",
  monthly: "cycle.monthly",
  quarterly: "cycle.quarterly",
  "semi-annual": "cycle.semiAnnual",
  annual: "cycle.annual",
  custom: "cycle.custom",
  "one-time": "cycle.oneTime",
};
export const STATUS_LABEL_KEYS: Record<SubscriptionStatus, MessageKey> = {
  trial: "status.trial",
  active: "status.active",
  expired: "status.expired",
  paused: "status.paused",
  cancelled: "status.cancelled",
};
export const CUSTOM_CYCLE_UNIT_LABEL_KEYS: Record<CustomCycleUnit, MessageKey> = {
  day: "subscription.customCycleUnit.day",
  week: "subscription.customCycleUnit.week",
  month: "subscription.customCycleUnit.month",
  year: "subscription.customCycleUnit.year",
};

export function draftHasMissingCore(draft: AiRecognizedSubscriptionDraft): boolean {
  return hasAIDraftBlockingIssues(draft);
}

export function buildDraftSearchText(draft: AiRecognizedSubscriptionDraft): string {
  return [
    draft.name,
    draft.category,
    draft.paymentMethod,
    draft.website?.value,
    draft.notes?.value,
    ...draft.tags,
  ].filter(Boolean).join(" ").toLowerCase();
}

export function formatDraftPrice(draft: AiRecognizedSubscriptionDraft, locale: Locale, unknownLabel: string): string {
  if (draft.price === null || !draft.currency) return unknownLabel;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: draft.currency,
      maximumFractionDigits: 2,
    }).format(draft.price);
  } catch {
    return `${draft.price} ${draft.currency}`;
  }
}
