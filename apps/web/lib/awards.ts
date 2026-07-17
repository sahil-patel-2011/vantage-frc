export const AWARD_STATUSES = [
  "planned",
  "drafting",
  "in_review",
  "submitted",
  "finalist",
  "won",
  "not_selected",
] as const;
export type AwardStatus = (typeof AWARD_STATUSES)[number];
export const AWARD_ITEM_KINDS = ["essay", "task", "question"] as const;
export type AwardItemKind = (typeof AWARD_ITEM_KINDS)[number];

export type AwardCatalogEntry = {
  slug: string;
  name: string;
  description: string;
  essayPrompts: string[];
};

/** FIRST Robotics Competition's standard award set, used to seed new award submissions. */
export const AWARD_CATALOG: AwardCatalogEntry[] = [
  {
    slug: "chairmans",
    name: "Chairman's Award",
    description:
      "FIRST's highest honor, recognizing the team that best represents a model for other teams and best embodies the mission of FIRST.",
    essayPrompts: [
      "What is your team's mission and how do you live it out?",
      "How has your team grown FIRST in your community and beyond?",
      "What makes your team's culture and outreach unique?",
    ],
  },
  {
    slug: "impact",
    name: "Impact Award",
    description: "Recognizes outstanding outreach, sustainability, and team culture.",
    essayPrompts: [
      "Describe your team's outreach programs and their measurable impact.",
      "How does your team sustain itself and mentor its members long-term?",
    ],
  },
  {
    slug: "engineering_inspiration",
    name: "Engineering Inspiration Award",
    description:
      "Recognizes outstanding success in advancing respect and appreciation for engineering within a team's school/organization and community.",
    essayPrompts: ["How has your team increased interest in engineering within your school/community?"],
  },
  {
    slug: "deans_list",
    name: "Dean's List",
    description: "Recognizes individual student leaders who exemplify a commitment to STEM and FIRST's mission.",
    essayPrompts: [
      "Describe this student's leadership and impact on the team.",
      "How has this student demonstrated passion for STEM beyond the team?",
    ],
  },
  {
    slug: "woodie_flowers",
    name: "Woodie Flowers Finalist Award",
    description: "Recognizes a mentor who best represents the goals and ideals of FIRST through mentorship.",
    essayPrompts: ["Describe how this mentor teaches and inspires students technically and personally."],
  },
  {
    slug: "excellence_in_engineering",
    name: "Excellence in Engineering Award",
    description: "Recognizes a team's overall engineering process, quality, and innovation in robot design.",
    essayPrompts: ["Describe your engineering design process and a key design decision this season."],
  },
  {
    slug: "innovation_in_control",
    name: "Innovation in Control Award",
    description: "Recognizes creative use of sensors and control systems.",
    essayPrompts: ["Describe the sensor/control system innovation on your robot and why it's novel."],
  },
  {
    slug: "industrial_design",
    name: "Industrial Design Award",
    description: "Recognizes elegant design achieving efficient function, reliability, and ease of use.",
    essayPrompts: ["Describe a mechanism on your robot that balances elegant design with reliability."],
  },
  {
    slug: "quality",
    name: "Quality Award",
    description: "Recognizes a team's quality craftsmanship and design process.",
    essayPrompts: ["Describe your quality-control process from design through fabrication."],
  },
  {
    slug: "creativity",
    name: "Creativity Award",
    description: "Recognizes a creative approach to problem solving in robot design.",
    essayPrompts: ["Describe the creative mechanism or strategy your team used this season."],
  },
  {
    slug: "team_spirit",
    name: "Team Spirit Award",
    description: "Recognizes team spirit that transcends the competition, exemplifying gracious professionalism.",
    essayPrompts: ["Describe how your team demonstrates spirit and gracious professionalism at events."],
  },
  {
    slug: "gracious_professionalism",
    name: "Gracious Professionalism Award",
    description: "Recognizes a team that competes hard while helping others and treating everyone with respect.",
    essayPrompts: ["Give an example of your team helping a competitor this season."],
  },
  {
    slug: "judges",
    name: "Judges' Award",
    description: "A discretionary award for accomplishments that do not fit an existing category.",
    essayPrompts: ["What makes your team noteworthy outside the standard award categories?"],
  },
  {
    slug: "rookie_all_star",
    name: "Rookie All-Star Award",
    description:
      "Recognizes a rookie team that best represents a combination of the Chairman's Award and Regional Winner qualities.",
    essayPrompts: ["As a rookie team, what has been your biggest achievement and community impact?"],
  },
  {
    slug: "rookie_inspiration",
    name: "Rookie Inspiration Award",
    description: "Recognizes a rookie team's outstanding success in advancing respect and appreciation for engineering.",
    essayPrompts: ["Describe your rookie season's biggest technical and outreach accomplishments."],
  },
  {
    slug: "safety",
    name: "Safety Award",
    description: "Recognizes a team's strong commitment to safety.",
    essayPrompts: ["Describe your team's safety program and safety culture in the shop and at events."],
  },
  {
    slug: "autonomous",
    name: "Autonomous Award",
    description: "Recognizes excellence in autonomous robot operation.",
    essayPrompts: ["Describe your autonomous routine and the engineering behind it."],
  },
  {
    slug: "imagery",
    name: "Imagery Award",
    description: "Recognizes a team that captures the season's theme in their robot's visual design.",
    essayPrompts: ["Describe how your robot's visual design reflects this season's theme."],
  },
  {
    slug: "entrepreneurship",
    name: "Entrepreneurship Award",
    description: "Recognizes a team applying business practices to their operations.",
    essayPrompts: ["Describe your team's business plan, sponsorship strategy, and resource management."],
  },
  {
    slug: "other",
    name: "Other / Regional-Specific Award",
    description: "A regional-specific or other award not listed above.",
    essayPrompts: [],
  },
];

export function awardCatalogEntry(slug: string) {
  return AWARD_CATALOG.find((entry) => entry.slug === slug);
}

const AWARD_STATUS_LABELS: Record<AwardStatus, string> = {
  planned: "Planned",
  drafting: "Drafting",
  in_review: "In review",
  submitted: "Submitted",
  finalist: "Finalist",
  won: "Won",
  not_selected: "Not selected",
};

export function awardStatusLabel(status: AwardStatus) {
  return AWARD_STATUS_LABELS[status];
}

export function summarizeAwardHistory(submissions: { seasonYear: number; awardType: string; status: AwardStatus }[]) {
  const won = submissions.filter((s) => s.status === "won");
  const seasonsActive = [...new Set(submissions.map((s) => s.seasonYear))].sort((a, b) => b - a);
  return {
    totalSubmissions: submissions.length,
    totalWon: won.length,
    wonAwardNames: won.map((s) => awardCatalogEntry(s.awardType)?.name ?? s.awardType),
    seasonsActive,
  };
}
