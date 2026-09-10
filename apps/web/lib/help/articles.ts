/**
 * In-app Help / Docs — static tutorials for Vantage surfaces.
 * Short, scannable, accurate to real UI. Empty until you add real numbers.
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
          "Chat is the team's channel plus private messages — people appear once they accept an invite.",
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
          "Everything belongs to this team: pick a workspace first, and empty stays empty until someone writes real rows.",
        ],
      },
    ],
  },
  {
    id: "bottom-island",
    slug: "bottom-island",
    title: "Customize the bottom island",
    summary:
      "Four apps sit in a floating island at the bottom — Home, Compete, Team, and Build by default.",
    category: "getting-started",
    keywords: [
      "island",
      "bottom nav",
      "tabs",
      "personal navigation",
      "customize island",
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
          "Reset restores Home, Compete, Team, and Build.",
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
          "On a laptop, drag cards by the grip handle. Resize from a corner when the layout allows it.",
          "On a phone, tap a widget in the gallery, then tap an empty slot on the board to place it. That is the same idea as adding a widget on an iPhone.",
          "Tap Remove on a card to take it off the board.",
        ],
      },
      {
        heading: "Student vs mentor Home",
        body: [
          "A new student sees next match, My day, Learn, tasks, recent files, chat, and Ask AI.",
          "A mentor sees next match, duties that need a person, budget and part requests, attendance tonight, outreach hours, and announcements waiting on a read.",
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
          "Every source shows the real rows it parsed before anything is written. An empty preview means the file had nothing readable.",
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
          "The Online/Offline pill and Sync now button show real outbox counts.",
          "Open This phone (/offline-shell) or the cold /offline page to reopen Scouting after a prior visit.",
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
          "Competition → Event day, or /command (Vantage Event Day).",
          "Select a workspace and active event first. Command stays blank until the schedule is saved.",
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
          "Drive-team export/print is available when you have a real board — ranks come from that board.",
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
    id: "files",
    slug: "files",
    title: "Files — the team drive and your own space",
    summary:
      "Every member gets a private space; the team gets a shared one. Upload anything, make folders, share by link or to an email address.",
    category: "team",
    keywords: ["files", "drive", "upload", "share", "link", "video", "flyer", "pdf", "personal", "my files", "shared with me"],
    relatedHref: "/files",
    sections: [
      {
        heading: "Two spaces",
        body: [
          "My files is yours. Mentors and owners cannot open it — that is enforced in the database, not just hidden in the page.",
          "Team files is everyone's. Any member can add to it; the uploader or an owner/admin can remove a file.",
          "Media Library, CAD Vault and the older Team Library show inside Team files as their own folders, so there is one place to look.",
        ],
      },
      {
        heading: "Sharing",
        body: [
          "Share creates a link anyone can open, or sends the file to specific email addresses with a note. Set an expiry, choose view or download, and revoke any share later.",
          "A share of a personal file is a deliberate act by its owner; nobody else can create one.",
          "Shared with me lists what others have sent to your address.",
        ],
      },
      {
        heading: "Where the bytes go",
        body: [
          "Small files are stored in Vantage. Large files go to your team's storage node if one is paired, or to object storage once your deployment has it configured — the upload dialog tells you which.",
        ],
      },
    ],
  },
  {
    id: "team-profile",
    slug: "team-profile",
    title: "Team profile — what the public record says about your team",
    summary:
      "Built the first time an owner or admin opens it: where you are from, rookie year, seasons competed, awards, recent events, EPA and ranks — from The Blue Alliance and Statbotics.",
    category: "team",
    keywords: ["team profile", "dossier", "rookie year", "awards", "epa", "rank", "statbotics", "blue alliance", "history"],
    relatedHref: "/team/profile",
    sections: [
      {
        heading: "What it knows, and from where",
        body: [
          "Profile, seasons and awards come from The Blue Alliance. Career and per-season EPA and world / country / state ranks come from Statbotics.",
          "Anything a source does not have reads 'not on record'. If one source did not answer, the page says which.",
          "Nobody scrapes your roster: no public source knows who is on your team. The people counts are your own memberships.",
        ],
      },
      {
        heading: "Why it matters",
        body: [
          "Every Ask AI answer starts from these facts, so 'how did our season go' is answered from the record rather than guessed.",
          "It refreshes weekly on its own. Rebuild now is on the page for owners and admins.",
        ],
      },
    ],
  },
  {
    id: "calendar-tasks-and-find-a-time",
    slug: "calendar-tasks",
    title: "Calendar — tasks on the calendar and Find a time",
    summary:
      "Tasks with a due date sit on the calendar and can be ticked off there. Find a time suggests meeting slots from when your team actually turns up.",
    category: "team",
    keywords: ["calendar", "tasks", "todo", "due", "find a time", "schedule", "meeting", "build night", "attendance"],
    relatedHref: "/team?tab=calendar",
    sections: [
      {
        heading: "Tasks on the calendar",
        body: [
          "Open tasks with a due date appear in the all-day row, in month cells, and in the list. Tick the box to mark one done; it goes through the same task list as Work.",
          "Quick add switches between Event and Task, so a deadline can be written down where you noticed it.",
          "If venue Wi-Fi dies, the last calendar stays on screen. Ticking a date or adding one saves on this phone and uploads when you are back online. Seeding a whole season template still needs a connection. For kickoff-relative milestones, see Season calendar.",
        ],
      },
      {
        heading: "Find a time",
        body: [
          "Describe what you need in a sentence — 'a two hour build session next week for mechanical'. The suggestions come from your own past sessions, RSVPs and attendance, and are checked against the calendar for clashes; each one shows why it was suggested.",
          "It needs at least three past sessions before it will call something a pattern. With no history it says so instead of guessing.",
          "Nothing is added to the calendar until you pick a slot and press Add.",
        ],
      },
    ],
  },
  {
    id: "season-calendar",
    slug: "season-calendar",
    title: "Season calendar",
    summary:
      "Kickoff-relative dates for the build season. The last list stays on this phone; ticking or adding a date uploads when you reconnect. Seeding a whole template needs a connection.",
    category: "team",
    keywords: [
      "season calendar",
      "kickoff",
      "milestones",
      "build season",
      "offline calendar",
      "season board",
    ],
    relatedHref: "/calendar",
    sections: [
      {
        heading: "What you see",
        body: [
          "Dates counted from kickoff: bag day, first event, stop-build, and the other season markers your team added.",
          "If venue Wi-Fi dies, a quiet bar says you are looking at the copy saved on this phone. The same list stays up.",
        ],
      },
      {
        heading: "What to do",
        body: [
          "Open Season calendar once on venue Wi-Fi so it caches. Tick a date done or add one — those changes wait on this phone and send when you reconnect.",
          "Adding a whole season template still needs a connection — wait until you are back online.",
        ],
      },
    ],
  },
  {
    id: "outreach-by-person",
    slug: "outreach-by-person",
    title: "Outreach hours by person",
    summary:
      "Log an outreach event once and name everyone who helped, each with their own minutes. The By-person table adds it up for awards, grants and the students themselves.",
    category: "business",
    keywords: ["outreach", "impact", "hours", "volunteer", "who helped", "community", "award evidence"],
    relatedHref: "/impact",
    sections: [
      {
        heading: "Logging",
        body: [
          "Anyone on the team can log an activity and tick the people who were there. Minutes prefill from the event's length and can be changed per person.",
          "Leave minutes blank if you do not know — it shows as 'not recorded' rather than counting as zero or as the whole event.",
          "Team members (count) is the headline number and may be larger than the named list; a parent volunteer without an account still counts.",
        ],
      },
      {
        heading: "Per-person totals",
        body: [
          "Hours are each person's own recorded minutes across the season. Add people to an activity later with Add people on its row.",
        ],
      },
    ],
  },
  {
    id: "parts-catalog",
    slug: "parts-catalog",
    title: "Parts catalog — what to order and what it is called",
    summary:
      "A curated list of the COTS parts FRC teams buy — motors, control, pneumatics, hardware, stock, drive, bearings, batteries, tools — with the spec that picks one over its neighbour.",
    category: "business",
    keywords: ["parts", "catalog", "order", "cots", "neo", "spark max", "bearing", "hex shaft", "box tube", "nyloc", "vendor"],
    relatedHref: "/parts-catalog",
    sections: [
      {
        heading: "Using it",
        body: [
          "Search by the words you would say — 'nyloc', '1x1 tube', 'hex bearing'. Parts already in your inventory are marked.",
          "Add to inventory creates the stock row with name, vendor, part number, unit and a suggested reorder point, at 0 on hand — set the real count on Inventory.",
          "Request it opens Part requests with the item and the vendor link filled in; a mentor approves it against the season budget.",
        ],
      },
      {
        heading: "What it deliberately does not do",
        body: [
          "No prices: they change monthly and a stale price looks authoritative. The vendor link is the price.",
          "Part numbers only where they are certain; otherwise the vendor link searches by name.",
        ],
      },
    ],
  },
  {
    id: "assembly-manual",
    slug: "assembly-manual",
    title: "Assembly manual — a build book from your CAD",
    summary:
      "Point it at your Onshape assembly and it produces a step-by-step build book: parts per step, cut and drill and tap lines, pictures, a materials list, and a PDF.",
    category: "build",
    keywords: ["assembly", "manual", "build book", "instructions", "lego", "onshape", "pdf", "cut list", "bom"],
    relatedHref: "/assembly-manual",
    sections: [
      {
        heading: "How a run works",
        body: [
          "An owner or admin starts a run from a CAD vault document with an Onshape link, or by pasting one. The job runs on your team's relay and checkpoints as it goes, so a long robot can take hours and survive a restart.",
          "Two different ordering strategies are run and reconciled; every step is checked for feasibility (a part must be reachable, fasteners follow the parts they join). Disagreements are listed in the run report.",
        ],
      },
      {
        heading: "What it will and will not say",
        body: [
          "Every cut, drill and tap line traces to a feature in the CAD. Where the CAD does not specify something — a tube drawn at nominal length, a hole with no thread — the line says 'confirm — not specified in CAD' instead of guessing.",
          "Per-step pictures come from Onshape renders. If a partial-assembly render is not possible the step shows a per-part picture and says so under it.",
          "Model with named parts, hole features with callouts, and stock at cut length to get the most complete book. See docs/ASSEMBLY_MANUAL.md for the modelling guide.",
        ],
      },
    ],
  },
  {
    id: "learn-cad-naming",
    slug: "cad-naming",
    title: "Naming CAD parts so the next person can find them",
    summary:
      "Subsystem · What it is · Which one. 'New Part 1' costs a team hours in March; a name is the cheapest documentation there is.",
    category: "build",
    keywords: ["cad", "naming", "onshape", "part names", "new part 1", "learn cad", "convention"],
    relatedHref: "/cad-learn",
    sections: [
      {
        heading: "The pattern",
        body: [
          "DT — Swerve module plate — FL. Intake — Side plate — L. Elevator — Carriage bearing block. Climber — Hook — Rev B.",
          "Name the part the moment you make it, name Part Studios for the group of parts they hold, and name the sketches that drive other features.",
          "Never a date, a person's name, or 'new' / 'final'. The version history already knows who and when.",
        ],
      },
      {
        heading: "Why it matters beyond tidiness",
        body: [
          "The assembly manual, the bill of materials and CAD review read names straight from the document. 'Part 1' becomes a manual step that says 'attach Part 1 to Part 2'.",
          "The full lesson, with practice and a check, is in Learn CAD.",
        ],
      },
    ],
  },
  {
    id: "ask-ai",
    slug: "ask-ai",
    title: "Ask AI — what it can answer, and from what",
    summary:
      "One button on every page. It answers from your team's data and the public record, cites what it used, and says when it does not know.",
    category: "ai-models",
    keywords: ["ask ai", "assistant", "chat", "prediction", "strategy", "design help", "writer"],
    relatedHref: "/ai?tab=chat",
    sections: [
      {
        heading: "What it is for",
        body: [
          "Strategy questions and match predictions from your scouting plus The Blue Alliance and Statbotics; design questions against your CAD and the parts catalog; writing for grants, sponsors and updates; and finding a meeting time from your attendance history.",
          "It starts from the team profile, so it already knows where you are from, how long you have competed and how your seasons went.",
        ],
      },
      {
        heading: "What it will not do",
        body: [
          "Invent a number. If the data is not there it says so.",
          "Change CAD or push code on its own. Those always wait for a person.",
          "Keys, budgets, memory and governance are under Settings — that is where the controls live now, not a separate AI area.",
        ],
      },
    ],
  },
  {
    id: "team-library",
    slug: "team-library",
    title: "Team Library — links and older uploads (now inside Files)",
    summary:
      "The older shared shelf. Files (/files) is where the team's files live now; the Library still holds links and earlier uploads and appears inside Files as its own folder.",
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
    relatedHref: "/files",
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
      "Owners and admins restrict Vantage pillars and tabs per member from Team security — unrestricted by default.",
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
          "Subscription Bugbot uses your team's AI key or plan allowance — including keys you paste and models that run in the shop.",
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
          "The same sync writes Cursor's native formats: .cursor/rules/vantage/*.mdc, .cursor/skills/vantage/, and vantage-prefixed .cursor/mcp.json entries. Subagents and permissions have no Cursor equivalent, so they are reported as skipped.",
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
          "Paid Season Costs and awarded grants still count in the rollup so you do not need a second ledger.",
        ],
      },
      {
        heading: "What stays empty",
        body: [
          "KPIs stay at $0 or — until someone records a real source or receipt.",
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
      "Affiliation and funding paths shape Business Vantage — teams that disallow sponsors hide sponsor destinations.",
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
        heading: "What changes in Vantage",
        body: [
          "When Sponsors allowed is off, Business hub tabs and drawer links for Sponsor Wall, Suite, Matching Gift Finder, and related tools stay hidden.",
          "Grants, budget, awards, and Media stay available when those funding paths apply.",
        ],
      },
      {
        heading: "Update later",
        body: [
          "Owners and admins can change affiliation and funding paths under Team → Background after onboarding.",
          "Changes apply to navigation immediately for the workspace. Sponsor tools stay hidden until you pick a funding model that includes them.",
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
      "Top-level Vantage Media pillar for calendar, drafts, kit, and impact — empty until real rows exist.",
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
          "Open the Media pillar from the Vantage island, drawer, or Cmd+K — search “Media”.",
          "You can also pin Media as one of your four island apps.",
          "Pick a team workspace first — Media belongs to this team like the other tools.",
        ],
      },
      {
        heading: "What the tiles mean",
        body: [
          "Kit readiness and asset counts come from Media Kit profile fields and uploaded URLs.",
          "Upcoming outreach and “tagged media” come from calendar events you scheduled.",
          "Media impact and people reached come only from Community Impact rows with category media.",
          "Content items are drafts and posts you created here. Reach stays empty until you log it.",
        ],
      },
      {
        heading: "Where to edit",
        body: [
          "Use Calendar for press days and demos; Drafts for captions and AI-assisted posts (metered).",
          "Use Kit for bios, logos, and one-pagers; Impact to review logged media outreach.",
          "Your actual photos and videos live in the Media library (/media-library), nested under Kit.",
          "Empty states stay empty until you add real data — Vantage does not fill in made-up media metrics.",
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
    title: "Your AI keys and Automode",
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
          "Calls on your own keys are listed under AI keys (/team/ai-keys). Those calls and local models are counted so you can see them, but Vantage does not bill them.",
          "With no key of your own, calls use your plan's hosted allowance or purchased credits — see Billing & plans.",
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
          "Every request tries, in order: your personal key → team keys or the shop model address (Automode or a pinned model) → the plan's hosted path → the free-tier pool. If nothing resolves, the page says what is missing.",
          "Each surface can show what answered (provider, model, and endpoint origin). Localhost/LAN models carry a plain notice that they are smaller than frontier defaults; unrecognized custom models are described as custom, never assumed bad.",
          "Voice scouting transcription also follows your OpenAI-compatible endpoint when it supports audio; when it does not, the UI says so and degrades to browser speech recognition.",
        ],
      },
      {
        heading: "The exceptions, stated",
        body: [
          "Many features are deterministic on-server compute (metered at $0) and run with no AI key at all.",
          "Bugbot Ultra is the one hosted-only AI feature — its flat fees run on Vantage's hosted keys. Subscription Bugbot still uses your own key or a shop model.",
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
          "Nothing on Vantage is feature-gated by plan — no locked hubs, no plan-only tools. All paid plans are team-wide billing.",
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
        heading: "Your own keys and local models on every plan",
        body: [
          "Bring any provider key — OpenAI, Anthropic, Google AI Studio, OpenRouter, Groq, Mistral, or anything OpenAI-compatible — or point Vantage at Ollama / LM Studio. Unlimited by Vantage; you pay your provider directly.",
          "When a hosted allowance runs out, Chat stops: buy a credit pack, turn on pay-as-you-go with an explicit cap, or keep working on your own keys or a shop model. There is never a silent extra bill.",
        ],
      },
    ],
  },
  {
    id: "credits-vs-free",
    slug: "credits-vs-free",
    title: "Hosted credits, pay-as-you-go, and spend limits",
    summary:
      "How the hosted allowance, credit packs, and pay-as-you-go work — Chat stops before every extra billed call, with no surprise bill.",
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
          "Every plan includes a monthly hosted AI allowance (see Plans: Free, Pro, Pro+, and Max). Billed features draw from it whenever no key of your own or shop model answers first.",
          "Credit packs top the pool up without changing plans; pay-as-you-go continues past the allowance only up to a spend cap you set explicitly.",
        ],
      },
      {
        heading: "Hard stops, not surprises",
        body: [
          "Chat limits are checked before each billed call runs, not tallied afterwards — when the pool is empty and no pay-as-you-go cap allows more, the call is refused with a clear banner.",
          "Set spend and token caps under Ask AI → Controls (/team/budgets); watch real usage and refusals under /team/usage. Estimates for your own keys live under /team/ai-usage.",
        ],
      },
      {
        heading: "What Free does not include",
        body: [
          "On Free with nothing configured, hosted calls run on the budget-class pool until its allowance is spent, then features show a clear cutoff state.",
          "Adding your own key or a local model at /team/ai-keys removes the ceiling entirely; Vantage never bills those calls.",
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
      "Settings → Connectors lists every integration. Connect stays available until a real credential is saved. Connected only appears when that save worked.",
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
    relatedHref: "/connectors",
    sections: [
      {
        heading: "Where connections live",
        body: [
          "Settings → Connectors lists Google, GitHub, The Blue Alliance, Onshape, Discord, Slack, email, Stripe, storage, Fusion, and the shop Pi. “Connected” appears only when a working credential row exists.",
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
          "Exports (/exports) produce audited CSV/ZIP takeout for this team. Keys are never included.",
          "Billing belongs to the workspace's billing owner; plans and hosted credits are managed from /pricing and AI → Controls.",
        ],
      },
    ],
  },
  {
    id: "ai-relays",
    slug: "ai-relays",
    category: "integrations",
    title: "Pair an AI relay (Raspberry Pi)",
    summary: "A Pi on the team network runs Ask AI, Bugbot, assembly manuals, and video analysis. Pair it with a code — never a website cookie.",
    keywords: ["relay", "raspberry pi", "freebuff", "deepseek", "pair"],
    relatedHref: "/team/relays",
    sections: [
      {
        heading: "What you see",
        body: [
          "Team → AI relays lists whether a Pi is paired and when it last checked in.",
          "Approve the 8-character code the installer prints. That is the same pattern as the storage node.",
        ],
      },
      {
        heading: "What to do",
        body: [
          "On the Pi, run the relay installer. It prints a code. An owner or admin types that code here.",
          "Do not paste a Freebuff website cookie. That is not allowed. The Pi uses the team's own endpoint and token.",
        ],
      },
    ],
  },
  {
    id: "analyze-video",
    slug: "analyze-video",
    category: "competition",
    title: "Analyze a match or pit video",
    summary: "Queue a video for the video Pi. You get a timeline with timestamps. Confirming saves it on Match notes as from-video evidence. Scouted cycle counts stay as the scouts entered them.",
    keywords: ["video", "match video", "pit camera", "youtube"],
    relatedHref: "/video-analysis",
    sections: [
      {
        heading: "What you see",
        body: [
          "Paste a YouTube, TBA, uploaded file, or pit camera link. Jobs show queued, running, or finished, and how many minutes behind live they are.",
          "Each event is labelled with a confidence. Confirming it puts those events on Match notes as From video. Scouted numbers stay as the scouts entered them.",
        ],
      },
      {
        heading: "What to do",
        body: [
          "Pair a Pi with the video role first (Team → AI relays). Then queue a video from Competition → Analyze video. After it is ready, confirm it so Match notes can show the events.",
          "If no Pi is paired, the job stays queued and the page says so.",
        ],
      },
    ],
  },
  {
    id: "funding-model",
    slug: "funding-model",
    category: "business",
    title: "How the team is funded",
    summary: "Pick one: you pay, the school pays with no sponsors, you have sponsors, or the school plus sponsors. Business tools match that choice.",
    keywords: ["funding", "sponsors", "school funded", "dues"],
    relatedHref: "/team/background",
    sections: [
      {
        heading: "What you see",
        body: [
          "Onboarding and Team background ask four radios, in plain words.",
          "A school that cannot have sponsors will not see sponsor packages, the sponsor wall, or matching-gift tools. They are gone, not locked.",
        ],
      },
      {
        heading: "What to do",
        body: [
          "Owners and admins pick the funding model during onboarding or later under Team background.",
          "Budgets, part requests, orders, grants, awards, and outreach stay for every team.",
        ],
      },
    ],
  },
  {
    id: "packing-lists",
    slug: "packing-lists",
    category: "competition",
    title: "Packing lists at the event",
    summary:
      "Check off the load-out on your phone. The last list stays on this device if venue Wi-Fi drops; packed ticks upload when you are back online.",
    keywords: ["packing", "load-out", "load out", "trailer", "what to bring", "cart", "offline packing"],
    relatedHref: "/packing",
    sections: [
      {
        heading: "What you see",
        body: [
          "A list seeded with the usual FRC kit: batteries, bumpers, tools, drive station. Teammates request extras; the packing lead owns the master list.",
          "If the signal dies, a quiet bar says you are looking at the copy saved on this phone.",
        ],
      },
      {
        heading: "What to do",
        body: [
          "Open Packing once on venue Wi-Fi so it caches. Tick items as you pack. Those ticks wait on the device and send when you reconnect.",
          "Need something that is not on the list? Submit a request — do not wait for a laptop.",
        ],
      },
    ],
  },
  {
    id: "batteries-at-events",
    slug: "batteries-at-events",
    category: "team",
    title: "Battery logs in the pit",
    summary:
      "Charge cycles and assignments come from logs your team enters. The last snapshot stays on this device; a new log queues if the Wi-Fi drops.",
    keywords: ["batteries", "charge log", "pack rotation", "internal resistance", "offline batteries"],
    relatedHref: "/batteries",
    sections: [
      {
        heading: "What you see",
        body: [
          "Each pack shows assignment, last charge, and health from measurements you logged. Unknown means nobody has measured it yet.",
          "When you are offline, the same page stays up from the last visit.",
        ],
      },
      {
        heading: "What to do",
        body: [
          "Log a charge or a Beak reading after each cycle. If the network is gone, the log sits on this device until it can upload.",
        ],
      },
    ],
  },
  {
    id: "offline-at-events",
    slug: "offline-at-events",
    category: "competition",
    title: "Using the shop without signal",
    summary:
      "Competition, Hours, Chat, Files, Packing, Batteries, Pit, Calendar, and Match notes keep working on this device. Your last snapshot stays on screen. Ticks, dates, RSVPs, clock-ins, packing checks, battery logs, checklist taps, notes, and chat queue and send when you are back online.",
    keywords: ["offline", "venue wifi", "outbox", "keep on this device", "hours", "chat"],
    relatedHref: "/competition",
    sections: [
      {
        heading: "What you see",
        body: [
          "A quiet bar says offline and shows the time of the last snapshot. The same screens stay up — there is no dead Retry wall.",
          "Writes you make (task ticks, calendar dates, RSVPs, clock in/out, packing checks, battery logs, match notes, pit checks, chat) sit on this device until the network returns.",
        ],
      },
      {
        heading: "What to do",
        body: [
          "Open the pages you will need before you lose signal so they cache. On Files, tap Keep on this device for anything you must open in the stands.",
          "Assembly manuals download their PDF onto this device once a run finishes.",
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
