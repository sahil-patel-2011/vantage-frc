/**
 * Command palette catalog + ranked fuzzy search.
 *
 * The hub catalog labels tools out of context ("Forms", "Coverage", "Shifts"),
 * so a plain substring match over labels cannot answer "scout" or "bumpers".
 * This module gives every destination a hub context, a synonym list drawn from
 * the words FRC teams actually use, and a ranked matcher that tolerates typos
 * and word-initial abbreviations ("asd" -> Alliance selection desk).
 *
 * Pure and deterministic — no DB, no network. Data hits still come from
 * /api/search; this covers "get me to the tool" in one keystroke.
 */
import {
  PRODUCT_HUBS,
  hubHref,
  type HubTabDef,
  type ProductHubDef,
} from "./hubs";

export type CommandKind = "destination" | "action";

export type CommandEntry = {
  /** Stable id — hub tab ids are only unique within a hub. */
  id: string;
  label: string;
  /** Breadcrumb shown under the label, e.g. "Competition › Scouting". */
  context: string;
  href: string;
  kind: CommandKind;
  keywords: string[];
  /** Pinned above equal-scoring results. */
  featured?: boolean;
};

export type CommandHit = CommandEntry & { score: number };

/**
 * Words teams use that do not appear in the tab label. Keyed by `hubId:tabId`
 * so the same tab id under two hubs can differ. Keep terms lowercase.
 */
const KEYWORDS: Record<string, string[]> = {
  // --- Competition · Event day ---
  "competition:command": ["event day", "field", "command center", "now", "live", "today"],
  "competition:my-day": ["my day", "next match", "personal", "assignments", "what do i do"],
  "competition:event-day-plan": ["day plan", "agenda", "timeline", "run of show"],
  "competition:drive-team-signals": ["drive team", "driver", "operator", "coach", "signals", "board"],
  // --- Competition · Scouting ---
  "competition:scouting": ["scout", "scouting", "data", "collect", "match data", "tablet"],
  "competition:pit-photos": ["pit photos", "robot photos", "photo wall", "pictures", "gallery", "what does their robot look like"],
  "competition:forms": ["form builder", "schema", "pit scouting", "match form", "questions", "fields"],
  "competition:scout-coverage-live": ["coverage", "gaps", "who is scouting", "assignments", "unscouted"],
  "competition:shift-balancer": ["shifts", "rotation", "schedule scouts", "fatigue", "breaks", "lunch"],
  "competition:scout-p2p-relay": ["offline", "mesh", "peer to peer", "sync", "no wifi", "qr", "relay"],
  "competition:scout-training-mode": ["training", "practice scouting", "onboard scouts", "teach"],
  "competition:scout-accuracy": ["accuracy", "quality", "reliability", "scout performance"],
  "competition:scout-crossval": ["cross check", "validate", "agreement", "double scout"],
  "competition:scout-disagreements": ["disagreements", "conflicts", "mismatch", "discrepancy"],
  "competition:scout-data-impact": ["data impact", "value", "which fields matter"],
  "competition:scout-field-budget": ["field budget", "how many fields", "form length"],
  "competition:scout-assisted-count": ["assisted count", "counting help", "tally"],
  "competition:scout-schema-negotiate": ["schema sync", "share form", "other teams", "negotiate"],
  "competition:scouting-heat-signals": ["heat", "signals", "hot teams", "trends"],
  "competition:scouting-schema-ab": ["a/b test", "experiment", "compare forms"],
  "competition:data-quality-scorecard": ["data quality", "scorecard", "clean data", "errors"],
  // --- Competition · Strategy ---
  "competition:strategy": ["strategy", "plan", "predictions", "win", "matchup", "analysis"],
  "competition:alliance-selection-desk": [
    "alliance selection", "asd", "pick board", "draft", "captain", "elims", "playoffs",
  ],
  "competition:pick-clock": ["pick clock", "timer", "selection timer", "countdown"],
  "competition:chemistry": ["chemistry", "partner fit", "synergy", "compatibility"],
  "competition:pairwise": ["pairwise", "ranking", "a beats b", "compare teams", "bradley terry"],
  "competition:team-tags": ["tags", "labels", "defense", "climb", "qualitative"],
  "competition:picklist-collab": ["pick list", "picklist", "ranking teams", "draft board", "votes"],
  "competition:picklist-justifier": ["justify", "why this pick", "reasoning", "defend pick"],
  "competition:alliance-sim": ["simulate alliance", "what if", "alliance sim"],
  "competition:alliance-partner-brief": ["partner brief", "brief", "who are we with"],
  "competition:counter-book": ["counter", "counters", "how to beat", "playbook"],
  "competition:defense-planner": ["defense", "block", "pin", "disrupt", "d"],
  "competition:opponent-watchlist": ["watchlist", "opponents", "threats", "teams to watch"],
  "competition:match-strategy-cards": ["match cards", "game plan", "auto", "teleop", "endgame"],
  "competition:match-sim": ["simulate match", "match sim", "predict score"],
  "competition:match-notes-timeline": ["notes", "timeline", "timestamps", "match log"],
  "competition:match-delta-watcher": ["delta", "changes", "what changed", "diff"],
  "competition:match-video-index": ["video", "film", "footage", "rewatch", "clips"],
  "competition:epa-trend-alerts": ["epa", "opr", "trends", "alerts", "statbotics", "rating"],
  "competition:overnight-intel": ["overnight", "intel", "research", "prep", "tomorrow"],
  "competition:district-advancement": ["district", "advancement", "points", "qualify", "states"],
  "competition:ranking-projection": ["rank", "ranking", "projection", "standings", "where will we finish"],
  // --- Competition · Pit ---
  "competition:match-checklist": [
    "checklist", "pit checklist", "bumpers", "battery strap", "pre match", "queue", "before match",
  ],
  "competition:pit-repair-triage": ["repair", "broken", "fix", "triage", "swap", "damage"],
  "competition:battery-rotation": ["battery", "batteries", "charge", "charging", "packs", "cart"],

  // --- Team ---
  "team:calendar": ["calendar", "schedule", "meetings", "events", "when", "dates", "shop nights"],
  "team:messages": ["chat", "message", "dm", "talk", "discuss", "slack", "discord", "inbox"],
  "team:attendance": [
    "attendance", "who is here", "who is coming", "coming tonight", "roster", "present",
    "people", "members", "rsvp", "headcount",
  ],
  "team:hours": ["hours", "clock in", "kiosk", "shop hours", "time", "sign in"],
  "team:hours-self-view": ["my hours", "my time", "how many hours"],
  "team:mentor-hours": ["mentor hours", "adult hours", "volunteer time"],
  "team:onboarding-buddy": ["onboarding", "buddy", "new member", "mentor pairing"],
  "team:alumni-network": ["alumni", "graduates", "former members"],
  "team:skills-graph": ["skills", "who can", "certifications", "training matrix"],
  "team:training": ["training", "training matrix", "certifications", "certs", "who can use the mill", "machine certification", "qualified"],
  "team:roles": ["roles", "season roles", "who does what", "role assignments", "subteam leads", "responsibilities"],
  "team:driver-tryouts": ["driver tryouts", "driver selection", "who drives"],
  "team:exit-interview": ["exit interview", "offboarding", "graduating", "handoff", "seniors"],
  "team:todos": ["todo", "tasks", "work", "to do", "assignments", "backlog"],
  "team:practice": ["practice", "drive practice", "cycles", "reps", "driving"],
  "team:season-planning-workspace": ["season plan", "milestones", "goals", "timeline", "roadmap"],
  "team:goals-tracker": ["goals", "objectives", "targets", "okr"],
  "team:standup-digest": ["standup", "daily", "digest", "summary"],
  "team:meeting-autopilot": ["meeting", "agenda", "minutes", "notes"],
  "team:retro": ["retro", "retrospective", "what went wrong", "lessons"],
  "team:batteries": ["battery", "batteries", "packs", "charge"],
  "team:fmea": ["fmea", "risk", "failure", "what could break", "rpn"],
  "team:tool-checkout": ["tools", "checkout", "borrow", "who has"],
  "team:equipment-maintenance": ["equipment", "maintenance", "machines", "service"],
  "team:safety-training": ["safety", "training", "ppe", "certification", "incidents"],
  "team:checklist-library": ["checklists", "library", "procedures", "sop"],
  "team:pit-map-planner": ["pit map", "pit layout", "pit setup", "floor plan"],
  "team:field-reset-timer": ["field reset", "timer"],
  "team:knowledge": ["playbook", "wiki", "knowledge", "docs", "how to", "handbook", "notes"],
  // A rookie coach does not know the word "roadmap" — they type the question they
  // are actually asking at 10pm in October. These are those questions verbatim.
  "team:roadmap": [
    "roadmap", "season roadmap", "rookie", "rookie team", "first season", "new team",
    "what do we do next", "what do i do", "where do i start", "getting started",
    "checklist", "season checklist", "kickoff checklist", "registration deadline",
    "when do we register", "survival", "help im new", "first year",
  ],
  "team:migrate": [
    "import", "migrate", "bring your season", "notion", "csv", "ics", "switch",
    "qrscout", "purple standard", "scoutradioz", "trello", "stims", "roster", "google sheets",
  ],
  "team:knowledge-gap": ["knowledge gap", "missing docs", "undocumented"],
  "team:offline-shell": ["offline", "no wifi", "airplane", "sync", "cache"],
  "team:degraded-mode": ["degraded", "outage", "fallback", "backup plan"],
  "team:object-chat-bridge": ["object chat", "bridge"],
  "team:bus-factor": ["bus factor", "single point", "overloaded", "workload", "burnout"],
  "team:team-health-dashboard": ["team health", "morale", "engagement"],
  "team:cross-team-scrim": ["scrim", "practice match", "other teams"],
  "team:build-burndown": ["burndown", "progress", "build progress", "behind schedule"],
  "team:risk-burndown": ["risk burndown", "risks closing"],

  // --- Business ---
  "business:overview": ["business", "overview", "money", "finance summary"],
  "business:finance": ["money", "finance", "cash", "funds", "accounting"],
  "business:budget": ["budget", "spend", "allocation", "how much left"],
  "business:orders": ["orders", "purchase", "buy", "po", "shipping", "vendors"],
  "business:costs": ["costs", "season costs", "expenses", "spending"],
  "business:vendor-lead-times": ["lead time", "shipping time", "when will it arrive", "vendors"],
  "business:sponsors": ["sponsors", "sponsorship", "donors", "companies"],
  "business:sponsorship": ["packages", "tiers", "sponsor levels"],
  "business:placements": ["partners", "placements", "logos"],
  "business:sponsor-suite": ["sponsor suite", "sponsor portal"],
  "business:sponsor-wall": ["sponsor wall", "thank you", "logos"],
  "business:sponsor-renewal-roi": ["renewal", "roi", "retain sponsors"],
  "business:sponsor-tier-calculator": ["tier calculator", "how much to ask"],
  "business:matching-gift-finder": ["matching gift", "employer match", "double donation"],
  "business:grants": ["grants", "grant", "apply", "funding", "foundation"],
  "business:grant-report": ["grant report", "reporting", "grant followup"],
  "business:grant-eligibility-matcher": ["eligibility", "which grants", "qualify"],
  "business:evidence": ["outreach", "evidence", "community", "impact"],
  "business:fundraisers": ["fundraiser", "fundraising", "raise money", "donations", "events"],
  "business:impact": ["impact", "outreach hours", "community service"],
  "business:award-tracker": ["awards", "award tracker", "chairmans", "impact award"],
  "business:awards-workbench": ["awards", "essays", "submissions"],
  "business:impact-essay": ["essay", "impact essay", "write award"],
  "business:judge-sim": ["judges", "judging", "pitch", "presentation", "interview"],
  "business:media-kit": ["media kit", "press", "brand", "logo pack"],
  "business:outreach-calendar": ["outreach calendar", "outreach", "community events", "demos", "volunteering"],

  // --- Build ---
  "build:kickoff": ["kickoff", "game manual", "rules", "new game", "january", "strategy design"],
  "build:cad": ["cad", "onshape", "fusion", "model", "design", "parts", "drawing"],
  "build:cad-change-radar": ["cad changes", "change radar", "what changed in cad"],
  "build:sketch-to-brief": ["sketch", "napkin", "idea to brief", "concept"],
  "build:code": ["code", "programming", "software", "java", "python", "wpilib", "robot code"],
  // The loudest blocker in the community research, so it carries the panic words a
  // student actually types at 11pm: the symptom, not the name of the tool.
  "build:troubleshoot": [
    "troubleshoot", "troubleshooting", "get unstuck", "stuck", "help", "wont deploy",
    "code wont deploy", "no comms", "no communication", "cant connect", "cannot connect",
    "roborio", "rio", "imaging", "wont image", "reimage", "no robot code", "driver station",
    "radio", "brownout", "browning out", "can device not found", "blink code", "status light",
    "fix it", "broken robot", "not working",
  ],
  "build:bugbot": ["bugbot", "bugs", "review code", "static analysis", "github", "lint"],
  "build:code-deploy-log": ["deploy", "deploy log", "what version is on the robot"],
  "build:code-perf": ["code performance", "loop time", "code vs match"],
  "build:fmea": ["robot", "fmea", "failure", "risk", "what breaks", "reliability"],
  "build:robot": ["robot", "blueprint", "subsystems", "mechanisms", "design"],
  "build:prototype": ["prototype", "testing ideas", "proto"],
  "build:batteries": ["battery", "batteries", "charge", "packs"],
  "build:inspection-copilot": ["inspection", "inspector", "legal", "rules check", "pass inspection"],
  "build:robot-weigh-in": ["weight", "weigh in", "scale", "pounds", "too heavy", "limit"],
  "build:readiness-score": ["readiness", "are we ready", "ship it", "status"],
  "build:wiring-diagnoser": ["wiring", "wires", "electrical", "pdh", "pdp", "breaker", "gauge"],
  "build:rule-impact": ["rule change", "manual update", "team update", "rule impact"],
  "build:tuning-autopilot": ["tuning", "pid", "gains", "feedforward", "tune"],
  "build:failure-patterns": ["failures", "patterns", "recurring problems"],
  "build:incident-heatmap": ["incidents", "heatmap", "where it breaks"],
  "build:auton-path-library": ["auto", "auton", "autonomous", "paths", "trajectory"],
  "build:reuse-advisor": ["reuse", "last year", "carry over", "previous robot"],
  "build:spare-forecast": ["spares", "spare parts", "will we run out", "inventory forecast"],
  "build:spare-robot-kit": ["spare kit", "spare robot", "backup parts"],
  "build:bin-shelf-locator": ["where is it", "bin", "shelf", "find part", "storage"],
  "build:budget-reconciler": ["budget check", "reconcile", "spend vs plan"],
  "build:battery-health-forecast": ["battery health", "pack health", "dying batteries"],
  "build:cross-domain-alerts": ["alerts", "cross domain", "warnings"],
  "build:decision-critic": ["decision", "critic", "second opinion", "review decision"],

  // --- AI ---
  "ai:chat": ["ai", "chat", "assistant", "ask", "gpt", "claude", "question"],
  "ai:writer": ["writer", "draft", "write", "essay", "grant writing", "compose"],
  "ai:agent": ["agent", "autonomous", "research", "do it for me", "tool use"],
  "ai:budgets": ["budgets", "controls", "spend cap", "limits", "kill switch"],
  "ai:memory": ["memory", "remember", "context", "ai memory"],
  "ai:governance": ["governance", "policy", "allowlist", "approvals", "rules"],
  "ai:finance": ["finance in ai", "money data", "redaction", "consent"],
  "ai:ai-keys": ["api key", "keys", "byok", "openai", "anthropic", "ollama", "own key"],
  "ai:ai-usage": ["byok usage", "key usage"],
  "ai:usage": ["usage", "credits", "how much have we used", "spend", "tokens"],
  "ai:decisions": ["decisions", "log", "adr", "why did we", "notes"],
  "ai:decision-search": ["search decisions", "find decision", "semantic search"],
  "ai:season-report": ["season report", "retrospective", "year in review", "summary"],

  // --- Newly surfaced tools (previously reachable only by URL) ---
  // The ONE pre-match surface; absorbs Match Copilot's phrasing so old habits still land here.
  "competition:briefing": [
    "briefing",
    "drive coach",
    "pre match",
    "brief the drivers",
    "game plan",
    "next match plan",
    "queue",
    "copilot",
    "match copilot",
  ],
  "competition:schedule": ["schedule", "match schedule", "when do we play", "next match", "queue times"],
  "competition:rankings": ["rankings", "standings", "rank", "place", "leaderboard"],
  "competition:intel": ["intel", "research", "scouting other teams", "recon"],
  "competition:dossier": ["dossier", "team profile", "who are they", "opponent report"],
  "competition:video": ["video", "film", "match footage", "review film", "rewatch"],
  "competition:pit": ["pit", "pit command", "pit crew", "turnaround"],
  "team:goals": ["goals", "objectives", "targets", "season goals"],
  "team:safety": ["safety", "incident", "injury", "hazard", "report incident"],
  "team:notebook": ["notebook", "engineering notebook", "log", "journal", "documentation"],
  "team:risks": ["risks", "risk register", "what could go wrong", "likelihood impact"],
  "business:vendors": ["vendors", "suppliers", "where to buy", "andymark", "rev", "vex", "wcp"],
  "build:subsystems": ["subsystems", "mechanisms", "specs", "drivetrain", "intake", "elevator"],
  "build:bringup": ["bring up", "bringup", "first power", "power on", "commissioning", "smoke test"],
  "build:reviews": ["design review", "reviews", "critique", "sign off"],
  "build:gearbox": ["gearbox", "gear ratio", "reduction", "free speed", "motor calc"],
  "build:shooter-table": ["shooter", "lookup table", "rpm", "hood angle", "range table"],
  "build:weight-budget": ["weight budget", "pounds", "mass", "how heavy", "weight allowance"],
  "build:power-budget": ["power", "amps", "current draw", "breaker", "brownout", "120a"],
  "build:wiring-map": ["can bus", "canivore", "wiring map", "device ids", "harness"],
  "build:tuning-log": ["tuning log", "constants", "calibration", "pid history", "what did we try"],
  "build:consumables": ["consumables", "zip ties", "loctite", "tape", "stock", "restock", "supplies"],

  // --- This wave's tools, in the words teams actually type ---
  "team:parents": [
    "parents", "parent", "guardians", "guardian", "family", "families", "digest",
    "newsletter", "parent email", "email the parents", "translate", "contacts",
  ],
  "team:presence": [
    "who is coming", "whos coming", "roll call", "rsvp", "attendance", "presence",
    "tonight", "coming tonight", "head count", "check in",
  ],
  "team:learning": [
    "learning", "call your shot", "predictions", "predict", "coaching", "coach",
    "who is struggling", "struggling", "mentor view", "foreman", "learning mode",
  ],
  "team:knowledge-drafts": [
    "wiki drafts", "knowledge drafts", "capture", "capture from work", "document",
    "document it", "write it up", "handoff", "knowledge", "draft a page", "review drafts",
  ],
  "build:manufacturing": [
    "manufacturing", "kanban", "parts board", "needs cam", "cam", "machining", "mill",
    "lathe", "waterjet", "router", "made parts", "to make", "make parts", "fabrication",
  ],
  "build:parts": ["parts", "parts ledger", "stock", "inventory", "what do we have", "on hand", "reorder", "spares"],
  "build:inventory": ["inventory", "stock", "parts list", "quantity", "part number"],
  "build:orders-link": ["orders", "purchase request", "buy", "order parts"],
  "build:print-farm": [
    "3d print", "3d printing", "printer", "printers", "filament", "spool", "spools",
    "print queue", "pla", "petg", "abs", "print farm", "printing",
  ],
  "build:cad-vault": [
    "cad files", "stl", "step", "upload cad", "model files", "drawings", "dxf",
    "versions", "vault", "download cad", "print file",
  ],
  "competition:event-readiness": [
    "pre event", "pre-event", "event checklist", "ready to go", "inspection prep",
    "consent", "consent forms", "packing", "travel", "before the event", "are we ready",
  ],

  // --- Deployment-wave surfaces ---
  "business:reimbursements": ["reimburse", "reimbursement", "pay me back", "receipt", "expense claim", "i paid for"],
  "team:my-kit": ["my kit", "my stuff", "what do i need", "my tasks", "my assignments", "personal"],
  "team:team-storage": ["storage node", "raspberry pi", "self host", "storage", "disk", "pi"],
  "team:library": ["library", "files", "marketplace", "manuals", "step", "dxf", "folders", "resources"],
  "ai:ai-bridge": ["subscription bridge", "claude code", "codex", "chatgpt", "subscription", "bridge", "free ai"],
  "build:agent-config": ["agent config", "agent rules", "claude.md", "mcp", "subagent", "team rules", "coding agent"],
  "media:media-library": ["media library", "photos", "videos", "album", "gallery", "pictures", "upload photo"],

  // --- Media ---
  "media:calendar": ["media calendar", "content", "posts", "social"],
  "media:drafts": ["drafts", "captions", "posts", "write post"],
  "media:reminders": ["reminders", "due", "content due"],
  "media:kit": ["media kit", "brand", "logos", "press"],
  "media:impact": ["impact", "outreach", "community"],
};

/** Destinations that are not hub tabs but people still search for. */
const STANDALONE: CommandEntry[] = [
  { id: "home", label: "Home", context: "Vantage", href: "/dashboard", kind: "destination", keywords: ["home", "dashboard", "start", "overview"], featured: true },
  { id: "logistics", label: "Logistics", context: "Vantage", href: "/logistics", kind: "destination", keywords: ["travel", "hotel", "rooming", "bus", "trip", "lodging"] },
  { id: "packing", label: "Packing list", context: "Logistics", href: "/packing", kind: "destination", keywords: ["packing", "load out", "trailer", "what to bring", "cart"] },
  { id: "duties", label: "Duties", context: "Logistics", href: "/duties", kind: "destination", keywords: ["duties", "who is on", "assignments", "chaperone"] },
  { id: "visit-invites", label: "Visit invites", context: "Logistics", href: "/visit-invites", kind: "destination", keywords: ["visit", "tour", "demo day", "rsvp"] },
  { id: "account", label: "Account", context: "Settings", href: "/account", kind: "destination", keywords: ["account", "profile", "me", "settings", "preferences"] },
  { id: "appearance", label: "Appearance & theme", context: "Settings", href: "/account?tab=appearance", kind: "destination", keywords: ["theme", "dark mode", "light mode", "appearance", "colors"] },
  { id: "notifications", label: "Notifications", context: "Settings", href: "/notifications", kind: "destination", keywords: ["notifications", "alerts", "inbox", "unread"] },
  { id: "security", label: "Security", context: "Settings", href: "/security", kind: "destination", keywords: ["security", "password", "2fa", "mfa", "sessions"] },
  { id: "team-admin", label: "Team admin", context: "Settings", href: "/team/admin", kind: "destination", keywords: ["admin", "invite", "members", "roles", "permissions", "add someone"] },
  { id: "exports", label: "Export data", context: "Settings", href: "/exports", kind: "destination", keywords: ["export", "download", "csv", "takeout", "backup"] },
  { id: "help", label: "Help centre", context: "Support", href: "/help", kind: "destination", keywords: ["help", "how do i", "support", "docs", "manual", "articles", "tutorial", "faq"] },
  { id: "app-manual", label: "App manual", context: "Support", href: "/docs", kind: "destination", keywords: ["manual", "app manual", "section guide", "section by section", "walkthrough", "how vantage works", "guide"] },
  { id: "support", label: "Contact support", context: "Support", href: "/support", kind: "destination", keywords: ["support", "contact", "problem", "stuck"] },
  { id: "report-bug", label: "Report a bug", context: "Support", href: "/report-bug", kind: "destination", keywords: ["bug", "broken", "report a problem", "feedback", "something is wrong", "glitch"] },
];

/** Verbs. These answer "I want to DO x" rather than "take me to x". */
const ACTIONS: Array<Omit<CommandEntry, "kind">> = [
  { id: "action-scout", label: "Scout the next match", context: "Action", href: "/competition?tab=scouting", keywords: ["scout now", "start scouting", "new entry", "record match"], featured: true },
  { id: "action-clock-in", label: "Clock in to the shop", context: "Action", href: "/hours", keywords: ["clock in", "sign in", "log hours", "start hours"], featured: true },
  { id: "action-message", label: "Message the team", context: "Action", href: "/team?tab=messages", keywords: ["send message", "post", "tell everyone", "announce"], featured: true },
  { id: "action-task", label: "Add a task", context: "Action", href: "/team?tab=todos", keywords: ["new task", "add todo", "assign work"], featured: true },
  { id: "action-ask-ai", label: "Ask the AI assistant", context: "Action", href: "/ai?tab=chat", keywords: ["ask ai", "question", "help me", "chat"], featured: true },
  { id: "action-report-break", label: "Report something broken", context: "Action", href: "/pit-repair-triage", keywords: ["broken", "it broke", "damage", "repair", "help"], featured: true },
  { id: "action-invite", label: "Invite a teammate", context: "Action", href: "/team/admin#invite-form", keywords: ["invite", "add member", "new person", "email invite"] },
  { id: "action-log-battery", label: "Log a battery cycle", context: "Action", href: "/batteries", keywords: ["battery used", "charge log", "swap battery"] },
];

function tabContext(hub: ProductHubDef, tab: HubTabDef): string {
  if (!tab.group) return hub.label;
  const parent = hub.tabs.find((entry) => entry.id === tab.group && !entry.group);
  if (!parent) return hub.label;
  // Carry the family the workbench files this tool under, so a palette row and
  // the hub it lands in describe the tool the same way — "Coverage" is easier
  // to place as "Scouting › Run the crew" than as "Scouting" alone.
  return tab.family
    ? `${hub.label} › ${parent.label} › ${tab.family}`
    : `${hub.label} › ${parent.label}`;
}

/**
 * Every place a member can go, with context and synonyms. Derived from
 * PRODUCT_HUBS so a new tab is searchable the moment it is added.
 */
export function commandCatalog(): CommandEntry[] {
  const entries: CommandEntry[] = [];
  const byHref = new Map<string, CommandEntry>();

  const add = (entry: CommandEntry) => {
    const existing = byHref.get(entry.href);
    if (existing) {
      // Two names for one place is the confusion we are removing. Keep the
      // first entry and absorb the other's synonyms so no phrasing is lost.
      for (const keyword of entry.keywords) {
        if (!existing.keywords.includes(keyword)) existing.keywords.push(keyword);
      }
      existing.featured = existing.featured || entry.featured;
      return;
    }
    byHref.set(entry.href, entry);
    entries.push(entry);
  };

  for (const hub of PRODUCT_HUBS) {
    for (const tab of hub.tabs) {
      add({
        id: `${hub.id}:${tab.id}`,
        label: tab.label,
        context: tabContext(hub, tab),
        href: hubHref(hub.href, tab.id),
        kind: "destination",
        keywords: [...(KEYWORDS[`${hub.id}:${tab.id}`] ?? [])],
        featured: tab.featured || !tab.group,
      });
    }
  }

  for (const entry of STANDALONE) add({ ...entry, keywords: [...entry.keywords] });

  // Verbs last: where one points at a destination that already exists, its
  // phrasing is merged into that row rather than duplicating it.
  for (const action of ACTIONS) add({ ...action, kind: "action", keywords: [...action.keywords] });

  return entries;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Words that carry no search signal in a short query. */
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "to", "for", "of", "in", "on", "my", "our",
  "we", "i", "it", "did", "do", "does", "how", "what", "why", "and",
]);

/**
 * Same-stem match: "failed" should find "Failure patterns". Exact prefix in
 * either direction, or a shared prefix long enough to be the same word root.
 */
function wordMatches(poolWords: string[], word: string): boolean {
  for (const candidate of poolWords) {
    if (candidate.startsWith(word) || word.startsWith(candidate)) return true;
    const floor = Math.min(4, word.length, candidate.length);
    if (floor < 4) continue;
    let shared = 0;
    while (shared < word.length && shared < candidate.length && word[shared] === candidate[shared]) {
      shared += 1;
    }
    if (shared >= floor) return true;
  }
  return false;
}

/** Are all of `query`'s characters present in `text`, in order? */
function subsequenceScore(text: string, query: string): number {
  let ti = 0;
  let first = -1;
  let last = 0;
  for (const ch of query) {
    const found = text.indexOf(ch, ti);
    if (found === -1) return 0;
    if (first === -1) first = found;
    last = found;
    ti = found + 1;
  }
  // Tighter spans rank higher: "asd" in "alliance selection desk" beats a sprawl.
  const span = last - first + 1;
  return Math.max(1, Math.round(60 * (query.length / span)));
}

/** First letters of each word — "asd" matches "Alliance selection desk". */
function initials(text: string): string {
  return text
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
}

function scoreEntry(entry: CommandEntry, query: string): number {
  const q = normalize(query);
  if (!q) return 0;

  const label = normalize(entry.label);
  const context = normalize(entry.context);
  const haystack = `${label} ${context}`;

  let best = 0;
  const bump = (value: number) => {
    if (value > best) best = value;
  };

  if (label === q) bump(1000);
  if (label.startsWith(q)) bump(900);
  if (initials(label) === q) bump(880);
  if (label.split(" ").some((word) => word.startsWith(q))) bump(800);
  if (label.includes(q)) bump(700);

  for (const keyword of entry.keywords) {
    const k = normalize(keyword);
    if (!k) continue;
    if (k === q) bump(760);
    else if (k.startsWith(q)) bump(680);
    else if (k.includes(q)) bump(560);
  }

  if (context.startsWith(q)) bump(520);
  if (haystack.includes(q)) bump(480);

  // Multi-word queries: "robot failed" should reach "Failure patterns", so the
  // words are stem-matched rather than required as literal substrings.
  const allWords = q.split(" ").filter(Boolean);
  if (allWords.length > 1) {
    const meaningful = allWords.filter((word) => !STOPWORDS.has(word));
    const words = meaningful.length ? meaningful : allWords;
    const poolWords = `${haystack} ${entry.keywords.map(normalize).join(" ")}`
      .split(" ")
      .filter(Boolean);
    const hits = words.filter((word) => wordMatches(poolWords, word)).length;
    if (hits === words.length) bump(640);
    else if (hits > 0) bump(300 + Math.round(120 * (hits / words.length)));
  }

  if (best === 0) {
    const compact = q.replace(/\s/g, "");
    bump(subsequenceScore(label.replace(/\s/g, ""), compact));
    const viaContext = subsequenceScore(haystack.replace(/\s/g, ""), compact);
    bump(Math.round(viaContext * 0.5));
  }

  if (best > 0) {
    if (entry.featured) best += 25;
    if (entry.kind === "action") best += 15;
    // Prefer the shorter of two equally good labels.
    best -= Math.min(20, Math.floor(label.length / 4));
  }

  return best;
}

export type SearchCommandsOptions = {
  limit?: number;
  /** Hrefs the member may not open (hub access / sponsors gating). */
  isAllowed?: (href: string) => boolean;
  /** Shown when the query is empty, most recent first. */
  recentHrefs?: string[];
};

/**
 * Ranked matches for `query`. An empty query returns recents followed by
 * featured entries, so the palette is useful before a key is typed.
 */
export function searchCommands(
  query: string,
  entries: CommandEntry[] = commandCatalog(),
  options: SearchCommandsOptions = {},
): CommandHit[] {
  const { limit = 12, isAllowed, recentHrefs = [] } = options;
  const pool = isAllowed ? entries.filter((entry) => isAllowed(entry.href)) : entries;

  if (!normalize(query)) {
    const byHref = new Map(pool.map((entry) => [entry.href, entry]));
    const recents: CommandHit[] = [];
    for (const href of recentHrefs) {
      const entry = byHref.get(href);
      if (entry && !recents.some((hit) => hit.href === href)) {
        recents.push({ ...entry, score: 1 });
      }
    }
    // Round-robin by workspace. Taking featured entries in catalogue order
    // filled the whole list with Competition and Team, so Build, Business and
    // AI were never visible before typing.
    const buckets = new Map<string, CommandEntry[]>();
    for (const entry of pool) {
      if (!entry.featured) continue;
      if (recents.some((hit) => hit.href === entry.href)) continue;
      const workspace = entry.context.split("›")[0]!.trim();
      const bucket = buckets.get(workspace);
      if (bucket) bucket.push(entry);
      else buckets.set(workspace, [entry]);
    }
    const featured: CommandHit[] = [];
    const lists = [...buckets.values()];
    for (let depth = 0; featured.length < limit && lists.some((l) => l.length > depth); depth += 1) {
      for (const list of lists) {
        const entry = list[depth];
        if (entry) featured.push({ ...entry, score: 0 });
      }
    }
    return [...recents, ...featured].slice(0, limit);
  }

  return pool
    .map((entry) => ({ ...entry, score: scoreEntry(entry, query) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}
