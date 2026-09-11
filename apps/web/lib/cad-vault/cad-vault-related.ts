import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { cadLinkKind, cadLinkLabel } from "./cad-link";

export type CadVaultRelatedId = "cad" | "cad-learn" | "assembly-manual" | "robot";

export type CadVaultRelatedLink = {
  id: CadVaultRelatedId;
  label: string;
  href: string;
};

export const CAD_VAULT_RELATED_INCLUDE: CadVaultRelatedId[] = [
  "cad-learn",
  "assembly-manual",
  "cad",
];

const CAD_VAULT_RELATED_LINKS = [
  { id: "cad-learn" as const, label: "Learn CAD", kind: "path" as const, path: "/cad-learn" },
  { id: "assembly-manual" as const, label: "Assembly manual", kind: "path" as const, path: "/assembly-manual" },
  { id: "cad" as const, label: "CAD workbench", kind: "build" as const, tab: "cad" },
  { id: "robot" as const, label: "Robot", kind: "path" as const, path: "/robot" },
];

/** Cross-links from CAD Vault — Learn CAD / Assembly manual / CAD workbench. */
export function cadVaultRelatedLinks(
  orgId?: string | null,
  options?: { active?: CadVaultRelatedId; include?: CadVaultRelatedId[] },
): CadVaultRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return CAD_VAULT_RELATED_LINKS.filter((link) => {
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

export type CadVaultShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type CadVaultNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type CadVaultShellCopy = {
  kind: CadVaultShellKind;
  badge?: string;
  title: string;
  description: string;
};

export function classifyCadVaultShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  authBlocked?: boolean;
  status?: "setup_required" | "empty" | "ready" | null;
}): CadVaultShellKind {
  if (input.loading) return "loading";
  if (input.authBlocked) return "setup";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required") return "setup";
  if (input.status === "empty") return "empty";
  if (input.status === "ready") return "ready";
  return "loading";
}

export function cadVaultShellCopy(kind: CadVaultShellKind): CadVaultShellCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        badge: "Loading",
        title: "Loading the vault…",
        description: "Fetching your team's CAD documents.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load the CAD vault",
        description: "Check your connection and try again.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description: "Choose your team to open the CAD vault.",
      };
    case "empty":
      return {
        kind,
        badge: "No documents yet",
        title: "Link a CAD document",
        description:
          "Paste an Onshape or Fusion link so everyone can edit the live model by name. Printable STL or STEP files can wait.",
      };
    default:
      return {
        kind: "ready",
        title: "CAD vault",
        description:
          "Live Onshape and Fusion links first, then printable files. Titles are the names the team searches.",
      };
  }
}

/**
 * Next actions for a vault that already has documents.
 * Setup and empty keep one EmptyState primary instead of this list.
 */
export function cadVaultNextActions(input: {
  orgId?: string | null;
  shell: CadVaultShellKind;
  documentCount: number;
  linkedCount: number;
}): CadVaultNextAction[] {
  if (input.shell !== "ready" || !input.orgId) return [];

  const actions: CadVaultNextAction[] = [];
  if (input.linkedCount === 0) {
    actions.push({
      id: "link",
      label: "Link Onshape or Fusion",
      detail: "Paste the live model so the next person opens it by title, not by hunting a drive folder.",
      href: "#link-cad",
      primary: true,
    });
  }
  if (input.documentCount > 0) {
    actions.push({
      id: "assembly",
      label: "Build an assembly manual",
      detail: "A vault document with an Onshape link can become the shop step book.",
      href: withOrgHref("/assembly-manual", input.orgId),
      primary: actions.length === 0,
    });
  }
  actions.push({
    id: "learn",
    label: "Learn CAD",
    detail: "New mechanical members start with the Onshape track.",
    href: withOrgHref("/cad-learn", input.orgId),
    primary: actions.length === 0,
  });
  return actions.slice(0, 4);
}

/** STL face count only — volume is file units, never kilograms. */
export function cadVaultGeometryCopy(input: {
  triangleCount: number | null;
  format: string;
}): string {
  if (input.triangleCount == null) {
    return `${input.format.toUpperCase()} is stored as-is. Open the Onshape or Fusion link for the live model.`;
  }
  const faces = input.triangleCount.toLocaleString();
  return `${faces} triangles in this STL — a face count, not a weight in kilograms.`;
}

export function cadVaultOpenLabel(url: string | null | undefined, title: string): string {
  if (!url) return title;
  return cadLinkLabel(url, title);
}

export function cadVaultHasLiveLink(url: string | null | undefined): boolean {
  const kind = cadLinkKind(url);
  return kind === "onshape" || kind === "fusion";
}
