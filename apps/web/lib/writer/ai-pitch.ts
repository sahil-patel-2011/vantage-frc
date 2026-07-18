// Org-scoped sponsor-pitch builders for the metered FRC Assistant path.
// Pure / framework-free: context sources and local fallback text are derived only
// from the caller-supplied team profile + business facts for THIS org — never
// other organizations. The API layer loads those facts under withRls and meters
// usage through AIOrchestrator → meteredAI.

import type { ContextSource } from "@vantage/agent";
import {
  composeGrantAnswer,
  composeSponsorEmail,
  emailKindLabel,
  grantFocusLabel,
  usd,
} from "./compose";
import type {
  DraftKind,
  EmailKind,
  GrantInput,
  SponsorInput,
  WriterProfile,
} from "./types";

export const WRITER_AI_MODEL = "vantage-writer-pitch-v1";
export const WRITER_USAGE_TAG = "writer.sponsor_pitch";

export type PitchSeasonGoal = {
  title: string;
  category: string;
  currentValue: number;
  targetValue: number;
  unit: string | null;
  progress: number;
};

export type PitchBusinessFacts = {
  /** Must match the RLS org; used only for provenance labeling, never cross-joined. */
  orgId: string;
  seasonYear: number;
  impact: { activities: number; hours: number; peopleReached: number } | null;
  /** Community / outreach service hours for this org (from impact log). */
  communityHours: number | null;
  /** Season goals for this org only. */
  seasonGoals: PitchSeasonGoal[];
  awards: Array<{ awardName: string; eventName: string | null; seasonYear: number }>;
  fundraisingGoalUsd: number | null;
  seasonSponsorIncomeUsd: number | null;
  activeSponsorCount: number;
};

export type PitchDraftInput = {
  kind: DraftKind;
  profile: WriterProfile;
  sponsor: SponsorInput;
  grant: GrantInput | null;
  business: PitchBusinessFacts;
};

export type BuiltPitch = {
  message: string;
  sources: ContextSource[];
  localSubject: string | null;
  localBody: string;
};

function teamHandle(profile: WriterProfile): string {
  const num = profile.teamNumber ? ` (FRC Team ${profile.teamNumber})` : "";
  return `${profile.teamName || "our team"}${num}`;
}

function isEmailKind(kind: DraftKind): kind is EmailKind {
  return kind !== "grant";
}

/** Build bounded, provenance-labeled sources from THIS org's profile + business data only. */
export function buildPitchContextSources(input: PitchDraftInput): ContextSource[] {
  const { profile, business, sponsor, grant, kind } = input;
  const sources: ContextSource[] = [
    {
      type: "module_data",
      id: `writer-profile:${business.orgId}:${business.seasonYear}`,
      content: JSON.stringify({
        orgId: business.orgId,
        seasonYear: business.seasonYear,
        teamName: profile.teamName,
        teamNumber: profile.teamNumber,
        region: profile.region,
        mission: profile.mission,
        achievements: profile.achievements.slice(0, 12),
        fundingNeed: profile.fundingNeed,
        fundingAskUsd: profile.fundingAskUsd,
        tone: profile.tone,
      }),
      importance: 1,
      classification: "hard_metric",
    },
    {
      type: "module_data",
      id: `writer-business:${business.orgId}:${business.seasonYear}`,
      content: JSON.stringify({
        orgId: business.orgId,
        seasonYear: business.seasonYear,
        impact: business.impact,
        communityHours: business.communityHours,
        seasonGoals: business.seasonGoals.slice(0, 12),
        awards: business.awards.slice(0, 8),
        fundraisingGoalUsd: business.fundraisingGoalUsd,
        seasonSponsorIncomeUsd: business.seasonSponsorIncomeUsd,
        activeSponsorCount: business.activeSponsorCount,
      }),
      importance: 0.95,
      classification: "hard_metric",
    },
  ];

  if (isEmailKind(kind)) {
    sources.push({
      type: "module_data",
      id: `writer-target:${business.orgId}`,
      content: JSON.stringify({
        orgId: business.orgId,
        kind,
        sponsorName: sponsor.sponsorName,
        contactName: sponsor.contactName,
        tier: sponsor.tier,
        askAmountUsd: sponsor.askAmountUsd,
        priorAmountUsd: sponsor.priorAmountUsd,
        senderName: sponsor.senderName,
        senderRole: sponsor.senderRole,
      }),
      importance: 0.9,
      classification: "model_inference",
    });
  } else if (grant) {
    sources.push({
      type: "module_data",
      id: `writer-grant:${business.orgId}`,
      content: JSON.stringify({
        orgId: business.orgId,
        kind: "grant",
        prompt: grant.prompt.slice(0, 2000),
        charLimit: grant.charLimit,
        focus: grant.focus,
      }),
      importance: 0.9,
      classification: "model_inference",
    });
  }

  return sources;
}

function businessEvidenceParagraph(business: PitchBusinessFacts): string {
  const parts: string[] = [];
  if (business.impact && business.impact.activities > 0) {
    parts.push(
      `This season our students logged ${business.impact.activities} community activities, ${business.impact.hours} service hours, and reached ${business.impact.peopleReached.toLocaleString()} people.`,
    );
  } else if (business.communityHours != null && business.communityHours > 0) {
    parts.push(`Our students have logged ${business.communityHours} community service hours this season.`);
  }
  const goals = business.seasonGoals.slice(0, 4);
  if (goals.length) {
    parts.push(
      `Season goals we are tracking include ${goals
        .map((g) => {
          const unit = g.unit ? ` ${g.unit}` : "";
          return `${g.title} (${g.currentValue}${unit}/${g.targetValue}${unit})`;
        })
        .join("; ")}.`,
    );
  }
  const awards = business.awards.slice(0, 3);
  if (awards.length) {
    parts.push(
      `Recorded achievements include ${awards
        .map((a) => `${a.awardName}${a.eventName ? ` at ${a.eventName}` : ""} (${a.seasonYear})`)
        .join(", ")}.`,
    );
  }
  if (business.fundraisingGoalUsd != null && business.fundraisingGoalUsd > 0) {
    const raised =
      business.seasonSponsorIncomeUsd != null
        ? ` We have raised ${usd(business.seasonSponsorIncomeUsd)} toward a ${usd(business.fundraisingGoalUsd)} goal.`
        : ` Our fundraising goal is ${usd(business.fundraisingGoalUsd)}.`;
    parts.push(raised.trim());
  }
  return parts.join(" ");
}

export function buildPitchMessage(input: PitchDraftInput): string {
  const handle = teamHandle(input.profile);
  if (input.kind === "grant") {
    const focus = input.grant ? grantFocusLabel(input.grant.focus) : "General";
    const prompt = input.grant?.prompt?.trim() || "(no specific prompt)";
    const limit = input.grant?.charLimit ? ` Character limit: ${input.grant.charLimit}.` : "";
    return [
      `Draft a grant-answer pitch for ${handle} using ONLY the org-scoped team profile and business facts in context.`,
      `Focus: ${focus}.${limit}`,
      `Grant prompt: ${prompt}`,
      "Do not invent metrics, awards, or other teams' data. If a fact is missing, omit it rather than fabricate it.",
      "Return plain text suitable for a grant application answer (no email subject line).",
    ].join("\n");
  }

  const label = emailKindLabel(input.kind);
  return [
    `Draft a ${label.toLowerCase()} sponsor pitch email for ${handle} using ONLY the org-scoped team profile and business facts in context.`,
    `Recipient organization: ${input.sponsor.sponsorName}.`,
    input.sponsor.contactName ? `Contact: ${input.sponsor.contactName}.` : null,
    "Do not invent metrics, awards, or other organizations' data. If a fact is missing, omit it rather than fabricate it.",
    "Format exactly:",
    "SUBJECT: <one line>",
    "BODY:",
    "<email body>",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Deterministic local fallback (zero provider cost) woven from profile + business facts. */
export function buildLocalPitchDraft(input: PitchDraftInput): { subject: string | null; body: string } {
  const evidence = businessEvidenceParagraph(input.business);

  if (input.kind === "grant") {
    const grant = input.grant ?? { prompt: "", charLimit: null, focus: "general" as const };
    let body = composeGrantAnswer(input.profile, grant);
    if (evidence) {
      body = `${body}\n\n${evidence}`;
      if (grant.charLimit && grant.charLimit > 0 && body.length > grant.charLimit) {
        const slice = body.slice(0, Math.max(0, grant.charLimit - 1)).trimEnd();
        body = `${slice}…\n\n[Trimmed to ${grant.charLimit} characters — tighten wording to fit.]`;
      }
    }
    return { subject: null, body };
  }

  const email = composeSponsorEmail(input.kind, input.profile, input.sponsor);
  if (!evidence) return { subject: email.subject, body: email.body };

  // Insert evidence before the sign-off (last paragraph).
  const paras = email.body.split(/\n\n+/);
  if (paras.length >= 2) {
    paras.splice(paras.length - 1, 0, evidence);
  } else {
    paras.push(evidence);
  }
  return { subject: email.subject, body: paras.join("\n\n") };
}

export function buildPitchBundle(input: PitchDraftInput): BuiltPitch {
  const local = buildLocalPitchDraft(input);
  return {
    message: buildPitchMessage(input),
    sources: buildPitchContextSources(input),
    localSubject: local.subject,
    localBody: local.body,
  };
}

/** Parse model output into subject/body; falls back to local draft when unusable. */
export function parseAiPitchResponse(
  text: string,
  fallback: { subject: string | null; body: string },
): { subject: string | null; body: string; source: "ai" | "template" } {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "No response.") {
    return { ...fallback, source: "template" };
  }

  const subjectMatch = trimmed.match(/^\s*SUBJECT:\s*(.+)$/im);
  const bodyMatch = trimmed.match(/\bBODY:\s*([\s\S]+)$/i);
  if (subjectMatch || bodyMatch) {
    const subject = subjectMatch?.[1]?.trim() || fallback.subject;
    const body = (bodyMatch?.[1] ?? trimmed).trim();
    if (body.length < 40) return { ...fallback, source: "template" };
    return { subject, body: body.slice(0, 20_000), source: "ai" };
  }

  // Grant answers (or free-form) — treat whole text as body when substantial.
  if (trimmed.length >= 80) {
    return { subject: fallback.subject, body: trimmed.slice(0, 20_000), source: "ai" };
  }
  return { ...fallback, source: "template" };
}

export function pitchDraftTitle(kind: DraftKind, targetName: string | null): string {
  const label = kind === "grant" ? "Grant answer" : emailKindLabel(kind);
  return targetName ? `${label} — ${targetName}` : label;
}
