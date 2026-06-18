import { describe, expect, it } from "vitest";
import {
  calculateCostSharingMemberAmount,
  calculateCostSharingSummary,
  costSharingCustomAmountsAreValid,
  type CostSharing,
} from "./cost-sharing";

const equalSharing: CostSharing = {
  enabled: true,
  payerMemberId: "me",
  selfMemberId: "me",
  splitMode: "equal",
  members: [
    { id: "me", name: "Me", included: true },
    { id: "partner", name: "Partner", included: true },
    { id: "child", name: "Child", included: true },
  ],
};

describe("cost sharing calculation", () => {
  it("splits equal shares and marks recoverable amount only for the payer", () => {
    const summary = calculateCostSharingSummary(equalSharing, 90);

    expect(calculateCostSharingMemberAmount(equalSharing, equalSharing.members[0]!, 90)).toBe(30);
    expect(summary).toMatchObject({
      enabled: true,
      total: 90,
      yourShare: 30,
      familyContribution: 60,
      recoverableAmount: 60,
      includedCount: 3,
    });
  });

  it("keeps family contribution non-recoverable when the current user is not the payer", () => {
    expect(calculateCostSharingSummary({ ...equalSharing, payerMemberId: "partner" }, 90)).toMatchObject({
      yourShare: 30,
      familyContribution: 60,
      recoverableAmount: 0,
    });
  });

  it("converts custom member currencies back to the subscription currency", () => {
    const customSharing: CostSharing = {
      enabled: true,
      payerMemberId: "me",
      selfMemberId: "me",
      splitMode: "custom",
      members: [
        { id: "me", name: "Me", currency: "USD", included: true, customAmount: 40 },
        { id: "partner", name: "Partner", currency: "CNY", included: true, customAmount: 420 },
      ],
    };
    const convert = (amount: number, from: string, to: string) => {
      if (from === "CNY" && to === "USD") return amount / 7;
      if (from === "USD" && to === "CNY") return amount * 7;
      return amount;
    };

    expect(costSharingCustomAmountsAreValid(customSharing)).toBe(true);
    expect(calculateCostSharingSummary(customSharing, 100, { baseCurrency: "USD", convert })).toMatchObject({
      yourShare: 40,
      familyContribution: 60,
      recoverableAmount: 60,
    });
  });

  it("allows custom totals to differ from the subscription price", () => {
    expect(costSharingCustomAmountsAreValid({
      ...equalSharing,
      splitMode: "custom",
      members: [
        { id: "me", name: "Me", currency: "USD", included: true, customAmount: 40 },
        { id: "partner", name: "Partner", currency: "USD", included: true, customAmount: 50 },
      ],
    })).toBe(true);
  });

  it("rejects missing custom amounts for included members", () => {
    expect(costSharingCustomAmountsAreValid({
      ...equalSharing,
      splitMode: "custom",
      members: [
        { id: "me", name: "Me", currency: "USD", included: true, customAmount: 40 },
        { id: "partner", name: "Partner", currency: "CNY", included: true },
      ],
    })).toBe(false);
  });
});
