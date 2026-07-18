export const manifest = {
  slug: "sketch-to-brief",
  title: "Sketch-to-Brief",
  route: "/sketch-to-brief",
  apiRoute: "/api/sketch-to-brief",
  hub: "Build",
  navGroup: "Build",
  metered: true,
  tables: ["sketch_to_brief_sketches", "sketch_to_brief_briefs"],
  aiTools: [
    {
      name: "sketch_to_brief.draft",
      description:
        "Grounded read of a transcribed kickoff whiteboard sketch fused with the org's own answered kickoff rule notes, open rule questions, design priorities, and scoring actions into a first-pass CAD brief with rule-compliance flags.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
