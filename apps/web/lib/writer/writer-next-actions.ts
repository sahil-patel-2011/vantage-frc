import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

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
        label: "Select workspace",
        detail: "Choose your team organization before drafting grants or sponsor emails.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: WriterNextAction[] = [];
  const drafts = ctx.draftCount ?? 0;
  const thinProfile = !ctx.hasMission || !ctx.hasAchievements;

  if (thinProfile) {
    actions.push({
      id: "profile",
      label: "Fill in team mission and achievements",
      detail: "Template and Assistant drafts use this org’s profile only — empty fields stay blank, never DEMO essays.",
      href: withOrgHref("/writer", orgId),
      primary: true,
    });
  } else if (drafts === 0) {
    actions.push({
      id: "compose",
      label: "Compose a template draft",
      detail: "Start from an org-scoped template, or use FRC Assistant when a provider key is configured — no invented copy without one.",
      href: withOrgHref("/writer", orgId),
      primary: true,
    });
  }

  actions.push({
    id: "grants",
    label: "Open Grants workbench",
    detail: "Guided need · impact · budget · timeline narratives for the same workspace — separate from this Writer tab.",
    href: withOrgHref("/team/grants", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "awards",
    label: "Open Awards workbench",
    detail: "FIRST essay prompts and submission status — never DEMO win rates or fabricated essays.",
    href: withOrgHref("/team/awards", orgId),
  });

  actions.push({
    id: "knowledge",
    label: "Open Team Knowledge",
    detail: "Ground pitches in recorded team facts — Knowledge is org-scoped context, not invented background.",
    href: hubHref("/team", "knowledge", orgId),
  });

  return actions.slice(0, 5);
}
