export const manifest = {
  slug: "matching-gift-finder",
  title: "Matching gifts",
  route: "/matching-gift-finder",
  apiRoute: "/api/matching-gift-finder",
  hub: "Business",
  navGroup: "Business",
  metered: true,
  tables: [
    "matching_gift_finder_contacts",
    "matching_gift_finder_programs",
    "matching_gift_finder_pledges",
    "matching_gift_finder_drafts",
  ],
  aiTools: [
    {
      name: "matching_gift_finder.matches",
      description:
        "Read this org's matched-employer list — household-employer contacts joined against tracked matching-gift programs, with pledge status.",
    },
    {
      name: "matching_gift_finder.draft_letter",
      description:
        "Metered: draft an HR matching-gift request email/letter for a contact/program match, grounded only in the contact's and program's recorded data.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
