import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type CadLearnRelatedId = "cad-vault" | "cad" | "assembly-manual" | "dev-setup";

export type CadLearnRelatedLink = {
  id: CadLearnRelatedId;
  label: string;
  href: string;
};

export const CAD_LEARN_RELATED_INCLUDE: CadLearnRelatedId[] = [
  "cad-vault",
  "cad",
  "assembly-manual",
];

const CAD_LEARN_RELATED_LINKS = [
  { id: "cad-vault" as const, label: "CAD vault", kind: "path" as const, path: "/cad-vault" },
  { id: "cad" as const, label: "CAD workbench", kind: "build" as const, tab: "cad" },
  { id: "assembly-manual" as const, label: "Assembly manual", kind: "path" as const, path: "/assembly-manual" },
  { id: "dev-setup" as const, label: "Programming setup", kind: "path" as const, path: "/dev-setup" },
];

/** Cross-links from Learn CAD — vault / workbench / assembly manual. */
export function cadLearnRelatedLinks(
  orgId?: string | null,
  options?: { active?: CadLearnRelatedId; include?: CadLearnRelatedId[] },
): CadLearnRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return CAD_LEARN_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type CadLearnNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Next actions only when the student belongs to a team.
 * No-org still shows the curriculum; it does not paint this list.
 */
export function cadLearnNextActions(input: {
  orgId?: string | null;
  firstUndoneId?: string | null;
  remainingLessons: number;
}): CadLearnNextAction[] {
  if (!input.orgId) return [];

  const actions: CadLearnNextAction[] = [];
  if (input.firstUndoneId) {
    actions.push({
      id: "continue",
      label: "Continue the next lesson",
      detail:
        input.remainingLessons === 1
          ? "One lesson left on this track."
          : `${input.remainingLessons} lessons left, in the order things actually build on.`,
      href: `#${input.firstUndoneId}`,
      primary: true,
    });
  }
  actions.push({
    id: "vault",
    label: "Link your CAD in the vault",
    detail: "Paste the Onshape or Fusion link so the team can edit it by name.",
    href: withOrgHref("/cad-vault", input.orgId),
    primary: actions.length === 0,
  });
  actions.push({
    id: "cad",
    label: "Open the CAD workbench",
    detail: "Paste an Onshape document and Edit in Onshape from the workbench.",
    href: hubHref("/build", "cad", input.orgId),
  });
  return actions.slice(0, 4);
}

/** Student labels for Onshape mass-property grades — no MOI / principal-axis jargon. */
export function cadLearnFactorLabel(id: "mass" | "moment_of_inertia" | string): string {
  if (id === "mass") return "How heavy";
  if (id === "moment_of_inertia") return "How hard it is to spin";
  return id;
}

export function cadLearnCheckNote(note: string): string {
  return note
    .replace(/\bprincipal moments of inertia\b/gi, "spin numbers")
    .replace(/\bprincipal moments\b/gi, "spin numbers")
    .replace(/\bmoment of inertia\b/gi, "how hard it is to spin")
    .replace(/\bMOI\b/g, "spin");
}

export const CAD_LEARN_PAGE_DESCRIPTION =
  "Onshape from the first sketch to a mated assembly. At the end you link your part and Vantage checks how heavy it is — and how hard it is to spin — against your team's reference.";

export type CadLearnShellKind = "loading" | "error" | "setup";

export type CadLearnShellCopy = {
  kind: CadLearnShellKind;
  badge?: string;
  title: string;
  description: string;
};

export function classifyCadLearnShell(input: {
  ready?: boolean;
  fetchFailed?: boolean;
  authBlocked?: boolean;
}): CadLearnShellKind {
  if (input.authBlocked) return "setup";
  if (input.fetchFailed) return "error";
  if (!input.ready) return "loading";
  return "loading";
}

export function cadLearnShellCopy(kind: CadLearnShellKind): CadLearnShellCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        badge: "Loading",
        title: "Opening Learn CAD",
        description: "Fetching your team's CAD lessons.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Learn CAD",
        description: "Check your connection and try again.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description: "Choose your team to save Learn CAD progress.",
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
