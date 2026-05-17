import { describe, expect, it } from "vitest";
import {
  getTagsValidationError,
  getSubscriptionDraftValidationError,
  isOptionalHttpUrl,
  normalizeTagsArray,
  parseNonNegativeFiniteNumberInput,
  parseNonNegativeIntegerInput,
  parseTagsInput,
  toSubscriptionDraft,
} from "./subscription-form";
import { createSubscriptionFormState } from "@/types/subscription-form";
import { assertDateOnly } from "@/lib/time/date-only";

describe("subscription-form", () => {
  it("parses tags across supported separators and removes blanks", () => {
    expect(parseTagsInput("AI、工具, 生产力；\n年度;;")).toEqual(["AI", "工具", "生产力", "年度"]);
  });

  it("normalizes tag arrays with trimming and exact-text de-duplication", () => {
    expect(normalizeTagsArray([" AI ", "AI", "ai", "", "  工具  "])).toEqual(["AI", "ai", "工具"]);
  });

  it("builds an empty tags array when the tags input is blank", () => {
    const form = createSubscriptionFormState({
      name: "Aws",
      price: "15",
      currency: "USD",
      startDate: assertDateOnly("2026-05-14"),
      nextBillingDate: assertDateOnly("2026-06-14"),
      tags: [],
    });

    expect(toSubscriptionDraft(form)?.tags).toEqual([]);
  });

  it("validates the high protective tag limits", () => {
    expect(getTagsValidationError(Array.from({ length: 100 }, (_, index) => `tag-${index}`))).toBeNull();
    expect(getTagsValidationError(Array.from({ length: 101 }, (_, index) => `tag-${index}`))).toContain("100");
    expect(getTagsValidationError(["a".repeat(40)])).toBeNull();
    expect(getTagsValidationError(["a".repeat(41)])).toContain("40");
  });

  it("rejects loose numeric prefixes, Infinity, NaN and negative prices", () => {
    expect(parseNonNegativeFiniteNumberInput("0")).toBe(0);
    expect(parseNonNegativeFiniteNumberInput("0.00")).toBe(0);
    expect(parseNonNegativeFiniteNumberInput("12.5")).toBe(12.5);
    expect(parseNonNegativeFiniteNumberInput(".5")).toBe(0.5);
    expect(parseNonNegativeFiniteNumberInput("12abc")).toBeNull();
    expect(parseNonNegativeFiniteNumberInput("Infinity")).toBeNull();
    expect(parseNonNegativeFiniteNumberInput("NaN")).toBeNull();
    expect(parseNonNegativeFiniteNumberInput("-1")).toBeNull();
    expect(parseNonNegativeFiniteNumberInput("1000000001")).toBeNull();
  });

  it("accepts only integer reminder/custom day inputs", () => {
    expect(parseNonNegativeIntegerInput("0")).toBe(0);
    expect(parseNonNegativeIntegerInput("3")).toBe(3);
    expect(parseNonNegativeIntegerInput("3.5")).toBeNull();
    expect(parseNonNegativeIntegerInput("3days")).toBeNull();
    expect(parseNonNegativeIntegerInput("-1")).toBeNull();
    expect(parseNonNegativeIntegerInput("3651")).toBeNull();
  });

  it("accepts only blank or HTTP(S) optional URLs", () => {
    expect(isOptionalHttpUrl("")).toBe(true);
    expect(isOptionalHttpUrl("   ")).toBe(true);
    expect(isOptionalHttpUrl(undefined)).toBe(true);
    expect(isOptionalHttpUrl("https://example.com")).toBe(true);
    expect(isOptionalHttpUrl("http://example.com/path")).toBe(true);
    expect(isOptionalHttpUrl("ftp://example.com")).toBe(false);
    expect(isOptionalHttpUrl("not a url")).toBe(false);
  });

  it("returns null draft and a clear error for invalid price", () => {
    const form = createSubscriptionFormState({
      name: "Netflix",
      price: "1abc",
      startDate: assertDateOnly("2026-01-01"),
      nextBillingDate: assertDateOnly("2026-02-01"),
    });

    expect(getSubscriptionDraftValidationError(form)).toContain("金额");
    expect(toSubscriptionDraft(form)).toBeNull();
  });

  it("builds a draft for zero-price services", () => {
    const form = createSubscriptionFormState({
      name: "Free service",
      price: "0",
      startDate: assertDateOnly("2026-01-01"),
      nextBillingDate: assertDateOnly("2026-02-01"),
    });

    expect(toSubscriptionDraft(form)).toMatchObject({ price: 0 });
  });

  it("builds a draft only when custom cycle and reminder values are strict integers", () => {
    const valid = createSubscriptionFormState({
      name: "Server",
      price: "19.99",
      billingCycle: "custom",
      customDays: "45",
      reminderType: "custom",
      customReminderDays: "0",
      startDate: assertDateOnly("2026-01-01"),
      nextBillingDate: assertDateOnly("2026-02-15"),
    });

    expect(toSubscriptionDraft(valid)).toMatchObject({
      price: 19.99,
      customDays: 45,
      reminderDays: 0,
      autoCalculateNextBillingDate: true,
    });

    expect(toSubscriptionDraft({ ...valid, customDays: "45.5" })).toBeNull();
    expect(toSubscriptionDraft({ ...valid, customReminderDays: "1day" })).toBeNull();
  });

  it("preserves the auto-calculate switch in the draft", () => {
    const base = createSubscriptionFormState({
      name: "Manual renewal",
      price: "10",
      startDate: assertDateOnly("2026-01-01"),
      nextBillingDate: assertDateOnly("2026-03-15"),
    });

    expect(toSubscriptionDraft({ ...base, autoCalculate: true })?.autoCalculateNextBillingDate).toBe(true);
    expect(toSubscriptionDraft({ ...base, autoCalculate: false })?.autoCalculateNextBillingDate).toBe(false);
  });

  it("keeps repeat reminder presets in the draft", () => {
    const form = createSubscriptionFormState({
      name: "Critical SaaS",
      price: "99",
      startDate: assertDateOnly("2026-05-14"),
      nextBillingDate: assertDateOnly("2026-05-17"),
      repeatReminderEnabled: true,
      repeatReminderInterval: "3h",
      repeatReminderWindow: "full",
    });

    expect(toSubscriptionDraft(form)).toMatchObject({
      repeatReminderEnabled: true,
      repeatReminderInterval: "3h",
      repeatReminderWindow: "full",
    });
  });
});
