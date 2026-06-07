import type { AiRecognizedSubscriptionDraft } from "@/lib/api/schemas/ai-recognition";

export const AI_DRAFT_BLOCKING_ISSUE_CODES = [
  "price",
  "currency",
  "billingCycle",
  "dates",
  "customCycle",
] as const;

export type AIDraftBlockingIssueCode = typeof AI_DRAFT_BLOCKING_ISSUE_CODES[number];

export interface AIDraftBlockingIssue {
  code: AIDraftBlockingIssueCode;
  field: "price" | "currency" | "billingCycle" | "dates" | "customDays";
}

export function getAIDraftBlockingIssues(draft: AiRecognizedSubscriptionDraft): AIDraftBlockingIssue[] {
  const issues: AIDraftBlockingIssue[] = [];

  if (draft.price === null) {
    issues.push({ code: "price", field: "price" });
  }
  if (!draft.currency?.trim()) {
    issues.push({ code: "currency", field: "currency" });
  }
  if (!draft.billingCycle) {
    issues.push({ code: "billingCycle", field: "billingCycle" });
  } else if (draft.billingCycle === "custom" && (!draft.customDays || !draft.customCycleUnit)) {
    issues.push({ code: "customCycle", field: "customDays" });
  }
  if (!draft.startDate || !draft.nextBillingDate) {
    issues.push({ code: "dates", field: "dates" });
  }

  return issues;
}

export function hasAIDraftBlockingIssues(draft: AiRecognizedSubscriptionDraft): boolean {
  return getAIDraftBlockingIssues(draft).length > 0;
}
