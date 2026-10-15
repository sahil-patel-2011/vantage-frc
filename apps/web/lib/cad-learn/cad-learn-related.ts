import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type CadLearnRelatedId = "cad-vault" | "cad" | "dev-setup" | "learn-hub";

export type CadLearnRelatedLink = {
  id: CadLearnRelatedId;
  label: string;
  href: string;
};

/**
 * The header strip. Each destination appears once on /cad-learn: the vault is a
 * Next action ("Link your CAD in the vault"), so it is not repeated here, and the
 * assembly manual is left out because the Build hub does not switch it on
 * (lib/nav/hubs.ts) — a link to a page that is not running is a dead end.
 */
export const CAD_LEARN_RELATED_INCLUDE: CadLearnRelatedId[] = ["cad", "learn-hub"];

const CAD_LEARN_RELATED_LINKS = [
  { id: "cad-vault" as const, label: "CAD vault", kind: "path" as const, path: "/cad-vault" },
  { id: "cad" as const, label: "CAD workbench", kind: "build" as const, tab: "cad" },
  { id: "learn-hub" as const, label: "Learn", kind: "path" as const, path: "/learn" },
  { id: "dev-setup" as const, label: "Programming setup", kind: "path" as const, path: "/dev-setup" },
];

/** Cross-links from Learn CAD to its sibling pages. */
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
 *
 * Nothing here repeats a link that is already on the page: the CAD workbench is
 * in the header strip, and Explore Onshape is a section of this page (and in its
 * side navigation).
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
  return actions;
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
  "Onshape from the first sketch to a mated assembly, then CAD Video Tutor on cast iron. At the end you link your part and Vantage reads mass and spin from Onshape against your team's reference.";

export type CadLearnShellKind = "loading" | "error" | "setup" | "signin";

export type CadLearnShellCopy = {
  kind: CadLearnShellKind;
  badge?: string;
  title: string;
  description: string;
};

/**
 * Which team-specific state to show. `signedOut` (a 401) asks the person to sign
 * in; `authBlocked` (a 403: signed in, but not on that team) asks them to choose
 * their team. The lessons render in every case; only the team parts wait.
 */
export function classifyCadLearnShell(input: {
  ready?: boolean;
  fetchFailed?: boolean;
  authBlocked?: boolean;
  signedOut?: boolean;
}): CadLearnShellKind {
  if (input.signedOut) return "signin";
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
        title: "Loading your progress",
        description: "Fetching your progress and your team's reference parts.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load your progress",
        description: "The lessons below still work. Check your connection and try again to save progress and grade parts.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description: "Choose your team to save Learn CAD progress and grade your part.",
      };
    case "signin":
      return {
        kind,
        badge: "Signed out",
        title: "Sign in to save your progress",
        description: "The lessons below work without signing in. Sign in to tick them off and grade your part.",
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
