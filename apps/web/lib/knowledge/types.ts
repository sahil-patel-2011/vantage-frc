// Team knowledge wiki types (CD #26 / #30). Framework-free.

export const KNOWLEDGE_TEMPLATE_KINDS = [
  "blank",
  "season_handoff",
  "subsystem",
  "role_onboarding",
  "pit_ops",
  "software",
  "cad_conventions",
  "inventory_handoff",
  "other",
] as const;
export type KnowledgeTemplateKind = (typeof KNOWLEDGE_TEMPLATE_KINDS)[number];

export const TEMPLATE_KIND_LABEL: Record<KnowledgeTemplateKind, string> = {
  blank: "Blank page",
  season_handoff: "Season handoff",
  subsystem: "Subsystem dump",
  role_onboarding: "Role onboarding",
  pit_ops: "Pit operations",
  software: "Software stack",
  cad_conventions: "CAD conventions",
  inventory_handoff: "Inventory handoff",
  other: "Other",
};

export type KnowledgePageSummary = {
  id: string;
  slug: string;
  title: string;
  templateKind: KnowledgeTemplateKind;
  seasonYear: number | null;
  tags: string[];
  pinned: boolean;
  updatedAt: string;
  linkCount: number;
};

export type KnowledgeLink = {
  id: string;
  targetType: "decision" | "design_review";
  targetId: string;
  targetTitle: string | null;
  targetSeasonYear: number | null;
  note: string | null;
  createdAt: string;
};

export type KnowledgePageDetail = KnowledgePageSummary & {
  body: string;
  createdAt: string;
  createdByName: string | null;
  updatedByName: string | null;
  links: KnowledgeLink[];
};

export type KnowledgeSearchHit = {
  source: "wiki" | "decision" | "design_review";
  id: string;
  title: string;
  snippet: string;
  seasonYear: number | null;
  href: string;
  rank: number;
};

export type KnowledgeWikiView =
  | {
      status: "ready";
      orgId: string;
      orgName: string;
      teamNumber: number | null;
      role: string;
      canEdit: boolean;
      pages: KnowledgePageSummary[];
      selected: KnowledgePageDetail | null;
      searchHits: KnowledgeSearchHit[];
      searchQuery: string;
      decisions: Array<{ id: string; title: string; seasonYear: number; status: string }>;
      reviews: Array<{ id: string; title: string; seasonYear: number; subsystem: string; status: string }>;
    }
  | {
      status: "setup_required";
      orgId: string;
      message: string;
    };

export const MAX_TITLE = 200;
export const MAX_BODY = 50000;
export const MAX_SLUG = 120;
export const MAX_TAG = 40;
export const MAX_TAGS = 12;

export type KnowledgeWikiAction =
  | {
      action: "upsert_page";
      orgId: string;
      id: string | null;
      title: string;
      slug: string;
      body: string;
      templateKind: KnowledgeTemplateKind;
      seasonYear: number | null;
      tags: string[];
      pinned: boolean;
      fromTemplate?: KnowledgeTemplateKind | null;
    }
  | { action: "delete_page"; orgId: string; id: string }
  | {
      action: "link";
      orgId: string;
      pageId: string;
      targetType: "decision" | "design_review";
      targetId: string;
      note: string | null;
    }
  | { action: "unlink"; orgId: string; linkId: string };
