import type { FieldDefinition } from "@vantage/scouting";

export type ScoutingReportTemplateCategory = "Match phase" | "Robot role" | "Event format";

export type ScoutingReportTemplate = {
  id: string;
  name: string;
  category: ScoutingReportTemplateCategory;
  description: string;
  keywords: string[];
};

export const SCOUTING_REPORT_TEMPLATES: readonly ScoutingReportTemplate[] = [
  {
    id: "phase-auto",
    name: "Autonomous focus",
    category: "Match phase",
    description: "Jump to autonomous scoring, mobility, and starting actions.",
    keywords: ["auto", "autonomous", "mobility", "taxi", "preload", "start"],
  },
  {
    id: "phase-teleop",
    name: "Teleop cycles",
    category: "Match phase",
    description: "Prioritize cycle counts, pickup, scoring, and timing.",
    keywords: ["teleop", "cycle", "pickup", "intake", "score", "scoring", "timer"],
  },
  {
    id: "phase-endgame",
    name: "Endgame focus",
    category: "Match phase",
    description: "Bring endgame, climb, park, and balance metrics forward.",
    keywords: ["endgame", "climb", "hang", "park", "balance", "stage"],
  },
  {
    id: "role-scorer",
    name: "Primary scorer",
    category: "Robot role",
    description: "Focus on output, accuracy, cycle speed, and scoring locations.",
    keywords: ["score", "scoring", "accuracy", "cycle", "position", "location", "piece"],
  },
  {
    id: "role-defense",
    name: "Defense",
    category: "Robot role",
    description: "Track defensive impact, blocks, fouls, and time spent defending.",
    keywords: ["defense", "defensive", "defend", "block", "foul", "penalty", "card"],
  },
  {
    id: "role-support",
    name: "Support & feeder",
    category: "Robot role",
    description: "Prioritize assists, passes, feeding, intake, and support notes.",
    keywords: ["assist", "pass", "feed", "support", "intake", "pickup", "note"],
  },
  {
    id: "event-qualification",
    name: "Qualification quick log",
    category: "Event format",
    description: "A balanced pass across scoring, reliability, fouls, and endgame.",
    keywords: ["score", "auto", "teleop", "endgame", "reliable", "disabled", "foul", "penalty"],
  },
  {
    id: "event-playoffs",
    name: "Playoff detail",
    category: "Event format",
    description: "Prioritize high-impact output, defense, penalties, and reliability.",
    keywords: ["score", "cycle", "accuracy", "defense", "endgame", "penalty", "foul", "reliable"],
  },
  {
    id: "event-offseason",
    name: "Practice & offseason",
    category: "Event format",
    description: "Focus on learning, driver performance, consistency, and notes.",
    keywords: ["note", "driver", "strategy", "cycle", "reliable", "consistent", "disabled", "practice"],
  },
];

export function fieldsForReportTemplate(
  fields: readonly FieldDefinition[],
  template: ScoutingReportTemplate,
  limit = 6,
): FieldDefinition[] {
  return fields
    .filter((field) => field.type !== "section_header")
    .map((field, index) => {
      const searchable = `${field.key} ${field.label} ${field.helpText ?? ""}`
        .toLowerCase()
        .replace(/[_-]+/g, " ");
      const score = template.keywords.reduce(
        (total, keyword, keywordIndex) =>
          searchable.includes(keyword) ? total + template.keywords.length - keywordIndex : total,
        0,
      );
      return { field, index, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map((candidate) => candidate.field);
}
