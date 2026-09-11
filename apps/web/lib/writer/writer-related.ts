import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI shell kinds for `/ai?tab=writer` — never DEMO essays or award copy. */
export type WriterShellKind =
  | "loading"
  | "ready"
  | "empty"
  | "setup"
  | "provider_setup"
  | "error";

export type WriterRelatedId =
  | "grants"
  | "awards"
  | "knowledge"
  | "chat"
  | "budgets"
  | "usage"
  | "sponsors";

export type WriterRelatedLink = {
  id: WriterRelatedId;
  label: string;
  href: string;
};

/**
 * Soft-UI cross-links from Writer → Grants · Awards · Knowledge (+ AI neighbors).
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function writerRelatedLinks(
  orgId?: string | null,
  options?: { include?: WriterRelatedId[] },
): WriterRelatedLink[] {
  if (!orgId) return [];
  const include = options?.include ? new Set(options.include) : null;
  const all: WriterRelatedLink[] = [
    { id: "grants", label: "Grants", href: hubHref("/business", "grants", orgId) },
    { id: "awards", label: "Awards", href: withOrgHref("/team/awards", orgId) },
    { id: "knowledge", label: "Knowledge", href: hubHref("/team", "knowledge", orgId) },
    { id: "sponsors", label: "Sponsors", href: hubHref("/business", "sponsors", orgId) },
    { id: "chat", label: "Chat", href: hubHref("/ai", "chat", orgId) },
    { id: "budgets", label: "Budgets", href: hubHref("/ai", "budgets", orgId) },
    { id: "usage", label: "AI usage", href: hubHref("/ai", "usage", orgId) },
  ];
  return all.filter((link) => !include || include.has(link.id));
}

/** Primary Soft-UI strip: Grants · Awards · Knowledge. */
export const WRITER_RELATED_INCLUDE: WriterRelatedId[] = ["grants", "awards", "knowledge"];

export type WriterShellCopy = {
  kind: WriterShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Classify Soft-UI shell from load / provider / draft outcome. */
export function classifyWriterShell(input: {
  loading: boolean;
  fetchFailed: boolean;
  setupRequired: boolean;
  providerSetup: boolean;
  draftCount: number;
}): WriterShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.setupRequired) return "setup";
  if (input.providerSetup) return "provider_setup";
  if (input.draftCount === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup copy — never DEMO essays or fabricated award copy. */
export function writerShellCopy(kind: WriterShellKind): WriterShellCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading writing assistant…",
        description: "Checking your team and season profile.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load the writing assistant",
        description: "A network or server issue prevented loading. Retry, or reopen Writer from the AI hub.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before composing. FRC Assistant needs a provider key; templates work without one.",
      };
    case "provider_setup":
      return {
        kind,
        badge: "Needs setup",
        title: "AI provider not configured",
        description:
          "Use Compose from template to draft from your team’s profile without a model key.",
      };
    case "empty":
      return {
        kind,
        badge: "No drafts",
        title: "Draft library is empty",
        description:
          "Templates and saved drafts stay blank until you compose.",
      };
    default:
      return {
        kind: "ready",
        title: "Grant & Sponsorship Writer",
        description: "Draft from this team’s profile and business data only — review before sending.",
      };
  }
}
