import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for the Team Knowledge wiki. */
export const KNOWLEDGE_RELATED_LINKS = [
  { id: "messages", label: "Team chat", kind: "team" as const, tab: "messages" },
  { id: "fmea", label: "Failure log", kind: "team" as const, tab: "fmea" },
  { id: "cad", label: "CAD", kind: "build" as const, tab: "cad" },
  { id: "decisions", label: "Decisions", kind: "path" as const, path: "/decisions" },
  { id: "assistant", label: "FRC Assistant", kind: "path" as const, path: "/chat" },
  { id: "getting-started", label: "Getting started", kind: "path" as const, path: "/team/getting-started" },
  { id: "knowledge-gap", label: "Knowledge gaps", kind: "path" as const, path: "/knowledge-gap" },
] as const;

export type KnowledgeRelatedId = (typeof KNOWLEDGE_RELATED_LINKS)[number]["id"];

export type KnowledgeRelatedLink = {
  id: KnowledgeRelatedId;
  label: string;
  href: string;
};

/** Focused header strip — Team chat / FMEA / Decisions. */
export const KNOWLEDGE_RELATED_INCLUDE: KnowledgeRelatedId[] = [
  "messages",
  "fmea",
  "decisions",
];

/** Cross-links for Knowledge Soft-UI (never DEMO article placeholders). */
export function knowledgeRelatedLinks(
  orgId?: string | null,
  options?: { active?: KnowledgeRelatedId; include?: KnowledgeRelatedId[] },
): KnowledgeRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return KNOWLEDGE_RELATED_LINKS.filter((link) => {
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

export type KnowledgeSetupNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/** Readable next actions when Knowledge wiki cannot load — never invents DEMO pages. */
export function knowledgeSetupNextActions(orgId?: string | null): KnowledgeSetupNextAction[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before opening the wiki.",
        href: "/workspace",
        primary: true,
      },
    ];
  }
  return [
    {
      id: "templates",
      label: "Start from a handoff template",
      detail: "Structured pages stay empty until you fill real team facts — nothing is pre-authored.",
      href: hubHref("/team", "knowledge", orgId),
      primary: true,
    },
    {
      id: "messages",
      label: "Ask in Messages",
      detail: "Request a subsystem dump or handoff from mentors when the corpus is empty.",
      href: hubHref("/team", "messages", orgId),
    },
    {
      id: "fmea",
      label: "Link failure modes in Failure log",
      detail: "Documented failure modes belong next to wiki procedures — same org facts only.",
      href: hubHref("/team", "fmea", orgId),
    },
    {
      id: "cad",
      label: "Open CAD conventions",
      detail: "CAD agent retrieves wiki pages for this org — empty corpus means empty CAD context.",
      href: hubHref("/build", "cad", orgId),
    },
  ];
}
