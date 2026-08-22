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
    summary: "Four apps sit in a floating island at the bottom — Home, Compete, Team, and Business by default.",
    category: "Navigation",
    keywords: [
      "island",
      "bottom nav",
      "tabs",
      "personal navigation",
      "customize island",
      "soft-ui",
      "dynamic island",
    ],
    relatedHref: "/dashboard",
    sections: [
      {
        heading: "Four apps, always on",
        body: [
          "The bottom island stays on phone and desktop. It has exactly four apps — not a fifth More dump.",
          "Everything else is in the menu (hamburger) or Search (⌘K).",
        ],
      },
      {
        heading: "Change the four",
        body: [
          "Long-press or right-click the island, or open the menu and tap Customize island.",
          "Tap apps in the order you want them. A selected app shows its slot number. You need exactly four before Save is enabled.",
          "Allowlisted destinations include Home, Compete, Team, Business, Media, Build, AI, Scout, My Day, Logistics, and Messages.",
        ],
      },
      {
        heading: "Save or reset",
        body: [
          "Save 4/4 writes your preference for this account.",
          "Reset restores Home, Compete, Team, and Business.",
        ],
      },
    ],
  },
  {
    id: "team-invites",
    slug: "team-invites",
    title: "Invite teammates by email",
    summary: "Owners and admins send an exact-email invite, copy the link if needed, and the recipient signs in with that address to join.",
    category: "Team",
    keywords: [
      "invite",
      "invitation",
      "members",
      "team admin",
      "add teammate",
      "resend invite",
      "copy invite link",
    ],
    relatedHref: "/team/admin",
    sections: [
      {
        heading: "Send an invite",
        body: [
          "Open Team admin and use Add a teammate. Enter the person's email and role (Scout, Admin, or Viewer).",
          "Send invite creates the row first. If email is configured, they also get a message. You always get a copyable link for that send.",
          "Local development does not send email — copy the link and share it. Re-inviting the same pending email rotates the link instead of stacking duplicates.",
        ],
      },
      {
        heading: "Accepting",
        body: [
          "The recipient opens /invite?token=…, signs in with the invited email, and taps Accept invitation.",
          "Wrong account? Sign out and switch to the invited address. Team numbers never join a workspace by themselves.",
        ],
      },
    ],
  },
  {
    id: "edit-home",
    slug: "edit-home",
    title: "Edit Home — drag, remove, add widgets",
    summary: "Your Home layout is personal. Drag widgets like a Home Screen. Empty widgets stay empty until real data exists.",
    category: "Home",
    keywords: [
      "dashboard",
      "edit home",
      "widgets",
      "customize",
      "drag",
      "remove widget",
      "home screen",
      "personal dashboard",
      "team board",
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
          "Use the Add widgets palette above the board. Drag a tile onto the grid or tap Add. Already-placed widgets stay off the palette.",
          "Tap Done to save your personal Home. Owners and admins can also Save for team — that does not overwrite anyone else's personal layout.",
          "Reset (under More / board tools) restores default home widgets for the active board.",
        ],
      },
      {
        heading: "Your layout vs the team",
        body: [
          "Each member has their own Home. Teammates do not see your widget arrangement unless you open a team board on purpose.",
          "Match scores, scouting coverage, and TBA data stay team-scoped. Only the layout is personal.",
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
          "Build or edit forms under Competition → Scouting → Forms before expecting match/pit sheets.",
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
          "Open Alliance Selection Desk from Competition → Strategy → Alliance desk (/competition?tab=alliance-selection-desk).",
          "Use the live 8-alliance pick board, attach scout evidence, and watch TBA conflict flags against real team_event_metrics.",
          "Drive-team export/print is available when you have a real board — ranks are never DEMO.",
        ],
      },
      {
        heading: "Season Planning Workspace",
        body: [
          "Open Season Planning from Team → Work → Season plan (/team?tab=season-planning-workspace).",
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
  {
    id: "media-workspace",
    slug: "media-workspace",
    title: "Media workspace for press and business",
    summary:
      "Top-level Soft-UI Media pillar for calendar, drafts, kit, and impact — empty until real rows exist.",
    category: "Media",
    keywords: [
      "media",
      "press kit",
      "social",
      "media kit",
      "outreach",
      "content calendar",
      "business media",
      "photos",
      "captions",
      "media pillar",
    ],
    relatedHref: "/media",
    sections: [
      {
        heading: "Open Media",
        body: [
          "Open the Media pillar from the Soft-UI island, drawer, or Cmd+K — search “Media”.",
          "You can also pin Media as one of your four island apps.",
          "Pick a team workspace first — Media is org-scoped like other Soft-UI tools.",
        ],
      },
      {
        heading: "What the tiles mean",
        body: [
          "Kit readiness and asset counts come from Media Kit profile fields and uploaded URLs.",
          "Upcoming outreach and “tagged media” come from calendar events you scheduled.",
          "Media impact and people reached come only from Community Impact rows with category media.",
          "Content items are drafts and posts you created here — never invented logos or reach.",
        ],
      },
      {
        heading: "Where to edit",
        body: [
          "Use Calendar for press days and demos; Drafts for captions and AI-assisted posts (metered).",
          "Use Kit for bios, logos, and one-pagers; Impact to review logged media outreach.",
          "Empty states stay empty until you add real data — Vantage never invents DEMO media metrics.",
        ],
      },
    ],
  },
  {
    id: "hub-access",
    slug: "hub-access",
    title: "Limit hub access for scouts and viewers",
    summary:
      "Owners and admins restrict Soft-UI pillars and tabs per member from Team security — unrestricted by default.",
    category: "Team",
    keywords: [
      "hub access",
      "section access",
      "acl",
      "allowlist",
      "restrict tabs",
      "scout access",
      "viewer access",
      "team security",
    ],
    relatedHref: "/team/security",
    sections: [
      {
        heading: "Where to configure",
        body: [
          "Open Team → Team security (or search “hub access”).",
          "Scroll to Hub access under authentication policy and capabilities.",
          "Only scouts and viewers can be restricted. Owners and admins stay unrestricted.",
        ],
      },
      {
        heading: "How allowlists work",
        body: [
          "With no hubs checked, the member is unrestricted (sees every pillar).",
          "Check a hub to allow it. Leave its tabs unchecked for full access inside that hub.",
          "Checking any tab limits the member to those tabs only — empty tab selection means every tab.",
          "Clear all hubs and save to restore unrestricted navigation.",
        ],
      },
      {
        heading: "What members see",
        body: [
          "Hidden hubs disappear from the island, drawer, and Cmd+K for that member.",
          "Always-available paths like Home, Account, Help, and notifications stay reachable.",
        ],
      },
    ],
  },
  {
    id: "funding-profile",
    slug: "funding-profile",
    title: "Team funding profile and sponsor tools",
    summary:
      "Affiliation and funding paths shape Business Soft-UI — teams that disallow sponsors hide sponsor destinations.",
    category: "Business",
    keywords: [
      "funding",
      "affiliation",
      "school funded",
      "outside grants",
      "sponsors allowed",
      "private school",
      "funding profile",
      "hide sponsors",
    ],
    relatedHref: "/team/background",
    sections: [
      {
        heading: "Set during onboarding",
        body: [
          "Owners and admins choose affiliation (private school, public school, or community) and at least one funding path: school funds, outside grants, or sponsors allowed.",
          "Many private schools self-fund and disallow outside sponsors — uncheck Sponsors allowed when that matches your team.",
        ],
      },
      {
        heading: "What changes in Soft-UI",
        body: [
          "When Sponsors allowed is off, Business hub tabs and drawer links for Sponsor Wall, Suite, Matching Gift Finder, and related tools stay hidden.",
          "Grants, budget, awards, and Media stay available when those funding paths apply.",
        ],
      },
      {
        heading: "Update later",
        body: [
          "Owners and admins can change affiliation and funding paths under Team → Background after onboarding.",
          "Changes apply to navigation immediately for the workspace — no DEMO sponsor rows are invented either way.",
        ],
      },
    ],
  },
  {
    id: "season-finance",
    slug: "season-finance",
    title: "Season finance desk",
    summary:
      "Plan school funds, fees, grants, sponsors, and fundraisers, then log receipts — totals stay blank until real rows exist.",
    category: "Business",
    keywords: [
      "season finance",
      "purchase log",
      "funding sources",
      "reimbursement",
      "school funds",
      "student fees",
      "ledger",
    ],
    relatedHref: "/business?tab=finance",
    sections: [
      {
        heading: "One season money plan",
        body: [
          "Business → Finance rolls planned vs received income against planned vs actual spend for the selected season.",
          "Add funding lines for school/district money, student fees, and deposits that are not already in Sponsors, Grants, or Fundraisers.",
        ],
      },
      {
        heading: "Purchase log vs Orders",
        body: [
          "Log receipts, cash buys, and reimbursements on the purchase log. Amazon / buy-link approvals stay under Orders.",
          "Paid Season Costs and awarded grants still count in the rollup so you do not need a second invented ledger.",
        ],
      },
      {
        heading: "What stays empty",
        body: [
          "KPIs stay at $0 or — until someone records a real source or receipt. Vantage never fills DEMO dollars.",
          "Card and bank numbers are stripped from finance writes. Link a receipt URL instead of pasting account details.",
        ],
      },
    ],
  },
  {
    id: "bugbot-ultra",
    slug: "bugbot-ultra",
    title: "Scan GitHub with Bugbot",
    summary:
      "Connect a robot-code repo, then scan on your subscription or pay Bugbot Ultra ($1 scan, $2 fix, $1 recheck). Findings must quote the source.",
    category: "Build",
    keywords: [
      "bugbot",
      "github",
      "code review",
      "ultra",
      "scan repo",
      "fix diff",
      "recheck",
      "robot code",
    ],
    relatedHref: "/bugbot",
    sections: [
      {
        heading: "Connect GitHub first",
        body: [
          "Owners and admins link a PAT or OAuth app under Team admin. Bugbot never requests workflow scope and never pushes.",
          "On Bugbot, pick the robot-code repo and optionally load one file, or scan the connected tree (.java, .cpp, .py, vendordeps).",
        ],
      },
      {
        heading: "Subscription vs Ultra",
        body: [
          "Subscription Bugbot uses your workspace AI key or plan allowance (feature coding).",
          "Bugbot Ultra is a hosted API priced at $1.00 to scan, $2.00 to propose a fix, and $1.00 to recheck. It does not use your BYO key.",
        ],
      },
      {
        heading: "Fixes stay human-approved",
        body: [
          "A proposed fix is a unified diff you copy. Vantage does not open a pull request or deploy to a robot.",
          "Recheck quotes remaining issues in the current source. Empty findings are not a competition-legal stamp.",
        ],
      },
    ],
  },
];

export function getHelpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}

export function helpArticleHref(slug: string): string {
  return `/docs/${slug}`;
}
