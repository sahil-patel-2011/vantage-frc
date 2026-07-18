import { GRANT_TEMPLATE_KEYS, type GrantTemplate, type GrantTemplateKey } from "./types";

const FIELD_HEADINGS = {
  need: "Need",
  impact: "Impact",
  budget: "Budget",
  timeline: "Timeline",
} as const;

export const GRANT_TEMPLATES: GrantTemplate[] = [
  {
    key: "community_foundation",
    label: "Community foundation",
    summary: "Local foundation grants emphasizing community service and youth development.",
    headings: FIELD_HEADINGS,
    prompts: {
      need: "What community problem does your team address, and what resources are missing?",
      impact: "How will funding expand outreach, mentorship, or service hours in your area?",
      budget: "Itemize how funds will be spent (materials, events, transportation, stipends).",
      timeline: "When will activities happen and when will you report outcomes to the funder?",
    },
  },
  {
    key: "stem_education",
    label: "STEM education",
    summary: "Education-focused grants for hands-on STEM learning and workforce pathways.",
    headings: FIELD_HEADINGS,
    prompts: {
      need: "Describe the STEM access gap your team helps close for students or schools.",
      impact: "What measurable learning outcomes, workshops, or partnerships will you deliver?",
      budget: "Break down curriculum kits, mentor time, venue costs, and student support.",
      timeline: "Outline key program milestones across the season or school year.",
    },
  },
  {
    key: "equipment_materials",
    label: "Equipment & materials",
    summary: "Capital or in-kind support for robot parts, shop tools, and safety gear.",
    headings: FIELD_HEADINGS,
    prompts: {
      need: "Which equipment or materials are required to build and compete safely this season?",
      impact: "How will new tools improve learning, reliability, or team capacity?",
      budget: "List SKUs, vendors, quantities, and unit costs with a total ask.",
      timeline: "When will you purchase, install, and put equipment into student use?",
    },
  },
  {
    key: "travel_competition",
    label: "Travel & competition",
    summary: "Travel grants for regional events, championships, and competition fees.",
    headings: FIELD_HEADINGS,
    prompts: {
      need: "Which events require travel support and why are they essential this season?",
      impact: "How does competition travel advance student skills, scouting, or alliances?",
      budget: "Include registration, lodging, meals, transport, and contingency lines.",
      timeline: "Map event dates, booking deadlines, and reimbursement milestones.",
    },
  },
  {
    key: "general_narrative",
    label: "General narrative",
    summary: "Flexible template when the funder prompt does not match a specialized category.",
    headings: FIELD_HEADINGS,
    prompts: {
      need: "Summarize the funding gap and why your team is positioned to address it.",
      impact: "Explain outcomes for students, school, and community if funded.",
      budget: "Provide a clear, funder-friendly budget summary.",
      timeline: "Describe delivery milestones from award through season close-out.",
    },
  },
];

export function grantTemplateByKey(key: GrantTemplateKey): GrantTemplate {
  return GRANT_TEMPLATES.find((template) => template.key === key) ?? GRANT_TEMPLATES[0]!;
}

export function isGrantTemplateKey(value: unknown): value is GrantTemplateKey {
  return typeof value === "string" && (GRANT_TEMPLATE_KEYS as readonly string[]).includes(value);
}
