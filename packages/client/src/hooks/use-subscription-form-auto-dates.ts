import { useEffect, type Dispatch, type SetStateAction } from "react";
import { calculateNextBillingDate, calculateOneTimeTermEndDate } from "@/lib/subscription-billing";
import { parsePositiveIntegerInput } from "@/lib/subscription-form";
import type { DateOnly } from "@/lib/time/date-only";
import type { SubscriptionFormState } from "@/types/subscription-form";

type SubscriptionFormAutoDatePatch = Pick<Partial<SubscriptionFormState>, "autoCalculate" | "nextBillingDate">;

export function useSubscriptionFormAutoDates(
  formData: SubscriptionFormState,
  setFormData: Dispatch<SetStateAction<SubscriptionFormState>>,
  billingReferenceDate: DateOnly,
  onAutoDatePatch?: (patch: SubscriptionFormAutoDatePatch) => void,
): void {
  useEffect(() => {
    const patch = getSubscriptionFormAutoDatePatch(formData, billingReferenceDate);
    if (!patch) return;
    setFormData((prev) => ({ ...prev, ...patch }));
    onAutoDatePatch?.(patch);
  }, [
    billingReferenceDate,
    formData.startDate,
    formData.billingCycle,
    formData.customDays,
    formData.customCycleUnit,
    formData.oneTimeMode,
    formData.oneTimeTermCount,
    formData.oneTimeTermUnit,
    formData.autoCalculate,
    formData.nextBillingDate,
    onAutoDatePatch,
    setFormData,
  ]);
}

export function getSubscriptionFormAutoDatePatch(
  formData: SubscriptionFormState,
  billingReferenceDate: DateOnly,
): SubscriptionFormAutoDatePatch | null {
  if (formData.billingCycle === "one-time") {
    const oneTimeTermCount = formData.oneTimeMode === "term" ? parsePositiveIntegerInput(formData.oneTimeTermCount) : null;
    const nextBillingDate = formData.startDate && oneTimeTermCount
      ? calculateOneTimeTermEndDate(formData.startDate, oneTimeTermCount, formData.oneTimeTermUnit)
      : formData.startDate;
    return compactAutoDatePatch(formData, {
      autoCalculate: false,
      nextBillingDate,
    });
  }
  if (formData.autoCalculate && formData.startDate) {
    const customDays = formData.billingCycle === "custom" ? parsePositiveIntegerInput(formData.customDays) ?? 30 : undefined;
    const customCycleUnit = formData.billingCycle === "custom" ? formData.customCycleUnit : "day";
    return compactAutoDatePatch(formData, {
      nextBillingDate: calculateNextBillingDate(formData.startDate, formData.billingCycle, customDays, billingReferenceDate, customCycleUnit),
    });
  }
  return null;
}

function compactAutoDatePatch(
  formData: SubscriptionFormState,
  patch: SubscriptionFormAutoDatePatch,
): SubscriptionFormAutoDatePatch | null {
  const compacted: SubscriptionFormAutoDatePatch = {};
  if (patch.autoCalculate !== undefined && patch.autoCalculate !== formData.autoCalculate) {
    compacted.autoCalculate = patch.autoCalculate;
  }
  if (patch.nextBillingDate !== formData.nextBillingDate) {
    compacted.nextBillingDate = patch.nextBillingDate;
  }
  return Object.keys(compacted).length > 0 ? compacted : null;
}
