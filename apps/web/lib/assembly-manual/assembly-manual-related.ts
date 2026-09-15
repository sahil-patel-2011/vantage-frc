import { ONSHAPE_OAUTH_CTA } from "../cad/onshape-setup-strings";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

export type AssemblyManualRelatedId = "cad-vault" | "cad" | "cad-learn";

export type AssemblyManualRelatedLink = {
  id: AssemblyManualRelatedId;
  label: string;
  href: string;
};

export const ASSEMBLY_MANUAL_RELATED_INCLUDE: AssemblyManualRelatedId[] = [
  "cad-vault",
  "cad",
  "cad-learn",
];

const ASSEMBLY_MANUAL_RELATED_LINKS = [
  { id: "cad-vault" as const, label: "CAD vault", kind: "path" as const, path: "/cad-vault" },
  { id: "cad" as const, label: "CAD workbench", kind: "build" as const, tab: "cad" },
  { id: "cad-learn" as const, label: "Learn CAD", kind: "path" as const, path: "/cad-learn" },
];

export function assemblyManualRelatedLinks(
  orgId?: string | null,
  options?: { include?: AssemblyManualRelatedId[] },
): AssemblyManualRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return ASSEMBLY_MANUAL_RELATED_LINKS.filter((link) => !include || include.has(link.id)).map((link) => {
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

/** Deep-link so picking a vault assembly lands on the book without re-pasting. */
export function assemblyManualFromVaultHref(orgId: string | null | undefined, documentId: string): string {
  const base = `/assembly-manual?documentId=${encodeURIComponent(documentId)}`;
  return withOrgHref(base, orgId);
}

export const FUSION_CANNOT_FEED_BOOK =
  "Fusion cannot feed this book. Paste an Onshape assembly link.";

export const CONNECT_ONSHAPE = ONSHAPE_OAUTH_CTA.connect;

export type AssemblyManualShellKind = "loading" | "error" | "setup" | "ready";

export type AssemblyManualShellCopy = {
  kind: AssemblyManualShellKind;
  badge?: string;
  title: string;
  description: string;
};

export function classifyAssemblyManualShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  authBlocked?: boolean;
  status?: "setup_required" | "ok" | null;
  orgId?: string | null;
}): AssemblyManualShellKind {
  if (input.authBlocked) return "setup";
  if (input.status === "setup_required") return "setup";
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  return "ready";
}

export function assemblyManualShellCopy(kind: AssemblyManualShellKind): AssemblyManualShellCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        badge: "Loading",
        title: "Loading the assembly book…",
        description: "Checking your team, Onshape connection, and any runs already queued.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load the assembly book",
        description: "Check your connection and try again.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description: "Choose your team before pasting an Onshape assembly link.",
      };
    case "ready":
      return {
        kind,
        title: "Assembly manual",
        description:
          "Paste an Onshape assembly link and Connect Onshape. That starts the book — even a huge robot.",
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

export type AssemblyRunProgressKind = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";

/**
 * Live step/render counts only after a worker has actually leased a run.
 * A queued row with no check-in is waiting — not fake progress.
 */
export function assemblyRunShowsLiveProgress(input: {
  status: AssemblyRunProgressKind;
  workerLastCheckIn: string | null;
}): boolean {
  switch (input.status) {
    case "queued":
    case "paused":
      return Boolean(input.workerLastCheckIn);
    case "running":
      return true;
    case "completed":
    case "failed":
    case "cancelled":
      return false;
    default: {
      const exhaustive: never = input.status;
      return exhaustive;
    }
  }
}

export function assemblyWorkerWaitingCopy(lastCheckIn: string | null, message: string): string | null {
  if (lastCheckIn) return null;
  return message;
}
