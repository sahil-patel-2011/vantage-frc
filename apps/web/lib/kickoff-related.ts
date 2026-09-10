import type { BuildRelatedId } from "./build/build-related";
import { hubHref } from "./nav/hubs";
import { withOrgHref } from "./nav/product-nav";
import type { KickoffSummary } from "./kickoff";

/** Focused Soft-UI Build strip when Kickoff is open (never DEMO placeholders). */
export const KICKOFF_BUILD_RELATED_INCLUDE: BuildRelatedId[] = [
  "cad",
  "fmea",
  "prototype",
  "competition",
];

export type KickoffNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

function withOrg(path: string, orgId?: string | null): string {
  return withOrgHref(path, orgId);
}

/**
 * Readable Soft-UI next actions for the kickoff → strategy → CAD pipeline.
 * Points at real manual/transcript entry, Strategy seeds, and CAD briefs —
 * never DEMO game rules or fabricated scoring.
 */
export function kickoffNextActions(input: {
  orgId?: string | null;
  seasonYear: number;
  hasIntelligence: boolean;
  actionCount: number;
  priorityCount: number;
  openRuleCount: number;
  cadJobId?: string | null;
}): KickoffNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Choose your team organization before ingesting kickoff materials.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: KickoffNextAction[] = [];
  const kickoffHref = hubHref("/build", "kickoff", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const cadHref = hubHref("/build", "cad", orgId);

  if (!input.hasIntelligence && input.actionCount === 0) {
    actions.push({
      id: "upload-materials",
      label: "Paste manual + transcript",
      detail: `Season ${input.seasonYear} summary stays empty until you paste release materials.`,
      href: kickoffHref,
      primary: true,
    });
    actions.push({
      id: "strategy-seeds",
      label: "Open Strategy (after seeds)",
      detail: "Design priorities seed into Strategy only from the summary you paste — empty until you do.",
      href: strategyHref,
    });
    actions.push({
      id: "cad-brief",
      label: "Open CAD briefs",
      detail: "CAD briefs open from the same intelligence record after Generate — empty until then.",
      href: cadHref,
    });
    return actions;
  }

  if (!input.hasIntelligence) {
    actions.push({
      id: "generate-summary",
      label: "Generate structured summary",
      detail: "You have scoring notes — upload a manual/transcript to structure the season release.",
      href: kickoffHref,
      primary: true,
    });
  } else if (input.priorityCount === 0) {
    actions.push({
      id: "seed-priorities",
      label: "Seed Strategy priorities",
      detail: "Re-seed design directions from the intelligence summary into your priority board.",
      href: kickoffHref,
      primary: true,
    });
  } else {
    actions.push({
      id: "review-strategy",
      label: "Review Strategy seeds",
      detail: `${input.priorityCount} design priorit${input.priorityCount === 1 ? "y" : "ies"} from release materials — refine in Strategy.`,
      href: strategyHref,
      primary: true,
    });
  }

  if (input.cadJobId) {
    actions.push({
      id: "open-cad-brief",
      label: "Open CAD brief",
      detail: "Continue the kickoff design brief in Onshape/Fusion paths — MODEL-labeled.",
      href: cadHref,
    });
  } else if (input.hasIntelligence) {
    actions.push({
      id: "create-cad-brief",
      label: "Create CAD brief",
      detail: "Hand the structured summary to CAD as a grounded design brief.",
      href: kickoffHref,
    });
  }

  if (input.openRuleCount > 0) {
    actions.push({
      id: "rules-qa",
      label: `Answer ${input.openRuleCount} open rule question${input.openRuleCount === 1 ? "" : "s"}`,
      detail: "Cite the official manual or Q&A only.",
      href: kickoffHref,
    });
  }

  if (actions.length < 4) {
    actions.push({
      id: "strategy",
      label: "Open Strategy",
      detail: "Pick lists and match plans stay grounded in real scout/TBA facts.",
      href: strategyHref,
    });
  }

  if (actions.length < 5) {
    actions.push({
      id: "fmea",
      label: "Log build risks in FMEA",
      detail: "Capture mechanism risks as you commit to kickoff priorities.",
      href: hubHref("/build", "fmea", orgId),
    });
  }

  return actions.slice(0, 5);
}

/** Pipeline deep-links shown beside a ready intelligence summary. */
export function kickoffPipelineLinks(input: {
  orgId: string;
  cadJobId?: string | null;
}): Array<{ id: string; label: string; href: string }> {
  const { orgId } = input;
  return [
    {
      id: "strategy-seeds",
      label: "Strategy seeds",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "cad-brief",
      label: input.cadJobId ? "Open CAD brief" : "CAD briefs",
      href: hubHref("/build", "cad", orgId),
    },
    {
      id: "competition",
      label: "Competition hub",
      href: withOrg("/competition", orgId),
    },
  ];
}

/** Hide zeroed summary tiles when nothing has been logged — avoids DEMO counters. */
export function shouldShowKickoffSummaryTiles(summary: KickoffSummary): boolean {
  return summary.actions > 0 || summary.committed > 0 || summary.openQuestions > 0;
}
