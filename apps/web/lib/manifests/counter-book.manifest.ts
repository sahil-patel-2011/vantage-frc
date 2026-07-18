export const manifest = {
  slug: "counter-book",
  title: "Opponent Counter-book",
  route: "/counter-book",
  apiRoute: "/api/counter-book",
  hub: "Competition",
  navGroup: "Competition",
  metered: true,
  tables: ["counter_book_reports"],
  aiTools: [
    {
      name: "counter_book.reports",
      description: "Read this org's generated opponent counter-books (tendencies, failure triggers, counter plan) for a team key.",
    },
  ],
  exportAdapters: [],
  placeholderRoute: false,
} as const;
