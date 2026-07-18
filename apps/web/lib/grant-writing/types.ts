import type { GrantProvenanceItem } from "../grant-assist/types";

export const GRANT_TEMPLATE_KEYS = [
  "community_foundation",
  "stem_education",
  "equipment_materials",
  "travel_competition",
  "general_narrative",
] as const;

export type GrantTemplateKey = (typeof GRANT_TEMPLATE_KEYS)[number];

export const GRANT_DRAFT_STATUSES = ["draft", "ready", "submitted", "archived"] as const;

export type GrantDraftStatus = (typeof GRANT_DRAFT_STATUSES)[number];

export type GuidedFields = {
  need: string;
  impact: string;
  budget: string;
  timeline: string;
};

export type GrantTemplate = {
  key: GrantTemplateKey;
  label: string;
  summary: string;
  headings: Record<keyof GuidedFields, string>;
  prompts: Record<keyof GuidedFields, string>;
};

export type GrantWritingDraft = {
  id: string;
  templateKey: GrantTemplateKey;
  title: string;
  funderName: string | null;
  askAmountUsd: number | null;
  fields: GuidedFields;
  body: string;
  status: GrantDraftStatus;
  source: string;
  provenance: GrantProvenanceItem[];
  seasonYear: number;
  updatedAt: string;
};

export type GrantWritingSetupStep = { id: string; label: string; detail: string; href: string };

export type GrantWritingView =
  | {
      status: "setup_required";
      message: string;
      steps: GrantWritingSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      orgName: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      templates: GrantTemplate[];
      drafts: GrantWritingDraft[];
      impactSummary: { activities: number; hours: number; peopleReached: number };
      communityHours: number;
      seasonGoals: Array<{
        title: string;
        category: string;
        currentValue: number;
        targetValue: number;
        unit: string | null;
        progress: number;
      }>;
      awardCount: number;
      location: string | null;
      computedAt: string;
    };
