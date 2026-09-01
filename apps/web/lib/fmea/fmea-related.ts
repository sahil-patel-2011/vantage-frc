import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { BuildRelatedId } from "../build/build-related";
import type { TeamHubRelatedId } from "../team/team-related";
import type { FmeaEvaluation, FmeaLevel } from "./types";

/** Focused Soft-UI Team strip when FMEA is open (never DEMO placeholders). */
export const FMEA_TEAM_RELATED_INCLUDE: TeamHubRelatedId[] = [
  "knowledge",
  "batteries",
  "messages",
  "practice",
];

/** Focused Soft-UI Build strip when FMEA is open. */
export const FMEA_BUILD_RELATED_INCLUDE: BuildRelatedId[] = [
  "cad",
  "prototype",
  "batteries",
  "kickoff",
];

/** Soft-UI related surfaces for the failure log (Knowledge / CAD / Prototypes). */
export const FMEA_RELATED_LINKS = [
  { id: "knowledge", label: "Knowledge", kind: "team" as const, tab: "knowledge" },
  { id: "cad", label: "CAD", kind: "build" as const, tab: "cad" },
  { id: "prototype", label: "Prototypes", kind: "build" as const, tab: "prototype" },
  { id: "batteries", label: "Batteries", kind: "team" as const, tab: "batteries" },
  { id: "inspection", label: "Inspection", kind: "path" as const, path: "/inspection" },
  { id: "inventory", label: "Inventory", kind: "path" as const, path: "/inventory" },
  { id: "subsystems", label: "Subsystems", kind: "path" as const, path: "/subsystems" },
] as const;

export type FmeaRelatedId = (typeof FMEA_RELATED_LINKS)[number]["id"];

export type FmeaRelatedLink = {
  id: FmeaRelatedId;
  label: string;
  href: string;
};

/** Cross-links for FMEA Soft-UI (never DEMO RPN placeholders). */
export function fmeaRelatedLinks(
  orgId?: string | null,
  options?: { active?: FmeaRelatedId; include?: FmeaRelatedId[] },
): FmeaRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return FMEA_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type FmeaNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Readable Soft-UI next actions for the failure log.
 * Points at real logging / Knowledge / CAD / Prototypes — never DEMO RPN numbers.
 */
export function fmeaNextActions(input: {
  orgId?: string | null;
  failureCount: number;
  activeCount: number;
  needsFixCount: number;
  highestRpn: number;
  topTitle?: string | null;
}): FmeaNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Choose your team organization before logging failures.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: FmeaNextAction[] = [];

  if (input.failureCount === 0) {
    actions.push({
      id: "log-first",
      label: "Log the first failure",
      detail: "RPN stays blank until someone scores a real O×S×D entry — nothing is pre-filled.",
      href: hubHref("/team", "fmea", orgId),
      primary: true,
    });
    actions.push({
      id: "knowledge",
      label: "Capture the procedure in Knowledge",
      detail: "Wiki handoffs belong next to failure modes so fixes are not tribal knowledge.",
      href: hubHref("/team", "knowledge", orgId),
    });
    actions.push({
      id: "cad",
      label: "Open CAD for redesign clues",
      detail: "CAD can pull open risks — empty log means empty reliability context.",
      href: hubHref("/build", "cad", orgId),
    });
    actions.push({
      id: "prototype",
      label: "Plan a prototype check",
      detail: "Validate a suspected weak subsystem before it hits competition.",
      href: hubHref("/build", "prototype", orgId),
    });
    return actions;
  }

  if (input.needsFixCount > 0) {
    const sample = input.topTitle?.trim() || "highest open risk";
    actions.push({
      id: "needs-fix",
      label: `Record a fix (${input.needsFixCount} open)`,
      detail: `${sample} still needs a corrective action — RPN ${input.highestRpn} is from logged scores only.`,
      href: hubHref("/team", "fmea", orgId),
      primary: true,
    });
  } else if (input.activeCount > 0) {
    actions.push({
      id: "review-top",
      label: input.topTitle ? `Review “${input.topTitle}”` : "Review open risks",
      detail: `${input.activeCount} active · top RPN ${input.highestRpn} from real O×S×D — not demo data.`,
      href: hubHref("/team", "fmea", orgId),
      primary: true,
    });
  }

  actions.push({
    id: "knowledge",
    label: "Document the fix in Knowledge",
    detail: "Turn root cause + countermeasure into a procedure the whole org can reuse.",
    href: hubHref("/team", "knowledge", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "cad",
    label: "Check CAD for geometry risk",
    detail: "Engineering briefs can include open FMEA risks as design constraints.",
    href: hubHref("/build", "cad", orgId),
  });

  actions.push({
    id: "prototype",
    label: "Prototype the countermeasure",
    detail: "Prove the fix on a subassembly before locking CAD or inspection.",
    href: hubHref("/build", "prototype", orgId),
  });

  if (actions.length < 5) {
    actions.push({
      id: "batteries",
      label: "Battery reliability signals",
      detail: "Pack IR/cycle evidence can promote into FMEA when you confirm a mode.",
      href: hubHref("/team", "batteries", orgId),
    });
  }

  return actions.slice(0, 5);
}

/** Display RPN only when at least one scored failure exists — never a DEMO 0. */
export function formatRpnDisplay(rpn: number, hasFailures: boolean): string {
  if (!hasFailures) return "—";
  return String(rpn);
}

/** Compact O×S×D evidence line from real factors only. */
export function formatOsdFactors(input: {
  occurrence: number;
  severity: number;
  detection: number;
}): string {
  return `O${input.occurrence} × S${input.severity} × D${input.detection}`;
}

/** Risk-row meta from a real evaluation — empty fields omitted (no invented text). */
export function formatRiskRowMeta(evaluation: Pick<FmeaEvaluation, "failure" | "rpn" | "level">): string {
  const f = evaluation.failure;
  const parts = [
    f.subsystemName.trim() || null,
    f.context,
    formatOsdFactors(f),
    `RPN ${evaluation.rpn}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

export function riskRowTone(level: FmeaLevel): FmeaLevel {
  return level;
}
