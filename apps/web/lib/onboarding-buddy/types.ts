// Onboarding Buddy domain types. Pure data shapes — no I/O, no framework imports.
// Pairs a recently-joined member with a tenured buddy and tracks a deterministic
// first-week plan (checklist) generated for that pairing.

export type OnboardingBuddyPairingStatus = "active" | "completed" | "cancelled";

export type OnboardingBuddyMember = {
  userId: string;
  name: string;
  role: string;
  joinedAt: string;
  tenureDays: number;
};

export type OnboardingBuddyPlanItem = {
  id: string;
  pairingId: string;
  dayOffset: number;
  sequence: number;
  title: string;
  description: string | null;
  done: boolean;
  doneAt: string | null;
};

export type OnboardingBuddyPairing = {
  id: string;
  newMemberId: string;
  newMemberName: string;
  buddyId: string;
  buddyName: string;
  status: OnboardingBuddyPairingStatus;
  notes: string | null;
  pairedAt: string;
  completedAt: string | null;
  planItems: OnboardingBuddyPlanItem[];
  planProgress: { total: number; done: number };
};

export type OnboardingBuddySummary = {
  totalMembers: number;
  unpairedCount: number;
  activePairingCount: number;
  completedPairingCount: number;
  /** 0..1 share of eligible new members who currently have an active buddy pairing. */
  pairingCoverage: number;
};
