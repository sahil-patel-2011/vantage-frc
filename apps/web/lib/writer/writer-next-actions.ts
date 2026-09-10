import { hubHref } from "../nav/hubs";
import { writerRelatedLinks } from "./writer-related";

export type WriterNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type WriterNextActionContext = {
  orgId?: string | null;
  draftCount?: number;
  hasMission?: boolean;
  hasAchievements?: boolean;
};

/**
 * Soft-UI next actions for Grant & Sponsorship Writer (AI hub).
 * Cross-links Grants / Awards / Knowledge only — never invents essay or award copy.
 */
export function writerNextActions(ctx: WriterNextActionContext): WriterNextAction[] {
  const orgId = ctx.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before drafting grants or sponsor emails.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: WriterNextAction[] = [];
  const drafts = ctx.draftCount ?? 0;
  const thinProfile = !ctx.hasMission || !ctx.hasAchievements;
  const writerHref = hubHref("/ai", "writer", orgId);

  if (thinProfile) {
    actions.push({
      id: "profile",
      label: "Fill in team mission and achievements",
      detail: "Template and Assistant drafts use this org’s profile only — empty fields stay blank.",
      href: writerHref,
      primary: true,
    });
  } else if (drafts === 0) {
    actions.push({
      id: "compose",
      label: "Compose a template draft",
      detail:
        "Start from an your team's template, or use FRC Assistant when a provider key is configured.",
      href: writerHref,
      primary: true,
    });
  }

  const related = writerRelatedLinks(orgId, { include: ["grants", "awards", "knowledge"] });
  for (const link of related) {
    if (link.id === "grants") {
      actions.push({
        id: "grants",
        label: "Open Grants workbench",
        detail:
          "Guided need · impact · budget · timeline narratives for the same workspace — separate from this Writer tab.",
        href: link.href,
        primary: actions.length === 0,
      });
    } else if (link.id === "awards") {
      actions.push({
        id: "awards",
        label: "Open Awards workbench",
        detail: "FIRST essay prompts and submission status.",
        href: link.href,
      });
    } else if (link.id === "knowledge") {
      actions.push({
        id: "knowledge",
        label: "Open Team Knowledge",
        detail: "Ground pitches in recorded team facts context, not invented background.",
        href: link.href,
      });
    }
  }

  return actions.slice(0, 5);
}
