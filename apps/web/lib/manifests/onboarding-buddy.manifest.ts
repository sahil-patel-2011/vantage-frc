export const manifest = {
  slug: "onboarding-buddy",
  title: "Onboarding Buddy",
  route: "/onboarding-buddy",
  apiRoute: "/api/onboarding-buddy",
  hub: "Team",
  navGroup: "Team",
  metered: true,
  tables: ["onboarding_buddy_pairings", "onboarding_buddy_plan_items"],
  aiTools: [
    {
      name: "onboarding_buddy.pairings",
      description:
        "Read this org's onboarding buddy pairings: which new members are paired with which tenured buddy, pairing status, and first-week plan progress.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
