/**
 * FRC sponsor pipeline CRM — pure helpers for stage board, goal vs actual,
 * and thank-you / renewal reminder nudges. Org isolation is enforced by RLS
 * at the data layer; these functions never mix teams' data.
 */

export const SPONSOR_PIPELINE_STAGES = [
  "prospect",
  "ask",
  "visit",
  "pledged",
  "active",
  "renewal",
] as const;

export type SponsorPipelineStage = (typeof SPONSOR_PIPELINE_STAGES)[number];

export const PIPELINE_STAGE_LABELS: Record<SponsorPipelineStage, string> = {
  prospect: "Prospect",
  ask: "Ask",
  visit: "Visit",
  pledged: "Pledged",
  active: "Active",
  renewal: "Renewal",
};

export type PipelineSponsor = {
  id: string;
  name: string;
  pipelineStage: SponsorPipelineStage;
  status: string;
  askCents: number;
  pledgedCents: number;
  seasonCents: number;
  seasonCashCents: number;
  thankYouDueOn: string | null;
  renewalDueOn: string | null;
  nextFollowUpOn: string | null;
  lastContactOn: string | null;
  thankYouSentAt?: string | null;
};

export type SponsorReminderKind = "thank_you" | "renewal" | "follow_up";

export type SponsorReminder = {
  sponsorId: string;
  sponsorName: string;
  kind: SponsorReminderKind;
  dueOn: string;
  message: string;
};

export type PipelineStageSummary = {
  stage: SponsorPipelineStage;
  count: number;
  askCents: number;
  pledgedCents: number;
  /** Best available stage value: pledged, else ask (never invented). */
  valueCents: number;
};

export function isPipelineStage(value: unknown): value is SponsorPipelineStage {
  return typeof value === "string" && (SPONSOR_PIPELINE_STAGES as readonly string[]).includes(value);
}

export function pipelineStageLabel(stage: SponsorPipelineStage): string {
  return PIPELINE_STAGE_LABELS[stage];
}

export function mapLegacyStatusToPipelineStage(status: string): SponsorPipelineStage {
  if (status === "active") return "active";
  if (status === "lapsed") return "renewal";
  return "prospect";
}

export function nextPipelineStage(stage: SponsorPipelineStage): SponsorPipelineStage | null {
  const index = SPONSOR_PIPELINE_STAGES.indexOf(stage);
  if (index < 0 || index >= SPONSOR_PIPELINE_STAGES.length - 1) return null;
  return SPONSOR_PIPELINE_STAGES[index + 1]!;
}

export function previousPipelineStage(stage: SponsorPipelineStage): SponsorPipelineStage | null {
  const index = SPONSOR_PIPELINE_STAGES.indexOf(stage);
  if (index <= 0) return null;
  return SPONSOR_PIPELINE_STAGES[index - 1]!;
}

/** Synced relationship status when advancing the CRM stage. */
export function statusForPipelineStage(stage: SponsorPipelineStage): "prospect" | "active" | "lapsed" {
  if (stage === "active") return "active";
  if (stage === "renewal") return "lapsed";
  return "prospect";
}

export function groupSponsorsByStage<T extends { pipelineStage: SponsorPipelineStage; status: string }>(
  sponsors: T[],
): Record<SponsorPipelineStage, T[]> {
  const groups = Object.fromEntries(SPONSOR_PIPELINE_STAGES.map((stage) => [stage, [] as T[]])) as Record<
    SponsorPipelineStage,
    T[]
  >;
  for (const sponsor of sponsors) {
    if (sponsor.status === "declined") continue;
    const stage = isPipelineStage(sponsor.pipelineStage) ? sponsor.pipelineStage : "prospect";
    groups[stage].push(sponsor);
  }
  return groups;
}

/** Org-local stage board totals for glanceable pipeline viz. */
export function summarizePipelineStages(
  sponsors: Array<Pick<PipelineSponsor, "pipelineStage" | "status" | "askCents" | "pledgedCents">>,
): PipelineStageSummary[] {
  const groups = groupSponsorsByStage(sponsors);
  return SPONSOR_PIPELINE_STAGES.map((stage) => {
    const rows = groups[stage];
    const askCents = rows.reduce((sum, s) => sum + Math.max(0, s.askCents), 0);
    const pledgedCents = rows.reduce((sum, s) => sum + Math.max(0, s.pledgedCents), 0);
    return {
      stage,
      count: rows.length,
      askCents,
      pledgedCents,
      valueCents: pledgedCents > 0 ? pledgedCents : askCents,
    };
  });
}

export function summarizeFundraisingProgress(input: {
  fundraisingGoalCents: number;
  sponsors: Array<
    Pick<PipelineSponsor, "seasonCashCents" | "pledgedCents" | "askCents" | "pipelineStage" | "status">
  >;
  grantIncomeCents?: number;
}) {
  const actualCashCents = input.sponsors.reduce((sum, s) => sum + Math.max(0, s.seasonCashCents), 0);
  const pledgedPipelineCents = input.sponsors
    .filter((s) => s.pipelineStage === "pledged" || s.pipelineStage === "active" || s.pipelineStage === "renewal")
    .reduce((sum, s) => sum + Math.max(0, s.pledgedCents), 0);
  const grantIncomeCents = Math.max(0, input.grantIncomeCents ?? 0);
  const actualCents = actualCashCents + grantIncomeCents;
  const goalCents = Math.max(0, input.fundraisingGoalCents);
  const remainingCents = Math.max(0, goalCents - actualCents);
  const percentOfGoal = goalCents <= 0 ? 0 : Math.min(100, Math.round((actualCents / goalCents) * 100));
  const stages = summarizePipelineStages(input.sponsors);

  return {
    goalCents,
    actualCashCents,
    grantIncomeCents,
    actualCents,
    pledgedPipelineCents,
    remainingCents,
    percentOfGoal,
    stages,
  };
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDay(value: string): number {
  return new Date(`${value}T12:00:00Z`).getTime();
}

/**
 * Auto-generated CRM nudges: overdue thank-yous, renewal windows, and follow-ups.
 * Never fabricates amounts — only dates and relationship state already on the record.
 */
export function buildSponsorReminders(sponsors: PipelineSponsor[], now = new Date()): SponsorReminder[] {
  const today = isoDate(now);
  const todayMs = parseDay(today);
  const reminders: SponsorReminder[] = [];

  for (const sponsor of sponsors) {
    if (sponsor.status === "declined") continue;

    if (sponsor.thankYouDueOn && parseDay(sponsor.thankYouDueOn) <= todayMs && !sponsor.thankYouSentAt) {
      reminders.push({
        sponsorId: sponsor.id,
        sponsorName: sponsor.name,
        kind: "thank_you",
        dueOn: sponsor.thankYouDueOn,
        message: `Send a thank-you to ${sponsor.name}`,
      });
    }

    if (
      sponsor.renewalDueOn &&
      parseDay(sponsor.renewalDueOn) <= todayMs &&
      (sponsor.pipelineStage === "active" || sponsor.pipelineStage === "renewal")
    ) {
      reminders.push({
        sponsorId: sponsor.id,
        sponsorName: sponsor.name,
        kind: "renewal",
        dueOn: sponsor.renewalDueOn,
        message: `Start renewal outreach with ${sponsor.name}`,
      });
    }

    if (sponsor.nextFollowUpOn && parseDay(sponsor.nextFollowUpOn) <= todayMs) {
      reminders.push({
        sponsorId: sponsor.id,
        sponsorName: sponsor.name,
        kind: "follow_up",
        dueOn: sponsor.nextFollowUpOn,
        message: `Follow up with ${sponsor.name}`,
      });
    }
  }

  return reminders.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.sponsorName.localeCompare(b.sponsorName));
}

/** Default thank-you due date: 7 days after a contribution is received. */
export function defaultThankYouDueOn(receivedOn: string): string {
  const base = new Date(`${receivedOn}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + 7);
  return isoDate(base);
}

/** Default renewal window: Oct 1 of the next calendar season year. */
export function defaultRenewalDueOn(seasonYear: number): string {
  return `${seasonYear}-10-01`;
}
