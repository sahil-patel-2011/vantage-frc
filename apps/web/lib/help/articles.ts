/**
 * In-app Help / Docs — static tutorials for Soft-UI surfaces.
 * Short, scannable, accurate to real UI. Never DEMO metrics.
 */

export type HelpSection = {
  heading: string;
  /** Short paragraphs or bullets (plain text). */
  body: string[];
};

export type HelpArticle = {
  id: string;
  slug: string;
  title: string;
  /** One-line blurb for the hub list and search subtitle. */
  summary: string;
  /** Category chip on the hub. */
  category: string;
  /** Extra terms for Cmd+K / /api/search (title + summary are always indexed). */
  keywords: string[];
  /** Optional deep link into the live product surface. */
  relatedHref: string;
  sections: HelpSection[];
};

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: "bottom-island",
    slug: "bottom-island",
    title: "Customize the bottom island",
    summary: "Pick four apps for the Soft-UI island — Home, Compete, Team, and Business by default.",
    category: "Navigation",
    keywords: [
      "island",
      "bottom nav",
      "tabs",
      "more sheet",
      "personal navigation",
      "customize island",
      "soft-ui",
    ],
    relatedHref: "/dashboard",
    sections: [
      {
        heading: "Open the editor",
        body: [
          "Tap More on the Soft-UI island, then Island (gear).",
          "Or use the drawer / More sheet — the editor is labeled “Choose your four island apps.”",
        ],
      },
      {
        heading: "Pick four apps",
        body: [
          "Tap apps in the order you want them. A selected app shows its slot number.",
          "Tap a selected app again to remove it. You need exactly four before Save is enabled.",
          "Allowlisted destinations include Home, Compete, Team, Business, Build, AI, Scout, My Day, Logistics, and Messages.",
        ],
      },
      {
        heading: "Save or reset",
        body: [
          "Save 4/4 writes your preference for this account.",
          "Reset default restores Home, Compete, Team, and Business.",
          "Footer links jump to Customize dashboard and Build scouting forms when you need those instead.",
        ],
      },
    ],
  },
  {
    id: "edit-home",
    slug: "edit-home",
    title: "Edit Home — drag, remove, add widgets",
    summary: "Rearrange the dashboard like a Home Screen. Empty widgets stay empty until real data exists.",
    category: "Home",
    keywords: [
      "dashboard",
      "edit home",
      "widgets",
      "customize",
      "drag",
      "remove widget",
      "home screen",
      "customize=1",
    ],
    relatedHref: "/dashboard?customize=1",
    sections: [
      {
        heading: "Enter edit mode",
        body: [
          "On Home (/dashboard), tap Edit Home.",
          "You can also open /dashboard?customize=1 — it enters edit mode and cleans the query from the URL.",
        ],
      },
      {
        heading: "Rearrange and remove",
        body: [
          "Drag cards by the grip handle. Resize from a corner when the layout allows it.",
          "Tap Remove on a card to take it off the board. Nothing invents ranks, EPA, or match times while you edit.",
        ],
      },
      {
        heading: "Add widgets",
        body: [
          "Use the Add widgets palette above the board. Already-placed widgets stay off the palette.",
          "Tap Done when finished. Reset (under More / board tools) restores default home widgets for the active board.",
        ],
      },
    ],
  },
  {
    id: "scouting-offline",
    slug: "scouting-offline",
    title: "Scouting and offline",
    summary: "Match and pit forms cache on-device. Outbox syncs when online — coverage stays empty until real rows exist.",
    category: "Competition",
    keywords: [
      "scouting",
      "offline",
      "outbox",
      "indexeddb",
      "sync",
      "form builder",
      "coverage",
      "offline shell",
      "venue",
    ],
    relatedHref: "/competition?tab=scouting",
    sections: [
      {
        heading: "Where to scout",
        body: [
          "Open Competition → Scouting, or the Scouting Hub route under Competition.",
          "Build or edit forms under Competition → Form builder before expecting match/pit sheets.",
        ],
      },
      {
        heading: "Offline and sync",
        body: [
          "Entries and media queue in this device’s org-isolated outbox when the network drops.",
          "The Online/Offline pill and Sync now button show real outbox counts — never DEMO entries.",
          "Use Offline Shell (/offline-shell) or the cold /offline boot page to reopen scouting after a prior visit.",
        ],
      },
      {
        heading: "Coverage and handoff",
        body: [
          "Lineup & Coverage stays blank until real scout rows exist.",
          "Device handoff merges pending IndexedDB outbox rows (last write wins) — sync when the venue link stabilizes.",
        ],
      },
    ],
  },
  {
    id: "byok-automode",
    slug: "byok-automode",
    title: "BYOK, AI keys, and Automode",
    summary: "Owners/admins paste OpenAI, Anthropic, Google, or local OpenAI-compatible keys. Automode routes by task toughness.",
    category: "AI",
    keywords: [
      "byok",
      "ai keys",
      "api keys",
      "automode",
      "openai",
      "anthropic",
      "google",
      "local model",
      "routing",
      "bring your own key",
    ],
    relatedHref: "/team/ai-keys",
    sections: [
      {
        heading: "Add keys",
        body: [
          "Go to AI API keys (/team/ai-keys). Owners and admins with Manage API keys can paste or remove secrets.",
          "Supported providers: OpenAI, Anthropic, Google, and a local OpenAI-compatible server connector.",
        ],
      },
      {
        heading: "Fixed vs Automode",
        body: [
          "Fixed model pins every call to one enabled model.",
          "Automode picks from your enabled pool by task toughness: CAD and Code → high reasoning; Strategy → strong mid; light chat → fast models.",
          "Enable at least one model in the Automode pool before saving Automode.",
        ],
      },
      {
        heading: "Usage and hosting",
        body: [
          "BYOK call estimates live under BYOK usage (/team/ai-usage) — never DEMO totals.",
          "When no BYOK path is configured, hosted metering still applies on plans that include hosted AI or purchased credits.",
        ],
      },
    ],
  },
  {
    id: "event-day-command",
    slug: "event-day-command",
    title: "Event Day and Command",
    summary: "Field-side command for the active event. Surfaces stay empty until schedule and ops data are real.",
    category: "Competition",
    keywords: [
      "event day",
      "command",
      "my day",
      "field",
      "pit",
      "match schedule",
      "competition hub",
      "ops",
    ],
    relatedHref: "/competition?tab=command",
    sections: [
      {
        heading: "Open Command",
        body: [
          "Competition → Command, or /command (Soft-UI Event Day).",
          "Select a workspace and active event first — Command will not invent a schedule.",
        ],
      },
      {
        heading: "What you get",
        body: [
          "Field-side ops for the current event: next actions, travel/lodging clarity when logged, and cross-links to My Day, Schedule, Strategy, and Logistics.",
          "My Day (/competition?tab=my-day) focuses on now/next match for you — also empty until real match rows exist.",
        ],
      },
      {
        heading: "Related tools",
        body: [
          "Match checklist, pit displays, and Event-Day stress planner hang off the same event context.",
          "If TBA is not connected, connect it under Team data before expecting live ranks or match times.",
        ],
      },
    ],
  },
  {
    id: "alliance-season",
    slug: "alliance-season",
    title: "Alliance Selection Desk and Season Planning",
    summary: "Live pick board with scout evidence; season goals and milestones from real attendance and build tasks.",
    category: "Competition · Team",
    keywords: [
      "alliance selection",
      "pick list",
      "pick desk",
      "alliance desk",
      "season planning",
      "milestones",
      "goals",
      "ics",
    ],
    relatedHref: "/alliance-selection-desk",
    sections: [
      {
        heading: "Alliance Selection Desk",
        body: [
          "Open Alliance Selection Desk from Competition More tools (/alliance-selection-desk).",
          "Use the live 8-alliance pick board, attach scout evidence, and watch TBA conflict flags against real team_event_metrics.",
          "Drive-team export/print is available when you have a real board — ranks are never DEMO.",
        ],
      },
      {
        heading: "Season Planning Workspace",
        body: [
          "Open Season Planning from Team More tools (/season-planning-workspace).",
          "Map goals → milestones → owners, with optional ICS calendar hooks.",
          "Progress comes from real attendance and build_tasks only — completion % stays blank without those rows.",
        ],
      },
    ],
  },
  {
    id: "credits-vs-free",
    slug: "credits-vs-free",
    title: "Credits vs Free",
    summary: "Free is competition core with your own keys. Buy AI credits for hosted usage; Individual/Team add hosted AI in-product.",
    category: "Billing",
    keywords: [
      "credits",
      "free plan",
      "pricing",
      "hosted ai",
      "payg",
      "budgets",
      "individual",
      "team plan",
      "billing",
    ],
    relatedHref: "/pricing",
    sections: [
      {
        heading: "Free",
        body: [
          "Free includes offline scouting, reference data, manual strategy, and pick lists.",
          "Add your own keys at /team/ai-keys for BYOK, or buy AI credits when you want hosted calls without upgrading.",
        ],
      },
      {
        heading: "Credits and paid plans",
        body: [
          "AI credits power hosted usage inside scouting, strategy, Event Day, CAD, and Assistant.",
          "Individual and Team plans add hosted AI in the product. When you need more, buy credits or enable PAYG with an explicit spend cap — hard cutoffs, no surprise overage.",
          "Compare plans on /pricing; manage budgets under AI → Budgets or /team/budgets.",
        ],
      },
      {
        heading: "What Free does not invent",
        body: [
          "Managed Assistant and other hosted AI stay unavailable until you add keys, credits, or a paid entitlement.",
          "Product surfaces still show empty/setup states — never fabricated DEMO metrics to fill the gap.",
        ],
      },
    ],
  },
];

export function getHelpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}

export function helpArticleHref(slug: string): string {
  return `/help/${slug}`;
}
