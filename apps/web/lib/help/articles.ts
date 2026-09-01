/**
 * In-app Help / Docs — static tutorials for Soft-UI surfaces.
 * Short, scannable, accurate to real UI. Never DEMO metrics.
 *
 * Accuracy rules:
 * - Every article maps to something a member can actually reach (deep-link
 *   checked against the app tree in help.test.ts).
 * - Pricing copy is composed from `@vantage/billing/catalog` so it cannot
 *   drift from what billing actually charges (also guarded by a test).
 * - Setup-required integrations are described as setup-required, never as
 *   already working.
 */

import {
  CATALOG_SERVICE_MULTIPLIER,
  PRICING_CATALOG,
  TEAM_TRIAL_DAYS,
} from "@vantage/billing/catalog";

export type HelpCategoryId =
  | "getting-started"
  | "competition"
  | "team"
  | "build"
  | "business"
  | "media"
  | "ai-models"
  | "billing-plans"
  | "account-access"
  | "integrations"
  | "admin-owner";

export type HelpCategory = {
  id: HelpCategoryId;
  label: string;
  /** One line under the group heading on /help. */
  blurb: string;
};

/** Ordered — mirrors the six product hubs plus the cross-cutting topics. */
export const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: "getting-started",
    label: "Getting started",
    blurb: "From a fresh workspace to your first event — navigation, Home, and imports.",
  },
  {
    id: "competition",
    label: "Competition",
    blurb: "Scouting, event day, strategy, and alliance selection.",
  },
  {
    id: "team",
    label: "Team",
    blurb: "The shared library, your personal kit, and everyday team surfaces.",
  },
  {
    id: "build",
    label: "Build",
    blurb: "Code review, coding-agent setup, and robot tooling.",
  },
  {
    id: "business",
    label: "Business",
    blurb: "Season money, reimbursements, sponsors, and funding.",
  },
  {
    id: "media",
    label: "Media",
    blurb: "Content workspace and the photo / video library.",
  },
  {
    id: "ai-models",
    label: "AI & models",
    blurb: "Keys, Automode, local models, and the subscription bridge.",
  },
  {
    id: "billing-plans",
    label: "Billing & plans",
    blurb: "The plan ladder, hosted credits, and spend controls.",
  },
  {
    id: "account-access",
    label: "Account & access",
    blurb: "Invites, roles, and what each member can see.",
  },
  {
    id: "integrations",
    label: "Integrations & connectors",
    blurb: "TBA, Onshape, GitHub, chat bridges, and self-hosted storage.",
  },
  {
    id: "admin-owner",
    label: "Admin & owner",
    blurb: "Running the workspace: provisioning, roles, and team configuration.",
  },
];

const CATEGORY_LABELS = new Map(HELP_CATEGORIES.map((c) => [c.id, c.label]));

export function helpCategoryLabel(id: HelpCategoryId): string {
  return CATEGORY_LABELS.get(id) ?? id;
}

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
  /** Category on the hub — one of HELP_CATEGORIES. */
  category: HelpCategoryId;
  /** Extra terms for Cmd+K / /api/search (title + summary are always indexed). */
  keywords: string[];
  /** Deep link into the live product surface this article is about. */
  relatedHref: string;
  sections: HelpSection[];
};

// Pricing strings composed from the billing catalog — the numbers in these
// constants are the same objects checkout reads, so help can never disagree.
const P = PRICING_CATALOG;
const LADDER_LINE =
  `Free $${P.free.monthlyUsd} · Pro $${P.pro.monthlyUsd}/mo · ` +
  `Pro+ $${P.pro_plus.monthlyUsd}/mo · Max $${P.max.monthlyUsd}/mo.`;
const ALLOWANCE_LINE =
  `Hosted AI allowances per month: Free $${P.free.includedAllowanceUsd} (budget-class models only), ` +
  `Pro $${P.pro.includedAllowanceUsd}, Pro+ $${P.pro_plus.includedAllowanceUsd}, ` +
  `Max $${P.max.includedAllowanceUsd} — all on frontier models for the paid rungs.`;

export const HELP_ARTICLES: HelpArticle[] = [
  // ----------------------------------------------------------- Getting started
  {
    id: "getting-started",
    slug: "getting-started",
    title: "Set up a new team, start to first event",
    summary:
      "Workspace → invite members → pick how AI is powered → import your old data → connect TBA for your first event.",
    category: "getting-started",
    keywords: [
      "getting started",
      "new team",
      "setup",
      "first event",
      "onboarding",
      "checklist",
      "rookie",
      "start here",
      "provision",
    ],
    relatedHref: "/team/getting-started",
    sections: [
      {
        heading: "1 · Get a workspace",
        body: [
          "Access is closed: a platform admin provisions each team and its owner, or — when your FRC team number is not claimed yet — an owner can self-serve it at /claim with a verified email.",
          "Everyone else joins by invite. There is no open sign-up; unknown emails land on the waitlist.",
        ],
      },
      {
        heading: "2 · Invite your people",
        body: [
          "Owners and admins invite exact emails from Team admin (/team/admin) with a role per person.",
          "The live Getting started checklist (/team/getting-started) tracks members, calendar, knowledge, and setup signals as you go.",
        ],
      },
      {
        heading: "3 · Decide how AI is powered",
        body: [
          "Every feature works on every plan — the choice is only where model calls run.",
          "Bring your own key or a local model at /team/ai-keys (free, unlimited by Vantage; you pay your provider).",
          "Use the hosted allowance included with your plan — no keys needed.",
          "Or pair one member's Claude Pro/Max or ChatGPT subscription as a bridge at /team/ai-bridge for $0 API cost.",
        ],
      },
      {
        heading: "4 · Bring your old data",
        body: [
          "Import calendars, scouting data, hours, tasks, notes, and your roster at /migrate — preview first, commit second.",
          "Dual-run your old tool for a week before switching off.",
        ],
      },
      {
        heading: "5 · First event",
        body: [
          "Connect The Blue Alliance under Team → Data (/team/data) and pick your active event — schedules, rankings, and match cards stay empty until then.",
          "Publish a scouting form (Competition → Scouting → Forms) before day one so scouts have something to fill.",
        ],
      },
    ],
  },
  {
    id: "team-basics",
    slug: "team-basics",
    title: "Calendar, Chat, People, Work, and Playbook",
    summary:
      "The Team hub's five workbenches: where meetings, messages, attendance, tasks, and the team wiki live.",
    category: "getting-started",
    keywords: [
      "team hub",
      "calendar",
      "chat",
      "messages",
      "attendance",
      "todos",
      "tasks",
      "playbook",
      "wiki",
      "subteams",
    ],
    relatedHref: "/team",
    sections: [
      {
        heading: "Calendar and Chat",
        body: [
          "Calendar holds practices, build sessions, and deadlines, scoped by subteam, with repeat rules for recurring meetings.",
          "Chat is the org-scoped team channel plus private messages — people appear once they accept an invite.",
        ],
      },
      {
        heading: "People and Work",
        body: [
          "People is one-tap attendance against the real roster; the Hours kiosk (/hours) lets students scan themselves in.",
          "Work is the shared action-item list — task board, standup, season plan, and shop tools nest under it.",
        ],
      },
      {
        heading: "Playbook",
        body: [
          "Playbook is the team wiki with page history. The Season roadmap, Bring your season importer, and the Team Library are pinned at its front.",
          "Everything is org-scoped: pick a team workspace first, and empty stays empty until someone writes real rows.",
        ],
      },
    ],
  },
  {
    id: "bottom-island",
    slug: "bottom-island",
    title: "Customize the bottom island",
    summary:
      "Four apps sit in a floating island at the bottom — Home, Compete, Team, and Business by default.",
    category: "getting-started",
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
    id: "edit-home",
    slug: "edit-home",
    title: "Edit Home — drag, remove, add widgets",
    summary:
      "Your Home layout is personal. Live widgets show on the board; empty cards stay hidden until Edit Home.",
    category: "getting-started",
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
        heading: "What you see",
        body: [
          "Home shows widgets that have real data — next match stays as the hero even when nothing is scheduled yet.",
          "Empty Setup cards stay off the board so Home is not a wall of placeholders. Tap Edit Home to add widgets or see every card.",
        ],
      },
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
    id: "migrate",
    slug: "migrate",
    title: "Import from other tools (Bring your season)",
    summary:
      "One source at a time: calendars, scouting exports, hours, Trello, Notion, and your STIMS roster — preview real rows, then commit.",
    category: "getting-started",
    keywords: [
      "import",
      "migrate",
      "bring your season",
      "ics",
      "csv",
      "qrscout",
      "purple standard",
      "scoutradioz",
      "trello",
      "notion",
      "stims",
      "roster",
      "switch tools",
    ],
    relatedHref: "/migrate",
    sections: [
      {
        heading: "What can come in",
        body: [
          "Calendar: an .ics URL or pasted .ics text from Google / Outlook / Apple Calendar.",
          "Scouting: The Purple Standard JSON, a QRScout config.json plus scanned payloads, a Scoutradioz raw export, or any scouting CSV with a header row (save the column mapping as a preset).",
          "People and tasks: an hours CSV (Lookout, GrizzlyTime, sign-in sheets), a Trello board JSON, Notion database JSON, and the STIMS roster CSV — which becomes a reviewed invite list, never auto-sent invites.",
        ],
      },
      {
        heading: "Preview, then commit",
        body: [
          "Every source shows the real rows it parsed before anything is written. An empty preview means the file had nothing readable — nothing is invented.",
          "Rows the parser declined are always listed with the reason; a silent drop is treated as a bug.",
          "Notion OAuth pull stays setup-required until the server env is configured — the page says so instead of failing.",
        ],
      },
      {
        heading: "What cannot come in",
        body: [
          "Lovat has no documented export, so there is no Lovat importer — if your instance can produce a CSV, use the Scouting CSV path and map columns by hand.",
          "After committing, dual-run both tools for a week before turning the old one off.",
        ],
      },
    ],
  },

  // --------------------------------------------------------------- Competition
  {
    id: "scouting-offline",
    slug: "scouting-offline",
    title: "Scouting and offline",
    summary:
      "Match and pit forms cache on-device. Outbox syncs when online — coverage stays empty until real rows exist.",
    category: "competition",
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
    id: "event-day-command",
    slug: "event-day-command",
    title: "Event Day and Command",
    summary:
      "Field-side command for the active event. Surfaces stay empty until schedule and ops data are real.",
    category: "competition",
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
          "Competition → Event day, or /command (Soft-UI Event Day).",
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
          "Match checklist, pit displays, and the pre-match briefing hang off the same event context.",
          "If TBA is not connected, connect it under Team → Data before expecting live ranks or match times.",
        ],
      },
    ],
  },
  {
    id: "alliance-season",
    slug: "alliance-season",
    title: "Alliance Selection Desk and Season Planning",
    summary:
      "Live pick board with scout evidence; season goals and milestones from real attendance and build tasks.",
    category: "competition",
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

  // ---------------------------------------------------------------------- Team
  {
    id: "team-library",
    slug: "team-library",
    title: "Team Library — files, folders, and links",
    summary:
      "The team's shared shelf: upload any file (CAD, PDFs, manuals, images), nest folders, add links, and share to everyone or just specific people.",
    category: "team",
    keywords: [
      "library",
      "files",
      "upload",
      "step",
      "dxf",
      "cad files",
      "pdf",
      "manuals",
      "folders",
      "links",
      "share",
      "restricted",
      "resources",
    ],
    relatedHref: "/library",
    sections: [
      {
        heading: "Any file, plus links",
        body: [
          "There is no file-type allowlist: STEP/DXF/F3D CAD, PDFs, vendor manuals, images, zips, and code all upload — up to the honest 100 MB in-database cap per file. Bigger files belong on a paired storage node.",
          "Links are first-class resources too: save an external URL on its own, or attach links to a file (a vendor page next to its STEP, a video next to a manual).",
          "Files get a title from their name, plus optional notes and tags; duplicates are detected by content hash instead of stored twice.",
        ],
      },
      {
        heading: "Folders that nest",
        body: [
          "Create folders inside folders to mirror how your team thinks — CAD by subsystem, manuals by vendor, season by season.",
          "Moving a folder into its own subtree is blocked, so the tree cannot knot itself.",
          "Filter by type (CAD, documents, images, links, archives, code) or search across titles, notes, and tags.",
        ],
      },
      {
        heading: "Who can see what",
        body: [
          "Everything defaults to team-wide. Switch a file or folder to “Only specific members” and pick people to restrict it.",
          "Restricted items stay visible to the creator, the chosen members, and team owners/admins — the sharing panel states the audience exactly.",
          "Anyone on the team can add resources; renaming, moving, re-sharing, and deleting is limited to the creator and owners/admins.",
        ],
      },
      {
        heading: "Where the bytes live",
        body: [
          "Uploads within the cap are stored in the team database. Images preview inline; everything else is a download card that keeps its original filename.",
          "Teams with a self-hosted storage node (/team/storage) can hold large media on their own hardware — see the storage node article.",
        ],
      },
    ],
  },
  {
    id: "my-kit",
    slug: "my-kit",
    title: "My Kit — your personal to-do view",
    summary:
      "One page answering “what do I need right now”: your tasks, events, duties, scout shifts, hours, tools, and money — all linking back to the owning surface.",
    category: "team",
    keywords: [
      "my kit",
      "personal",
      "my tasks",
      "my assignments",
      "my hours",
      "my stuff",
      "what do i do",
      "rsvp",
      "duties",
    ],
    relatedHref: "/my-kit",
    sections: [
      {
        heading: "What it collects",
        body: [
          "Tasks and todos assigned to you, upcoming calendar events with your RSVP, event-day duties, scouting shift assignments, media items you owe, tool loans in your name, and your purchase requests and reimbursements.",
          "Your logged shop hours show with streak and open-session state; learning predictions, skills, and your onboarding track appear when those exist.",
        ],
      },
      {
        heading: "How it behaves",
        body: [
          "My Kit owns no data and writes nothing — every row links to the surface that owns the record, so acting on an item happens in the right place.",
          "Sections are ordered by your subteam focus (a scout sees scouting first, a programmer sees code-adjacent work first).",
          "Empty sections say so honestly, and a section whose backing feature is not in this deployment says that too — those are different states, not the same zero.",
        ],
      },
    ],
  },
  {
    id: "team-invites",
    slug: "team-invites",
    title: "Invite teammates by email",
    summary:
      "Owners and admins send an exact-email invite, copy the link if needed, and the recipient signs in with that address to join.",
    category: "account-access",
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
    id: "hub-access",
    slug: "hub-access",
    title: "Limit hub access for scouts and viewers",
    summary:
      "Owners and admins restrict Soft-UI pillars and tabs per member from Team security — unrestricted by default.",
    category: "account-access",
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

  // --------------------------------------------------------------------- Build
  {
    id: "bugbot-ultra",
    slug: "bugbot-ultra",
    title: "Scan GitHub with Bugbot",
    summary:
      "Connect a robot-code repo, then scan on your subscription or pay Bugbot Ultra ($1 scan, $2 fix, $1 recheck). Findings must quote the source.",
    category: "build",
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
          "Subscription Bugbot uses your workspace AI key or plan allowance (feature coding) — it fully honors BYOK and local models.",
          "Bugbot Ultra is a hosted API priced at $1.00 to scan, $2.00 to propose a fix, and $1.00 to recheck. It does not use your BYO key — it is the one deliberately hosted-only AI feature.",
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
  {
    id: "agent-config",
    slug: "agent-config",
    title: "Team agent config — shared rules for coding agents",
    summary:
      "Author rules, subagents, MCP servers, permissions, and skills once; sync them into every member's Claude Code and Cursor.",
    category: "build",
    keywords: [
      "agent config",
      "claude code",
      "cursor",
      "claude.md",
      "mcp",
      "subagent",
      "skills",
      "permissions",
      "team rules",
      "coding agent",
      "sync",
    ],
    relatedHref: "/team/agent-config",
    sections: [
      {
        heading: "Five item kinds",
        body: [
          "Rules (plain markdown appended to agent context), subagent definitions, MCP server entries, permission snippets, and SKILL.md skills.",
          "Invalid content still saves — never lose a draft — but is badged invalid and excluded from every sync and bundle until fixed.",
          "MCP entries are not secret storage: values that look like real credentials are refused. Use ${PLACEHOLDER} values that each member sets locally.",
        ],
      },
      {
        heading: "Sync into Claude Code and Cursor",
        body: [
          "Run `vantage-cad agent sync` in your repo. For Claude Code it writes .claude/agents, .claude/skills, a team-rules import inside marked lines of CLAUDE.md, and vantage-prefixed .mcp.json entries — idempotent, never touching your own files.",
          "The same sync writes Cursor's native formats: .cursor/rules/vantage/*.mdc, .cursor/skills/vantage/, and vantage-prefixed .cursor/mcp.json entries. Subagents and permissions have no Cursor equivalent, so they are reported as skipped rather than invented.",
          "Permissions are a security change, so they land as a suggested file plus an instruction — never merged into settings automatically.",
        ],
      },
      {
        heading: "Who sees and edits what",
        body: [
          "Members can read; writing needs owner/admin unless the org enables member edits.",
          "Each item can be visible to the entire team or only to specific people you pick.",
          "Every save is versioned with restorable history, and the Vantage in-app agent automatically injects the org's valid rules into its runs — recorded in run provenance.",
          "Custom agents can pull everything as typed JSON from GET /api/agent-config/bundle.",
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ Business
  {
    id: "season-finance",
    slug: "season-finance",
    title: "Season finance desk",
    summary:
      "Plan school funds, fees, grants, sponsors, and fundraisers, then log receipts — totals stay blank until real rows exist.",
    category: "business",
    keywords: [
      "season finance",
      "purchase log",
      "funding sources",
      "school funds",
      "student fees",
      "ledger",
    ],
    relatedHref: "/business?tab=finance",
    sections: [
      {
        heading: "One season money plan",
        body: [
          "Business → Money rolls planned vs received income against planned vs actual spend for the selected season.",
          "Add funding lines for school/district money, student fees, and deposits that are not already in Sponsors, Grants, or Fundraisers.",
        ],
      },
      {
        heading: "Purchase log vs Orders vs Reimbursements",
        body: [
          "Log receipts and cash buys on the purchase log. Amazon / buy-link approvals stay under Orders.",
          "Money a member fronted personally goes through Reimbursements (/reimbursements) — only a claim marked paid counts in the ledger.",
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
    id: "reimbursements",
    slug: "reimbursements",
    title: "Reimbursements — pay members back",
    summary:
      "File a claim with a receipt photo, the treasurer works the approve/deny/paid queue, and only paid claims touch the team ledger.",
    category: "business",
    keywords: [
      "reimburse",
      "reimbursement",
      "pay me back",
      "receipt",
      "expense claim",
      "treasurer",
      "approve",
      "paid",
    ],
    relatedHref: "/reimbursements",
    sections: [
      {
        heading: "Filing a claim",
        body: [
          "Enter the amount, what it was for, and attach a photo of the receipt — phone shots are downscaled in the browser before upload so they land under the size cap even on venue Wi-Fi.",
          "A draft is visible only to you. Submit it when the receipt is attached; withdrawing a submitted claim returns it to draft.",
        ],
      },
      {
        heading: "The treasurer queue",
        body: [
          "Only owners and admins see Approve, Deny, and Mark paid. A denied claim shows the note so the filer can fix and resubmit.",
          "Statuses read plainly: Waiting on treasurer → Approved — not paid yet → Paid.",
        ],
      },
      {
        heading: "Honest money math",
        body: [
          "Only a PAID claim mirrors into the team's finance ledger — an approved-but-unpaid claim is a promise, not cash.",
          "Undoing a payment removes the ledger row in the same transaction, so the balance can never keep money the claim no longer represents.",
          "Budget-vs-actual by category and the one-file season financial report sit on the same page; a category with no budget says so instead of showing a fake percentage.",
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
    category: "business",
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

  // --------------------------------------------------------------------- Media
  {
    id: "media-workspace",
    slug: "media-workspace",
    title: "Media workspace for press and business",
    summary:
      "Top-level Soft-UI Media pillar for calendar, drafts, kit, and impact — empty until real rows exist.",
    category: "media",
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
          "Your actual photos and videos live in the Media library (/media-library), nested under Kit.",
          "Empty states stay empty until you add real data — Vantage never invents DEMO media metrics.",
        ],
      },
    ],
  },
  {
    id: "media-library",
    slug: "media-library",
    title: "Media library — team photos and video",
    summary:
      "Upload the team's photos and clips into albums with honest size caps — 8 MB photos after downscale, 4 MiB videos on the hosted cloud path.",
    category: "media",
    keywords: [
      "media library",
      "photos",
      "videos",
      "album",
      "gallery",
      "pictures",
      "upload photo",
      "clips",
    ],
    relatedHref: "/media-library",
    sections: [
      {
        heading: "Uploading",
        body: [
          "Photos (JPEG/PNG/WebP) are downscaled in the browser before upload and land under the 8 MB in-database cap; hosted-cloud videos (MP4/WebM) are capped at 4 MiB because Vercel rejects larger bodies. Pair a storage node (/team/storage) for clips up to the 100 MB schema ceiling.",
          "Thumbnails and video poster frames are generated on your device; duplicates are caught by content hash instead of stored twice.",
          "Bigger videos belong on a paired storage node (/team/storage) or on YouTube via the Match Video Index.",
        ],
      },
      {
        heading: "Organizing and finding",
        body: [
          "Group items into albums, and filter by album and the details recorded on upload (event, subteam, and where an item came from).",
          "An over-cap upload is refused with the real size and the real cap in the message — nothing is silently compressed server-side.",
        ],
      },
    ],
  },

  // --------------------------------------------------------------- AI & models
  {
    id: "byok-automode",
    slug: "byok-automode",
    title: "BYOK, AI keys, and Automode",
    summary:
      "Anyone can paste personal OpenAI or Anthropic keys. Admins can set team-wide keys. Ollama and LM Studio use an OpenAI-compatible base URL.",
    category: "ai-models",
    keywords: [
      "byok",
      "ai keys",
      "api keys",
      "automode",
      "openai",
      "anthropic",
      "google",
      "openrouter",
      "groq",
      "mistral",
      "ollama",
      "lm studio",
      "local model",
      "routing",
      "bring your own key",
    ],
    relatedHref: "/team/ai-keys",
    sections: [
      {
        heading: "Add keys",
        body: [
          "Go to AI keys (/team/ai-keys). Anyone on the team can save personal keys. Team-wide keys need Manage API keys (owner/admin). Your keys override the team's for your own requests.",
          "OpenAI and Anthropic are on the main page; Google AI Studio and OpenRouter are under More. The optional OpenAI base URL points the OpenAI slot at anything OpenAI-compatible — Groq, Mistral, Cerebras, or Ollama (http://127.0.0.1:11434/v1) and LM Studio (http://127.0.0.1:1234/v1) in your shop.",
          "Cloud Vantage cannot reach localhost on your laptop unless you expose a reachable URL (tunnel or self-hosted gateway).",
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
          "BYOK call estimates live under BYOK usage (/team/ai-usage) — never DEMO totals. BYOK and local calls are metered for visibility but never debited by Vantage.",
          "With no BYOK path configured, calls use your plan's hosted allowance or purchased credits — see Billing & plans.",
          "A teammate's Claude Pro/Max or ChatGPT subscription can also serve the team at $0 API cost — see the subscription bridge article.",
        ],
      },
    ],
  },
  {
    id: "ai-bridge",
    slug: "ai-bridge",
    title: "AI subscription bridge — a member's plan serves the team",
    summary:
      "Pair one member's Claude Pro/Max or ChatGPT subscription on an always-on computer and their plan answers the team's AI at $0 API cost.",
    category: "ai-models",
    keywords: [
      "subscription bridge",
      "ai bridge",
      "claude pro",
      "claude max",
      "claude code",
      "chatgpt",
      "codex",
      "free ai",
      "pairing",
      "coverage",
      "rate limit",
    ],
    relatedHref: "/team/ai-bridge",
    sections: [
      {
        heading: "How it works",
        body: [
          "A member (typically a mentor) who already pays for Claude Pro/Max — which includes the Claude Code CLI — or ChatGPT runs a tiny bridge service on an always-on computer where that CLI is signed in.",
          "The bridge asks for an 8-character pairing code, approved at /team/ai-bridge — pairing is the subscriber's own consent to give, and theirs to revoke. Bridged turns are metered at $0 API cost because they run under the CLI's subscription auth.",
          "Claude Code is the verified path; the ChatGPT/Codex path is experimental and only used when the Codex CLI is actually detected on the machine.",
        ],
      },
      {
        heading: "Chat only, or everything",
        body: [
          "Coverage is chosen per device by the person who paired it. The default, “Interactive chat only”, routes chat, writer, and troubleshooting-coach turns through the bridge; long batch jobs stay on the team's own keys.",
          "Flipping a device to “Everything” routes every AI feature platform-wide — including long jobs like season reports and CAD plans — through the subscription while the device is online. That burns the plan's usage window fastest.",
        ],
      },
      {
        heading: "The honest limits",
        body: [
          "It is that person's subscription on that person's machine — there is no team pool and nothing is unlimited. The provider's consumer terms govern this use; check they fit before pairing.",
          "When the plan rate-limits, Vantage shows the provider's message verbatim and the turn automatically falls back to the team's configured AI keys. Offline or timed-out devices fall back the same way.",
          "A device counts as online while its heartbeat is under 3 minutes old; the team page shows exactly what the machine reported. Revoking a device stops routing to it immediately.",
        ],
      },
    ],
  },
  {
    id: "local-ai",
    slug: "local-ai",
    title: "Run Vantage on local or free AI",
    summary:
      "Point Vantage at Ollama, LM Studio, a LAN box, or a $0 key and every feature still works — with an honest quality notice on smaller models.",
    category: "ai-models",
    keywords: [
      "local ai",
      "ollama",
      "lm studio",
      "free ai",
      "self hosted",
      "lan",
      "openai compatible",
      "base url",
      "quality notice",
      "offline ai",
    ],
    relatedHref: "/team/ai-keys",
    sections: [
      {
        heading: "A supported configuration, not a degraded account",
        body: [
          "A team on a local endpoint gets the same features as a team on a frontier key. What changes is only which endpoint answers, and a one-line quality notice on smaller models.",
          "Configure it under AI → API keys: fill the base URL on an OpenAI-compatible entry — Ollama (http://127.0.0.1:11434/v1), LM Studio (http://127.0.0.1:1234/v1), or a LAN inference box. Local servers ignore the key value.",
          "Personal keys overlay team keys for the same provider, so one member can run their laptop's Ollama while the rest of the team stays on the team key.",
        ],
      },
      {
        heading: "What answers, in order",
        body: [
          "Every request resolves the same way: your personal key → team keys or the OpenAI-compatible connector (Automode or fixed model) → the plan's hosted path → the free-tier pool. If nothing resolves, you get an honest error — never a fabricated answer.",
          "Each surface can show what answered (provider, model, and endpoint origin). Localhost/LAN models carry a plain notice that they are smaller than frontier defaults; unrecognized custom models are described as custom, never assumed bad.",
          "Voice scouting transcription also follows your OpenAI-compatible endpoint when it supports audio; when it does not, the UI says so and degrades to browser speech recognition.",
        ],
      },
      {
        heading: "The exceptions, stated",
        body: [
          "Many features are deterministic on-server compute (metered at $0) and run with no AI key at all.",
          "Bugbot Ultra is the one deliberately hosted-only AI feature — its flat fees run on Vantage's hosted keys, and subscription Bugbot remains fully local/BYOK-capable.",
        ],
      },
    ],
  },

  // ------------------------------------------------------------ Billing & plans
  {
    id: "plans-and-pricing",
    slug: "plans-and-pricing",
    title: "Plans: Free, Pro, Pro+, and Max",
    summary:
      "Every feature ships on every plan, including Free. Plans differ only in how much hosted AI usage is included.",
    category: "billing-plans",
    keywords: [
      "pricing",
      "plans",
      "free",
      "pro",
      "pro+",
      "max",
      "upgrade",
      "hosted ai",
      "allowance",
      "trial",
      "cost",
    ],
    relatedHref: "/pricing",
    sections: [
      {
        heading: "The ladder",
        body: [
          LADDER_LINE,
          "Nothing on Vantage is feature-gated by plan — no locked hubs, no plan-only tools. All paid plans are team-wide (org-scoped billing).",
          `A ${TEAM_TRIAL_DAYS}-day team trial exists too: admin-granted, $${P.team_trial.includedAllowanceUsd} hosted allowance, never auto-charged.`,
        ],
      },
      {
        heading: "What the money buys",
        body: [
          ALLOWANCE_LINE,
          `Hosted usage debits at ${CATALOG_SERVICE_MULTIPLIER}× typical provider list rates — about 25% less than the same call on your own key.`,
          "Free's hosted allowance runs on budget-class models (Mistral Small / Llama-class via the sponsored pool, or OpenRouter's free-model router) — never frontier models. The pricing page says the same.",
        ],
      },
      {
        heading: "BYOK and local on every plan",
        body: [
          "Bring any provider key — OpenAI, Anthropic, Google AI Studio, OpenRouter, Groq, Mistral, or anything OpenAI-compatible — or point Vantage at Ollama / LM Studio. Unlimited by Vantage; you pay your provider directly.",
          "When a hosted allowance runs out, usage hard-stops: buy a credit pack, enable pay-as-you-go with an explicit cap, or keep working on BYOK/local. There is never silent overage.",
        ],
      },
    ],
  },
  {
    id: "credits-vs-free",
    slug: "credits-vs-free",
    title: "Hosted credits, PAYG, and spend controls",
    summary:
      "How the hosted allowance, credit packs, and pay-as-you-go work — hard stops before every metered call, never surprise overage.",
    category: "billing-plans",
    keywords: [
      "credits",
      "credit packs",
      "payg",
      "pay as you go",
      "budgets",
      "spend cap",
      "hosted ai",
      "allowance",
      "usage",
      "hard stop",
    ],
    relatedHref: "/team/budgets",
    sections: [
      {
        heading: "Where hosted usage comes from",
        body: [
          "Every plan includes a monthly hosted AI allowance (see Plans: Free, Pro, Pro+, and Max). Metered features draw from it whenever no BYOK/local path answers first.",
          "Credit packs top the pool up without changing plans; pay-as-you-go continues past the allowance only up to a spend cap you set explicitly.",
        ],
      },
      {
        heading: "Hard stops, not surprises",
        body: [
          "Budgets and caps are checked before each metered call runs, not tallied afterwards — when the pool is empty and no PAYG cap allows more, the call is refused with a clear banner.",
          "Set org spend and token caps under AI → Controls (/team/budgets); watch real usage, funding source, and denials under /team/usage. BYOK estimates live under /team/ai-usage.",
        ],
      },
      {
        heading: "What Free does not invent",
        body: [
          "On Free with nothing configured, hosted calls run on the budget-class pool until its allowance is spent, then features show a clear cutoff state — never fabricated results.",
          "Adding your own key or a local model at /team/ai-keys removes the ceiling entirely; Vantage never bills BYOK or local calls.",
        ],
      },
    ],
  },

  // ------------------------------------------------- Integrations & connectors
  {
    id: "integrations",
    slug: "integrations",
    title: "Connect TBA, Onshape, GitHub, and chat",
    summary:
      "Every integration is setup-required by design: the page shows Connect steps until real credentials exist, and never fakes a connected state.",
    category: "integrations",
    keywords: [
      "integrations",
      "connections",
      "tba",
      "blue alliance",
      "onshape",
      "github",
      "google",
      "discord",
      "slack",
      "setup required",
      "connect",
    ],
    relatedHref: "/account?tab=integrations",
    sections: [
      {
        heading: "Where connections live",
        body: [
          "Account → Integrations lists TBA, Onshape, Google, Discord, Slack, and GitHub with their real status — “Connected” appears only when a working credential row exists.",
          "The Blue Alliance is configured under Team → Data (/team/data); schedules, rankings, and match cards stay empty until it is connected and an active event is picked.",
        ],
      },
      {
        heading: "What each unlocks",
        body: [
          "TBA/Statbotics: match schedules, rankings, EPA-based strategy — read from a shared, rate-limited reference cache.",
          "Onshape OAuth: the CAD workbench and CAD agent. Fusion 360 stays on the local vantage-cad relay.",
          "GitHub: Bugbot repo scans (read-only; never pushes) and code-linked calendar due dates.",
          "Slack (/team/slack) and Discord: optional bridges for team chat and notifications.",
        ],
      },
      {
        heading: "Setup-required is a feature",
        body: [
          "A missing key degrades to a clear “configure X” state rather than a hard failure — that is deliberate across the product.",
          "Nothing pre-fills demo data while unconnected, so a blank surface always means “not connected or nothing real yet”, never “broken”.",
        ],
      },
    ],
  },
  {
    id: "storage-node",
    slug: "storage-node",
    title: "Self-hosted storage node",
    summary:
      "Run a Raspberry Pi (or any Node 20+ box) that stores your team's large files on its own disk — bytes on your hardware, only metadata in the cloud.",
    category: "integrations",
    keywords: [
      "storage node",
      "raspberry pi",
      "self host",
      "self-hosted",
      "disk",
      "quota",
      "pairing",
      "tailscale",
      "cloudflared",
      "large files",
    ],
    relatedHref: "/team/storage",
    sections: [
      {
        heading: "What it is",
        body: [
          "A single dependency-free service file your team runs on an always-on computer — a Pi in the shop is the canonical choice. It holds large binaries (media, exports, scans) so the hosted database never maxes out.",
          "Only metadata (hash, size, type, which node) lives in the cloud; the bytes live on your hardware, content-addressed and verified on every write.",
        ],
      },
      {
        heading: "Pairing and health",
        body: [
          "The node prints an 8-character code; a team owner or admin enters it at /team/storage to pair.",
          "It heartbeats every 60 seconds with real disk stats and an incremental integrity scrub. A gap over 5 minutes shows degraded; over 30 minutes, offline — items on an unreachable node say so with a last-seen time, never faked as available.",
          "The node enforces a disk quota (20 GB by default) and refuses writes past it instead of filling your SD card.",
        ],
      },
      {
        heading: "The networking truth",
        body: [
          "On the same LAN, devices reach the node directly. From anywhere else, the cloud cannot reach a box behind your router — there is no relay.",
          "For remote access, give the node a public URL (Tailscale Funnel or cloudflared are the sane options) and paste it into its card on /team/storage. Until then, remote file requests honestly report the node as unreachable.",
          "Unpair on /team/storage revokes the node's token immediately; wipe its data directory to fully decommission.",
        ],
      },
    ],
  },

  // ------------------------------------------------------------- Admin & owner
  {
    id: "admin-owner",
    slug: "admin-owner",
    title: "Owner & admin guide",
    summary:
      "Provisioning, roles, the last-admin safeguard, security allowlists, and the team-level configuration only owners and admins touch.",
    category: "admin-owner",
    keywords: [
      "owner",
      "admin",
      "roles",
      "claim team",
      "team admin",
      "security",
      "permissions",
      "demote",
      "workspace",
      "audit",
    ],
    relatedHref: "/team/admin",
    sections: [
      {
        heading: "Getting and running a workspace",
        body: [
          "Teams are provisioned by a platform admin, or self-served at /claim when the FRC team number is unclaimed and the claimant's email is verified. Membership is closed: exact-email invites only.",
          "A workspace always keeps at least one owner/admin — demoting the last one is blocked. Until a second admin exists (or for the first 14 days), the UI nudges you to invite a co-admin.",
        ],
      },
      {
        heading: "What only owners/admins can do",
        body: [
          "Invite and role-change members (/team/admin), restrict hubs and tabs per scout/viewer (/team/security), set team-wide AI keys, budgets, and governance, approve storage-node pairings (/team/storage), and edit the funding profile (/team/background).",
          "Restricted Library and agent-config items always stay visible to owners/admins, and finance approvals (orders, reimbursements) are owner/admin actions.",
        ],
      },
      {
        heading: "Housekeeping",
        body: [
          "Exports (/exports) produce audited CSV/ZIP takeout — org-scoped, keys never included.",
          "Billing is org-scoped to the workspace's billing owner; plans and hosted credits are managed from /pricing and AI → Controls.",
        ],
      },
    ],
  },
];

export function getHelpArticle(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((article) => article.slug === slug);
}

/** Canonical article URL. /docs/<slug> stays as an alias so old links keep working. */
export function helpArticleHref(slug: string): string {
  return `/help/${slug}`;
}

/** Articles grouped in HELP_CATEGORIES order (categories with no articles are dropped). */
export function helpArticlesByCategory(
  articles: HelpArticle[] = HELP_ARTICLES,
): Array<{ category: HelpCategory; articles: HelpArticle[] }> {
  return HELP_CATEGORIES.map((category) => ({
    category,
    articles: articles.filter((article) => article.category === category.id),
  })).filter((group) => group.articles.length > 0);
}
