import type { ContextSource } from "@vantage/agent";
import { composeGrantAnswer, grantFocusLabel } from "../writer/compose";
import type { GrantFocus, WriterProfile } from "../writer/types";
import { provenanceFromEvidence } from "./load-evidence";
import type { GrantOrgEvidence, GrantProvenanceItem } from "./types";

export const GRANT_AI_MODEL = "vantage-grant-assist-v1";
export const GRANT_USAGE_TAG = "writer.grant_draft";

export type GrantAssistInput = {
  profile: WriterProfile;
  evidence: GrantOrgEvidence;
  prompt: string;
  charLimit: number | null;
  focus: GrantFocus;
};

export type BuiltGrantAssist = {
  message: string;
  sources: ContextSource[];
  localBody: string;
  provenance: GrantProvenanceItem[];
};

function teamHandle(profile: WriterProfile): string {
  const num = profile.teamNumber ? ` (FRC Team ${profile.teamNumber})` : "";
  return `${profile.teamName || "our team"}${num}`;
}

function evidenceParagraph(evidence: GrantOrgEvidence): string {
  const parts: string[] = [];
  if (evidence.impact.activities > 0) {
    parts.push(
      `During the ${evidence.seasonYear} season, our students recorded ${evidence.impact.activities} community activities, ${evidence.communityHours} community service hours, and reached ${evidence.impact.peopleReached.toLocaleString()} people.`,
    );
  } else if (evidence.communityHours > 0) {
    parts.push(`Our students have logged ${evidence.communityHours} community service hours this season.`);
  }
  const goals = evidence.seasonGoals.slice(0, 4);
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
  const awards = evidence.awards.slice(0, 3);
  if (awards.length) {
    parts.push(
      `Recorded achievements include ${awards
        .map((a) => `${a.awardName}${a.eventName ? ` at ${a.eventName}` : ""} (${a.seasonYear})`)
        .join(", ")}.`,
    );
  }
  return parts.join(" ");
}

export function buildLocalGrantAssistDraft(input: GrantAssistInput): string {
  if (!input.evidence.orgId) throw new Error("Organization scope mismatch");
  const base = composeGrantAnswer(input.profile, {
    prompt: input.prompt,
    charLimit: null,
    focus: input.focus,
  });
  const evidence = evidenceParagraph(input.evidence);
  let body = [base, evidence].filter(Boolean).join("\n\n");
  if (input.charLimit && input.charLimit > 0 && body.length > input.charLimit) {
    const slice = body.slice(0, Math.max(0, input.charLimit - 1)).trimEnd();
    body = `${slice}…\n\n[Trimmed to ${input.charLimit} characters — tighten wording to fit.]`;
  }
  return body;
}

export function buildGrantAssistSources(input: GrantAssistInput): ContextSource[] {
  const { profile, evidence, prompt, charLimit, focus } = input;
  return [
    {
      type: "module_data",
      id: `grant-profile:${evidence.orgId}:${evidence.seasonYear}`,
      content: JSON.stringify({
        orgId: evidence.orgId,
        seasonYear: evidence.seasonYear,
        teamName: profile.teamName,
        teamNumber: profile.teamNumber,
        region: profile.region,
        mission: profile.mission,
        achievements: profile.achievements.slice(0, 12),
        fundingNeed: profile.fundingNeed,
        fundingAskUsd: profile.fundingAskUsd,
      }),
      importance: 1,
      classification: "hard_metric",
    },
    {
      type: "module_data",
      id: `grant-evidence:${evidence.orgId}:${evidence.seasonYear}`,
      content: JSON.stringify({
        orgId: evidence.orgId,
        seasonYear: evidence.seasonYear,
        impact: evidence.impact,
        communityHours: evidence.communityHours,
        seasonGoals: evidence.seasonGoals.slice(0, 12),
        awards: evidence.awards.slice(0, 8),
      }),
      importance: 0.98,
      classification: "hard_metric",
    },
    {
      type: "module_data",
      id: `grant-prompt:${evidence.orgId}`,
      content: JSON.stringify({ prompt: prompt.slice(0, 2000), charLimit, focus }),
      importance: 0.9,
      classification: "model_inference",
    },
  ];
}

export function buildGrantAssistMessage(input: GrantAssistInput): string {
  const handle = teamHandle(input.profile);
  const focus = grantFocusLabel(input.focus);
  const limit = input.charLimit ? ` Character limit: ${input.charLimit}.` : "";
  const prompt = input.prompt.trim() || "(no specific prompt)";
  return [
    `Draft a grant application answer for ${handle} using ONLY the your team's impact metrics, community hours, season goals, and awards in context.`,
    `Focus: ${focus}.${limit}`,
    `Grant prompt: ${prompt}`,
    "Do not invent metrics, hours, goals, awards, or other teams' data. If a fact is missing, omit it rather than fabricate it.",
    "Return plain text suitable for a grant application answer (no email subject line).",
  ].join("\n");
}

export function buildGrantAssistBundle(input: GrantAssistInput): BuiltGrantAssist {
  if (input.evidence.orgId.trim() === "") throw new Error("Organization scope mismatch");
  const localBody = buildLocalGrantAssistDraft(input);
  return {
    message: buildGrantAssistMessage(input),
    sources: buildGrantAssistSources(input),
    localBody,
    provenance: provenanceFromEvidence(input.evidence),
  };
}

export function parseGrantAssistResponse(
  text: string,
  fallbackBody: string,
): { body: string; source: "ai" | "template" } {
  const trimmed = text.trim();
  if (!trimmed || trimmed === "No response." || trimmed.length < 80) {
    return { body: fallbackBody, source: "template" };
  }
  return { body: trimmed.slice(0, 20_000), source: "ai" };
}
