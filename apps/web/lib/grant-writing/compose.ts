import type { GrantOrgEvidence, GrantProvenanceItem } from "../grant-assist/types";
import { provenanceFromEvidence } from "../grant-assist/load-evidence";
import { grantTemplateByKey } from "./templates";
import type { GrantTemplateKey, GuidedFields } from "./types";

export type ComposeGrantNarrativeInput = {
  templateKey: GrantTemplateKey;
  funderName?: string | null;
  askAmountUsd?: number | null;
  fields: GuidedFields;
  ctx: GrantOrgEvidence;
};

export type ComposeGrantNarrativeResult = {
  body: string;
  provenance: GrantProvenanceItem[];
};

export type ValidateGuidedFieldsResult = { ok: true } | { ok: false; error: string };

function trim(value: string): string {
  return value.trim();
}

function hasContent(fields: GuidedFields): boolean {
  return Boolean(trim(fields.need) || trim(fields.impact) || trim(fields.budget) || trim(fields.timeline));
}

export function validateGuidedFields(fields: GuidedFields): ValidateGuidedFieldsResult {
  if (!hasContent(fields)) {
    return { ok: false, error: "Enter at least one of need, impact, budget, or timeline." };
  }
  return { ok: true };
}

function teamHandle(ctx: GrantOrgEvidence): string {
  const team = ctx.teamNumber ? `FRC Team ${ctx.teamNumber}` : ctx.orgName;
  if (ctx.location) return `${team}, based in ${ctx.location}`;
  return team;
}

function formatAsk(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return null;
  return `$${Math.round(amount).toLocaleString()}`;
}

function provenanceForCompose(ctx: GrantOrgEvidence): GrantProvenanceItem[] {
  const items = provenanceFromEvidence(ctx);
  if (ctx.description?.trim()) {
    items.unshift({
      label: "Team description",
      value: ctx.description.trim(),
      source: "Org onboarding profile (this org)",
      kind: "org",
    });
  }
  return items;
}

function section(title: string, text: string): string | null {
  const body = trim(text);
  if (!body) return null;
  return `${title}\n${body}`;
}

export function composeGrantNarrative(input: ComposeGrantNarrativeInput): ComposeGrantNarrativeResult {
  const template = grantTemplateByKey(input.templateKey);
  const ctx = input.ctx;
  const handle = teamHandle(ctx);
  const funder = trim(input.funderName ?? "");
  const ask = formatAsk(input.askAmountUsd ?? null);
  const paragraphs: string[] = [];

  if (funder) {
    paragraphs.push(
      ask
        ? `Dear ${funder},\n\nWe respectfully request ${ask} to support ${handle}.`
        : `Dear ${funder},\n\nWe respectfully request support for ${handle}.`,
    );
  } else {
    paragraphs.push(
      ask ? `We respectfully request ${ask} to support ${handle}.` : `This narrative supports ${handle}.`,
    );
  }

  if (ctx.description?.trim()) {
    paragraphs.push(ctx.description.trim());
  }

  paragraphs.push(
    `${handle} competes in FIRST Robotics Competition and uses guided grant fields to explain our ${template.label.toLowerCase()} request.`,
  );

  const sections = [
    section(template.headings.need, input.fields.need),
    section(template.headings.impact, input.fields.impact),
    section(template.headings.budget, input.fields.budget),
    section(template.headings.timeline, input.fields.timeline),
  ].filter((value): value is string => Boolean(value));

  if (ctx.impact.activities > 0) {
    paragraphs.push(
      `Documented community impact for this organization: ${ctx.impact.activities} activities, ${ctx.communityHours} community service hours, and ${ctx.impact.peopleReached.toLocaleString()} people reached.`,
    );
  } else if (ctx.communityHours > 0) {
    paragraphs.push(
      `Documented community service hours for this organization: ${ctx.communityHours}.`,
    );
  }

  const goals = ctx.seasonGoals.slice(0, 4);
  if (goals.length) {
    paragraphs.push(
      `Season goals we are tracking: ${goals
        .map((goal) => {
          const unit = goal.unit ? ` ${goal.unit}` : "";
          return `${goal.title} (${goal.currentValue}${unit}/${goal.targetValue}${unit})`;
        })
        .join("; ")}.`,
    );
  }

  paragraphs.push(...sections);

  if (ctx.awards.length > 0) {
    const award = ctx.awards[0]!;
    paragraphs.push(`Recent recognition: ${award.awardName}${award.eventName ? ` at ${award.eventName}` : ""}.`);
  }

  paragraphs.push("Thank you for considering our request.");

  return {
    body: paragraphs.join("\n\n"),
    provenance: provenanceForCompose(ctx),
  };
}
