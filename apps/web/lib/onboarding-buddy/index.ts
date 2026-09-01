// Pure, unit-testable helpers for Onboarding Buddy. No I/O, no framework imports.

import type {
  OnboardingBuddyMember,
  OnboardingBuddyPairing,
  OnboardingBuddyPlanItem,
  OnboardingBuddySummary,
} from "./types";

/** A member joined within this many days is still eligible to be treated as "new". */
export const NEW_MEMBER_WINDOW_DAYS = 21;

/** The deterministic first-week onboarding checklist template. Grounded, not AI-invented per pairing. */
export type FirstWeekPlanTemplateItem = { dayOffset: number; title: string; description: string };

export const FIRST_WEEK_PLAN_TEMPLATE: FirstWeekPlanTemplateItem[] = [
  {
    dayOffset: 0,
    title: "Meet your buddy and tour the shop",
    description: "Walk the build space together: safety zones, tool storage, and where the team keeps documentation.",
  },
  {
    dayOffset: 0,
    title: "Set up team accounts",
    description: "Confirm access to chat, the wiki, and any shared drives with your buddy watching.",
  },
  {
    dayOffset: 1,
    title: "Shadow a subteam meeting",
    description: "Sit in on your buddy's subteam standup to see how work gets assigned and tracked.",
  },
  {
    dayOffset: 2,
    title: "Review safety training",
    description: "Complete required safety training with your buddy as a resource for questions.",
  },
  {
    dayOffset: 3,
    title: "Pair on a small build task",
    description: "Work a low-risk task together so your buddy can show tools and conventions hands-on.",
  },
  {
    dayOffset: 5,
    title: "Read the team wiki basics",
    description: "Skim onboarding and process pages your buddy points you to; note any questions.",
  },
  {
    dayOffset: 7,
    title: "First-week check-in",
    description: "Sit down with your buddy to review the week, answer open questions, and set week-two goals.",
  },
];

export function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function isRecentJoin(joinedAtIso: string, nowIso: string, windowDays = NEW_MEMBER_WINDOW_DAYS): boolean {
  return daysBetween(joinedAtIso, nowIso) <= windowDays;
}

/**
 * Picks the best buddy candidate for a new member: most tenured member with the
 * fewest currently-active pairings as a buddy, excluding the new member themselves.
 */
/** Roster members who may be chosen as a buddy — other org user ids only. */
export function eligibleBuddyCandidates<T extends { userId: string }>(
  members: T[],
  newMemberId: string,
): T[] {
  return members.filter((m) => m.userId && m.userId !== newMemberId);
}

export function suggestBuddy(
  candidates: OnboardingBuddyMember[],
  newMemberId: string,
  activeBuddyCounts: Record<string, number>,
): OnboardingBuddyMember | null {
  const eligible = eligibleBuddyCandidates(candidates, newMemberId);
  if (eligible.length === 0) return null;
  const sorted = [...eligible].sort((a, b) => {
    const loadA = activeBuddyCounts[a.userId] ?? 0;
    const loadB = activeBuddyCounts[b.userId] ?? 0;
    if (loadA !== loadB) return loadA - loadB;
    return b.tenureDays - a.tenureDays;
  });
  return sorted[0] ?? null;
}

export function findUnpairedMembers(
  members: OnboardingBuddyMember[],
  pairedNewMemberIds: Set<string>,
  nowIso: string,
): OnboardingBuddyMember[] {
  return members
    .filter((m) => !pairedNewMemberIds.has(m.userId) && isRecentJoin(m.joinedAt, nowIso))
    .sort((a, b) => a.tenureDays - b.tenureDays);
}

export type FirstWeekPlanDraftItem = FirstWeekPlanTemplateItem & { sequence: number };

export function buildFirstWeekPlanItems(): FirstWeekPlanDraftItem[] {
  return FIRST_WEEK_PLAN_TEMPLATE.map((item, index) => ({ ...item, sequence: index }));
}

export function planProgress(items: OnboardingBuddyPlanItem[]): { total: number; done: number } {
  return { total: items.length, done: items.filter((i) => i.done).length };
}

export function summarizeOnboardingBuddy(
  members: OnboardingBuddyMember[],
  unpairedCount: number,
  pairings: OnboardingBuddyPairing[],
): OnboardingBuddySummary {
  const activePairingCount = pairings.filter((p) => p.status === "active").length;
  const completedPairingCount = pairings.filter((p) => p.status === "completed").length;
  const eligiblePool = activePairingCount + unpairedCount;
  const pairingCoverage = eligiblePool > 0 ? activePairingCount / eligiblePool : 0;
  return {
    totalMembers: members.length,
    unpairedCount,
    activePairingCount,
    completedPairingCount,
    pairingCoverage,
  };
}

export function pairingStatusLabel(status: OnboardingBuddyPairing["status"]): string {
  if (status === "active") return "Active";
  if (status === "completed") return "Completed";
  return "Cancelled";
}
