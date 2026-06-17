export const COST_SHARING_SPLIT_MODES = ["equal", "custom"] as const;

export type CostSharingSplitMode = (typeof COST_SHARING_SPLIT_MODES)[number];

export interface CostSharingMember {
  id: string;
  name: string;
  note?: string | undefined;
  currency?: string | undefined;
  included: boolean;
  customAmount?: number | undefined;
}

export interface CostSharing {
  enabled: boolean;
  payerMemberId: string;
  selfMemberId: string;
  splitMode: CostSharingSplitMode;
  members: CostSharingMember[];
}

export interface CostSharingSummary {
  enabled: boolean;
  total: number;
  yourShare: number;
  familyContribution: number;
  recoverableAmount: number;
  includedCount: number;
}

const MONEY_EPSILON = 0.01;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function isCostSharingEnabled(costSharing: CostSharing | undefined): costSharing is CostSharing {
  return Boolean(costSharing?.enabled && costSharing.members.length > 0);
}

export function calculateCostSharingMemberAmount(costSharing: CostSharing, member: CostSharingMember, total: number): number {
  if (!member.included) return 0;
  if (costSharing.splitMode === "custom") return roundMoney(member.customAmount ?? 0);
  const includedCount = costSharing.members.filter((item) => item.included).length;
  if (includedCount <= 0) return 0;
  return roundMoney(total / includedCount);
}

export function calculateCostSharingSummary(costSharing: CostSharing | undefined, total: number): CostSharingSummary {
  if (!isCostSharingEnabled(costSharing)) {
    return {
      enabled: false,
      total,
      yourShare: total,
      familyContribution: 0,
      recoverableAmount: 0,
      includedCount: 0,
    };
  }

  const includedMembers = costSharing.members.filter((member) => member.included);
  const selfMember = costSharing.members.find((member) => member.id === costSharing.selfMemberId);
  const yourShare = selfMember ? calculateCostSharingMemberAmount(costSharing, selfMember, total) : total;
  const familyContribution = roundMoney(Math.max(total - yourShare, 0));
  const recoverableAmount = costSharing.payerMemberId === costSharing.selfMemberId ? familyContribution : 0;

  return {
    enabled: true,
    total,
    yourShare,
    familyContribution,
    recoverableAmount,
    includedCount: includedMembers.length,
  };
}

export function costSharingCustomTotalMatches(costSharing: CostSharing, total: number): boolean {
  if (costSharing.splitMode !== "custom") return true;
  const customTotal = costSharing.members.reduce((sum, member) => {
    if (!member.included) return sum;
    return sum + (member.customAmount ?? 0);
  }, 0);
  return Math.abs(roundMoney(customTotal) - roundMoney(total)) <= MONEY_EPSILON;
}
