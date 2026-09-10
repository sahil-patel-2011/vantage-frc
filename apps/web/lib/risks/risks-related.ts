import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { TeamHubRelatedId } from "../team/team-related";
import type { RiskEvaluation, RiskLevel } from "./types";

/** Focused Soft-UI Team strip when Risk Register is open (never DEMO placeholders). */
export const RISKS_TEAM_RELATED_INCLUDE: TeamHubRelatedId[] = [
  "knowledge",
  "fmea",
  "batteries",
  "todos",
];

/**
 * Soft-UI related surfaces for the season risk register.
 * Distinct from FMEA: proactive L×I season risks vs logged O×S×D failures.
 */
export const RISKS_RELATED_LINKS = [
  { id: "fmea", label: "FMEA", kind: "team" as const, tab: "fmea" },
  { id: "knowledge", label: "Knowledge", kind: "team" as const, tab: "knowledge" },
  { id: "batteries", label: "Batteries", kind: "team" as const, tab: "batteries" },
  { id: "subsystems", label: "Subsystems", kind: "path" as const, path: "/subsystems" },
  { id: "risk-burndown", label: "Risk burndown", kind: "path" as const, path: "/risk-burndown" },
] as const;

export type RisksRelatedId = (typeof RISKS_RELATED_LINKS)[number]["id"];

export type RisksRelatedLink = {
  id: RisksRelatedId;
  label: string;
  href: string;
};

/** Cross-links for Risk Register Soft-UI (never DEMO scores). */
export function risksRelatedLinks(
  orgId?: string | null,
  options?: { active?: RisksRelatedId; include?: RisksRelatedId[] },
): RisksRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return RISKS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type RisksNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Soft-UI next actions for the season risk register.
 * Points at real logging / FMEA / Knowledge — never DEMO L×I scores.
 */
export function risksNextActions(input: {
  orgId?: string | null;
  riskCount: number;
  activeCount: number;
  overdueCount: number;
  highestScore: number;
  topTitle?: string | null;
}): RisksNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Choose your team organization before building the season risk register.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const risksHref = withOrgHref("/risks", orgId);
  const actions: RisksNextAction[] = [];

  if (input.riskCount === 0) {
    actions.push({
      id: "add-first",
      label: "Add the first season risk",
      detail: "Scores stay blank until someone enters a real likelihood × impact — nothing is pre-filled.",
      href: risksHref,
      primary: true,
    });
    actions.push({
      id: "fmea",
      label: "Log failures in FMEA",
      detail: "FMEA tracks things that already broke (O×S×D). Use the register for what could still go wrong.",
      href: hubHref("/team", "fmea", orgId),
    });
    actions.push({
      id: "knowledge",
      label: "Capture mitigations in Knowledge",
      detail: "Wiki handoffs keep owners and countermeasures from staying tribal.",
      href: hubHref("/team", "knowledge", orgId),
    });
    return actions;
  }

  if (input.overdueCount > 0) {
    const sample = input.topTitle?.trim() || "highest open risk";
    actions.push({
      id: "overdue",
      label: `Close overdue mitigations (${input.overdueCount})`,
      detail: `${sample} still has a past-due mitigation — score ${input.highestScore} is from logged L×I only.`,
      href: risksHref,
      primary: true,
    });
  } else if (input.activeCount > 0) {
    actions.push({
      id: "review-top",
      label: input.topTitle ? `Review “${input.topTitle}”` : "Review open risks",
      detail: `${input.activeCount} active · top score ${input.highestScore} from real L×I.`,
      href: risksHref,
      primary: true,
    });
  }

  actions.push({
    id: "fmea",
    label: "Promote broken modes to FMEA",
    detail: "When a register item actually fails on the field or in the pit, log it with O×S×D.",
    href: hubHref("/team", "fmea", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "knowledge",
    label: "Document mitigations in Knowledge",
    detail: "Turn owners and countermeasures into procedures the whole org can reuse.",
    href: hubHref("/team", "knowledge", orgId),
  });

  if (actions.length < 5) {
    actions.push({
      id: "batteries",
      label: "Battery reliability signals",
      detail: "Pack IR/cycle evidence can become a season risk when the failure mode is season-relevant.",
      href: hubHref("/team", "batteries", orgId),
    });
  }

  return actions.slice(0, 5);
}

/** Display L×I score only when at least one active risk exists — never a DEMO 0. */
export function formatRiskScoreDisplay(score: number, hasActive: boolean): string {
  if (!hasActive) return "—";
  return String(score);
}

/** Compact L×I evidence line from real factors only. */
export function formatLikelihoodImpact(input: { likelihood: number; impact: number }): string {
  return `L${input.likelihood} × I${input.impact}`;
}

/** Risk-row meta from a real evaluation — empty fields omitted (no invented text). */
export function formatRiskRegisterMeta(
  evaluation: Pick<RiskEvaluation, "risk" | "score" | "level">,
): string {
  const r = evaluation.risk;
  const parts = [
    r.category,
    formatLikelihoodImpact(r),
    `score ${evaluation.score}`,
    r.owner?.trim() || null,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function riskLevelTone(level: RiskLevel): RiskLevel {
  return level;
}
