import {
  PIPELINE_STAGE_LABELS,
  SPONSOR_PIPELINE_STAGES,
  type SponsorPipelineStage,
  type SponsorReminder,
} from "./sponsor-pipeline";

export const PURCHASE_STATUSES = ["submitted", "approved", "ordered", "received", "rejected"] as const;
export const SPONSOR_STATUSES = ["prospect", "active", "lapsed", "declined"] as const;
export { PIPELINE_STAGE_LABELS, SPONSOR_PIPELINE_STAGES };
export type { SponsorPipelineStage, SponsorReminder };
export const GRANT_STATUSES = ["researching", "drafting", "review", "submitted", "awarded", "declined"] as const;
export const DRAFT_TYPES = ["sponsor_email", "grant_narrative", "thank_you", "renewal"] as const;

export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export type SponsorStatus = (typeof SPONSOR_STATUSES)[number];
export type GrantStatus = (typeof GRANT_STATUSES)[number];
export type DraftType = (typeof DRAFT_TYPES)[number];

export type BudgetCategory = {
  id: string;
  name: string;
  allocatedCents: number;
};

export type PurchaseRequest = {
  id: string;
  itemName: string;
  vendor: string;
  itemUrl: string | null;
  categoryId: string | null;
  categoryName: string | null;
  quantity: number;
  unitPriceCents: number;
  shippingCents: number;
  totalCents: number;
  purpose: string;
  status: PurchaseStatus;
  requestedByName: string;
  requestedAt: string;
  neededBy: string | null;
  orderedOn: string | null;
};

export type Sponsor = {
  id: string;
  name: string;
  status: SponsorStatus;
  pipelineStage: SponsorPipelineStage;
  tier: string | null;
  website: string | null;
  industry: string | null;
  contactName: string | null;
  contactEmail: string | null;
  relationshipOwner: string | null;
  lastContactOn: string | null;
  nextFollowUpOn: string | null;
  notes: string | null;
  askCents: number;
  pledgedCents: number;
  thankYouDueOn: string | null;
  renewalDueOn: string | null;
  lifetimeCents: number;
  seasonCents: number;
  seasonCashCents: number;
};

export type FundraisingProgress = {
  goalCents: number;
  actualCashCents: number;
  grantIncomeCents: number;
  actualCents: number;
  pledgedPipelineCents: number;
  remainingCents: number;
  percentOfGoal: number;
  stages: Array<{
    stage: SponsorPipelineStage;
    count: number;
    askCents: number;
    pledgedCents: number;
    valueCents: number;
  }>;
};

export type SponsorInteraction = {
  id: string;
  sponsorId: string;
  sponsorName: string;
  interactionType: string;
  occurredOn: string;
  summary: string;
  nextStep: string | null;
  nextFollowUpOn: string | null;
  loggedByName: string;
};

export type SponsorProspect = {
  id: string;
  name: string;
  website: string;
  summary: string;
  sourceTitle: string;
  sourceQuery: string;
  fitScore: number;
  fitReason: string;
  status: "new" | "saved" | "dismissed";
};

export type GrantApplication = {
  id: string;
  funder: string;
  title: string;
  sourceUrl: string | null;
  deadline: string | null;
  status: GrantStatus;
  requestedCents: number;
  awardedCents: number;
  purpose: string;
  eligibility: string | null;
  requirements: string | null;
  ownerName: string | null;
  updatedAt: string;
};

export type AwardRecord = {
  id: string;
  seasonYear: number;
  awardName: string;
  eventName: string | null;
  awardLevel: string | null;
  story: string | null;
  sourceUrl: string | null;
};

export type WritingDraft = {
  id: string;
  documentType: DraftType;
  title: string;
  audience: string;
  goal: string;
  body: string;
  evidence: Array<{ label: string; value: string; source: string }>;
  status: "draft" | "approved" | "sent";
  createdAt: string;
};

/** Open purchase-order pulse for Business overview (+ optional finance-AI). */
export type OrdersPulse = {
  pendingCount: number;
  readyToBuyCount: number;
  openTotalCents: number;
  financeAiEnabled: boolean;
  aiHeadline: string | null;
  aiRecommendations: string[];
};

export type BusinessView = {
  status: "live";
  orgId: string;
  orgName: string;
  teamNumber: number | null;
  role: string;
  canManageFinance: boolean;
  seasonYear: number;
  seasons: number[];
  teamAffiliation?: "private_school" | "public_school" | "community" | null;
  schoolFunded?: boolean | null;
  outsideGrants?: boolean | null;
  sponsorsAllowed?: boolean | null;
  budget: {
    totalBudgetCents: number;
    fundraisingGoalCents: number;
    sponsorIncomeCents: number;
    grantIncomeCents: number;
    requestedCents: number;
    committedCents: number;
    spentCents: number;
    remainingCents: number;
    monthlySpend: Array<{ month: string; cents: number }>;
  };
  impact: { activities: number; hours: number; peopleReached: number };
  categories: BudgetCategory[];
  purchases: PurchaseRequest[];
  ordersPulse?: OrdersPulse;
  sponsors: Sponsor[];
  fundraisingProgress: FundraisingProgress;
  sponsorReminders: SponsorReminder[];
  interactions: SponsorInteraction[];
  prospects: SponsorProspect[];
  grants: GrantApplication[];
  awards: AwardRecord[];
  drafts: WritingDraft[];
};

export type BusinessSetupView = {
  status: "setup_required";
  message: string;
  orgId: null;
  seasonYear: number;
};

export type BusinessPortalView = BusinessView | BusinessSetupView;

export function isBusinessPortalView(value: unknown): value is BusinessPortalView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "live" || status === "setup_required";
}

export function purchaseTotal(input: Pick<PurchaseRequest, "quantity" | "unitPriceCents" | "shippingCents">): number {
  return Math.max(0, Math.round(input.quantity)) * Math.max(0, Math.round(input.unitPriceCents)) + Math.max(0, Math.round(input.shippingCents));
}

export function summarizeBudget(input: {
  totalBudgetCents: number;
  purchases: Array<Pick<PurchaseRequest, "status" | "totalCents">>;
  sponsorIncomeCents: number;
  grantIncomeCents: number;
}) {
  const requestedCents = input.purchases
    .filter((purchase) => purchase.status === "submitted")
    .reduce((total, purchase) => total + purchase.totalCents, 0);
  const committedCents = input.purchases
    .filter((purchase) => ["approved", "ordered", "received"].includes(purchase.status))
    .reduce((total, purchase) => total + purchase.totalCents, 0);
  const spentCents = input.purchases
    .filter((purchase) => ["ordered", "received"].includes(purchase.status))
    .reduce((total, purchase) => total + purchase.totalCents, 0);
  return {
    requestedCents,
    committedCents,
    spentCents,
    remainingCents: input.totalBudgetCents + input.sponsorIncomeCents + input.grantIncomeCents - committedCents,
  };
}

export function sponsorHealth(sponsor: Pick<Sponsor, "status" | "lastContactOn" | "nextFollowUpOn">, now = new Date()): "healthy" | "due" | "cold" {
  if (sponsor.nextFollowUpOn && new Date(`${sponsor.nextFollowUpOn}T23:59:59Z`).getTime() < now.getTime()) return "due";
  if (!sponsor.lastContactOn) return sponsor.status === "prospect" ? "due" : "cold";
  const days = Math.floor((now.getTime() - new Date(`${sponsor.lastContactOn}T00:00:00Z`).getTime()) / 86_400_000);
  return days > 120 ? "cold" : "healthy";
}

export function rankSponsorFit(input: { text: string; industries: string[]; teamNumber: number | null }): { score: number; reason: string } {
  const haystack = input.text.toLowerCase();
  const roboticsTerms = ["robotics", "stem", "engineering", "manufacturing", "education", "youth", "technology"];
  const matched = roboticsTerms.filter((term) => haystack.includes(term));
  const industryMatch = input.industries.find((industry) => industry && haystack.includes(industry.toLowerCase()));
  const score = Math.min(100, 35 + matched.length * 8 + (industryMatch ? 15 : 0) + (input.teamNumber ? 5 : 0));
  const reason = [
    matched.length ? `Matches ${matched.slice(0, 3).join(", ")}` : "Potential local-community fit",
    industryMatch ? `similar to an existing ${industryMatch} relationship` : null,
  ].filter(Boolean).join("; ");
  return { score, reason };
}

export function generateEvidenceDraft(input: {
  type: DraftType;
  teamName: string;
  teamNumber: number | null;
  audience: string;
  goal: string;
  sponsorName?: string | null;
  seasonYear: number;
  impact: BusinessView["impact"];
  awards: AwardRecord[];
  sponsorIncomeCents: number;
}): { title: string; body: string; evidence: WritingDraft["evidence"] } {
  const team = input.teamNumber ? `${input.teamName} (FRC Team ${input.teamNumber})` : input.teamName;
  const evidence: WritingDraft["evidence"] = [];
  const facts: string[] = [];
  if (input.impact.activities > 0) {
    facts.push(`During the ${input.seasonYear} season, our students recorded ${input.impact.activities} community activities, ${input.impact.hours} service hours, and ${input.impact.peopleReached.toLocaleString()} people reached.`);
    evidence.push({ label: "Impact", value: `${input.impact.activities} activities · ${input.impact.hours} hours · ${input.impact.peopleReached.toLocaleString()} people`, source: "Impact log" });
  }
  const recentAwards = input.awards.slice(0, 3);
  if (recentAwards.length) {
    facts.push(`Our recorded achievements include ${recentAwards.map((award) => `${award.awardName}${award.eventName ? ` at ${award.eventName}` : ""} (${award.seasonYear})`).join(", ")}.`);
    recentAwards.forEach((award) => evidence.push({ label: award.awardName, value: `${award.eventName ?? "Team record"}, ${award.seasonYear}`, source: award.sourceUrl ?? "Awards log" }));
  }
  const evidenceParagraph = facts.length
    ? facts.join(" ")
    : "We are still assembling our verified impact and award record; any final application will be reviewed before submission.";
  const recipient = input.sponsorName?.trim() || input.audience.trim() || "community partner";
  const ask = input.goal.trim() || "support our students' robotics season";
  const opening = input.type === "thank_you"
    ? `Thank you for investing in ${team}. Your partnership gives students meaningful opportunities to design, build, lead, and serve.`
    : input.type === "renewal"
      ? `We would be honored to renew ${recipient}'s partnership with ${team} for the ${input.seasonYear} season.`
      : input.type === "grant_narrative"
        ? `${team} is a student-led robotics program seeking support to ${ask}.`
        : `I am writing on behalf of ${team} to explore a partnership with ${recipient} that would help us ${ask}.`;
  const close = input.type === "thank_you"
    ? "We look forward to sharing what your support makes possible and keeping you connected to the students throughout the season."
    : "We would welcome a short conversation about fit, recognition, and the outcomes your support can make possible. Every claim in this draft is tied to the team records listed with it and should be reviewed before sending.";
  return {
    title: `${input.type === "grant_narrative" ? "Grant narrative" : input.type === "thank_you" ? "Sponsor thank-you" : input.type === "renewal" ? "Partnership renewal" : "Sponsorship introduction"}: ${recipient}`,
    body: `${opening}\n\n${evidenceParagraph}\n\n${close}`,
    evidence,
  };
}
