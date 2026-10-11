/**
 * Ask AI skills — the one catalog.
 *
 * Vantage used to grow a separate AI helper for every job: a sponsor deck builder, a matching-gift
 * finder, a renewal-ROI report, an impact-essay drafter, a pit triage, a stand-up digest, a writer
 * tab, an agent tab… about fifty of them, each behind its own button. A student should not have
 * to know which one to open. Now there is one assistant (Ask AI) and these are its skills: it picks
 * the right one for each request, and every page opens it the same way, pre-set to that page's
 * skill.
 *
 * This file is client-safe data only (names, starters, routing words, where each skill lives).
 * The executors that read a team's records live in `executors.ts` (server only) and call the
 * feature's existing lib module through the request's `withRls` client — the helpers were not
 * rewritten, only gathered.
 */

export type AiSkillGroupId =
  | "sponsorships"
  | "grants"
  | "match-strategy"
  | "scouting"
  | "build-pit"
  | "team-running"
  | "code-cad"
  | "writing";

export type AiSkillGroup = { id: AiSkillGroupId; name: string; blurb: string };

/** Browse order on the Ask AI page. */
export const AI_SKILL_GROUPS: readonly AiSkillGroup[] = [
  { id: "sponsorships", name: "Sponsorships and fundraising", blurb: "Who to ask next, outreach and renewals, matching gifts, media kit." },
  { id: "grants", name: "Grants and awards", blurb: "Grant deadlines and reports, impact essay, judging practice." },
  { id: "match-strategy", name: "Match strategy", blurb: "Match prep, defense, pick-list reasons, rule changes." },
  { id: "scouting", name: "Scouting insight", blurb: "What your scouts and video notes say about other teams." },
  { id: "build-pit", name: "Build and pit", blurb: "Repairs, wiring, troubleshooting, inspection, spares." },
  { id: "team-running", name: "Team running", blurb: "Meetings, stand-ups, parent updates, retros, season report." },
  { id: "code-cad", name: "Code and CAD", blurb: "Pull request reviews and pointers into the CAD agent." },
  { id: "writing", name: "Writing", blurb: "Emails, letters and answers from your team profile." },
];

/** Org roles, lowest to highest. View only members ask read-only things; they never trigger writes. */
export type AiSkillRole = "viewer" | "scout" | "admin" | "owner";

/** The hubs a member's hub-access allowlist can hide (packages/core hub-access). */
export type AiSkillHub = "competition" | "team" | "business" | "build";

/** Writer draft kinds (lib/writer/types.ts DraftKind) a skill may offer to save into. */
export type AiSkillDraftKind = "cold_intro" | "sponsorship_ask" | "renewal" | "thank_you" | "grant_followup" | "grant";

export type AiSkill = {
  id: string;
  /** Short name for the chip: "Using Sponsorships". */
  name: string;
  group: AiSkillGroupId;
  /** One line: what it does. */
  purpose: string;
  /** "Use it when…" — also the starters shown in the chat. Two to four. */
  starters: readonly string[];
  /** Plain words for the team data it reads (shown when browsing skills). */
  reads: readonly string[];
  /** Existing lib modules the executor calls. */
  libModules: readonly string[];
  /** Cheap keyword fallback. The model's own tool choice covers what this misses. */
  keywords: RegExp;
  access: {
    /** Lowest role that may use it. Every skill reads; View only can ask. */
    minRole: AiSkillRole;
    /** A member whose hub access hides this hub doesn't get the skill. */
    hub: AiSkillHub | null;
  };
  /** Where the work behind this skill lives: "Open Sponsors". */
  home: { label: string; path: string };
  /** Pages that open Ask AI pre-set to this skill (path prefixes; `?tab=` for hub tabs). */
  pages: readonly string[];
  /** Offer "Save as draft" (Writer drafts library) under an answer. Never for View only. */
  saveDraft: AiSkillDraftKind | null;
  /** Our own rules for the model on this skill. Fixed text — never a user's or a record's words. */
  guidance: string;
};

const NO_INVENTION =
  "Use only what the skill result and the person's message contain. Never invent names, amounts, dates, scores or records; if something is missing, say so and say where to add it.";

export const AI_SKILLS: readonly AiSkill[] = [
  // ── Sponsorships and fundraising ───────────────────────────────────────────
  {
    id: "sponsorships",
    name: "Sponsorships",
    group: "sponsorships",
    purpose: "Who to ask next, outreach and renewal emails, renewals due, and matching gifts — from your sponsor records.",
    starters: [
      "Who should we ask next?",
      "Draft a renewal email to our next renewal",
      "Which renewals or thank-yous are due?",
      "Any matching-gift programs we can use?",
    ],
    reads: ["Sponsor records and stages", "Contacts and last contact", "Contributions", "Follow-ups and renewals due", "Saved prospects", "Matching-gift programs"],
    libModules: ["lib/business-data", "lib/sponsor-pipeline", "lib/sponsor-renewal-roi", "lib/matching-gift-finder", "lib/sponsor-suite"],
    keywords:
      /\b(sponsor(?:s|ship|ships|ed|ing)?|donors?|donat(?:e|ion|ions)|fundrais\w*|pledges?|who (?:should|do|can) we ask|ask next|outreach email|renewal (?:email|letter|ask)|thank[- ]you (?:note|email|letter))\b/i,
    access: { minRole: "viewer", hub: "business" },
    home: { label: "Open Sponsors", path: "/business?tab=sponsors" },
    pages: ["/business?tab=sponsors", "/business?tab=sponsorship", "/business?tab=placements", "/business?tab=fundraisers", "/business?tab=sponsor-suite", "/business?tab=sponsor-wall", "/business?tab=sponsor-tier-calculator", "/business?tab=overview", "/sponsor-suite", "/sponsor-wall", "/sponsor-tier-calculator", "/sponsorship", "/fundraisers", "/team/sponsors"],
    saveDraft: "sponsorship_ask",
    guidance: [
      "Skill: Sponsorships.",
      NO_INVENTION,
      "To say who to ask next, follow the ranked askNext list in the skill result and give each one's reason in a few words.",
      "When asked for an email, address a sponsor from the records by name, use the contact name only if it is on record, and put [brackets] around anything the records do not have (amount, date, signature). Keep it under 180 words and ready to send after a read-through.",
      "Mention renewals and thank-yous that are due, and matching-gift programs that match a parent's or mentor's employer, when they help.",
      "With no sponsor records, say so plainly and tell them to add a sponsor on Business › Sponsors.",
    ].join(" "),
  },
  {
    id: "matching-gifts",
    name: "Matching gifts",
    group: "sponsorships",
    purpose: "Which parents' and mentors' employers match gifts, and what to send them.",
    starters: ["Which families can get a matching gift?", "Draft a matching-gift request letter"],
    reads: ["Matching-gift contacts and employers", "Known programs", "Pledges and their status"],
    libModules: ["lib/matching-gift-finder"],
    keywords: /\b(matching[- ]gifts?|employer match(?:ing)?|gift match(?:ing)?|company match(?:ing)?)\b/i,
    access: { minRole: "viewer", hub: "business" },
    home: { label: "Open Matching gifts", path: "/matching-gift-finder" },
    pages: ["/matching-gift-finder", "/business?tab=matching-gift-finder"],
    saveDraft: "sponsorship_ask",
    guidance: ["Skill: Matching gifts.", NO_INVENTION, "Only call a program a match when the skill result lists it for that employer."].join(" "),
  },
  {
    id: "sponsor-roi",
    name: "Renewal risk and ROI",
    group: "sponsorships",
    purpose: "Which sponsors may not renew, and the value report you can send them.",
    starters: ["Which sponsors are at risk of not renewing?", "What should our ROI report to a sponsor say?"],
    reads: ["Renewal-risk scores", "Contributions by season", "Saved ROI reports"],
    libModules: ["lib/sponsor-renewal-roi"],
    keywords: /\b(renewal risk|at[- ]risk sponsors?|roi|return on investment|sponsor (?:value )?report)\b/i,
    access: { minRole: "viewer", hub: "business" },
    home: { label: "Open Renewal risk", path: "/sponsor-renewal-roi" },
    pages: ["/sponsor-renewal-roi", "/business?tab=sponsor-renewal-roi"],
    saveDraft: "renewal",
    guidance: ["Skill: Renewal risk and ROI.", NO_INVENTION, "Explain a risk score from its listed parts only."].join(" "),
  },
  {
    id: "media-kit",
    name: "Media kit",
    group: "sponsorships",
    purpose: "Your team bio, mission and one-pager for sponsors and press.",
    starters: ["Write a two-sentence team bio", "What is missing from our media kit?"],
    reads: ["Media-kit profile", "Logos and photos list", "Saved one-pagers"],
    libModules: ["lib/media-kit"],
    keywords: /\b(media kit|press kit|one[- ]pager|team bio|mission statement)\b/i,
    access: { minRole: "viewer", hub: "business" },
    home: { label: "Open Media kit", path: "/media-kit" },
    pages: ["/media-kit", "/business?tab=media-kit", "/media-library"],
    saveDraft: null,
    guidance: ["Skill: Media kit.", NO_INVENTION].join(" "),
  },

  // ── Grants and awards ──────────────────────────────────────────────────────
  {
    id: "grant-reports",
    name: "Grant reports",
    group: "grants",
    purpose: "Report back to a funder on how an awarded grant was spent.",
    starters: ["Which grants need a report?", "Outline the report for our latest grant"],
    reads: ["Awarded grants", "Spending linked to each grant", "Saved reports"],
    libModules: ["lib/grant-report"],
    keywords: /\b(grant (?:report|reporting|update)|report (?:back )?to (?:the |our )?funder|how we spent (?:the|our) grant)\b/i,
    access: { minRole: "viewer", hub: "business" },
    home: { label: "Open Grant reports", path: "/grant-report" },
    pages: ["/grant-report", "/business?tab=grant-report"],
    saveDraft: "grant",
    guidance: ["Skill: Grant reports.", NO_INVENTION, "Dollar figures come only from the linked spending in the skill result."].join(" "),
  },
  {
    id: "impact-essay",
    name: "Impact essay",
    group: "grants",
    purpose: "Draft award essays (Impact, Engineering Inspiration, Dean's List) from your logged outreach and hours.",
    starters: ["Start our Impact award essay", "What evidence do we have for Engineering Inspiration?"],
    reads: ["Outreach and impact log", "Hours", "Sponsors and events", "Saved essay drafts"],
    libModules: ["lib/impact-essay"],
    keywords: /\b(impact (?:essay|award)|chairman'?s|engineering inspiration|\bei award|dean'?s list|award essay)\b/i,
    access: { minRole: "viewer", hub: "business" },
    home: { label: "Open Impact essay", path: "/impact-essay" },
    pages: ["/impact-essay", "/business?tab=impact-essay", "/business?tab=impact", "/impact", "/business?tab=award-tracker", "/business?tab=awards-workbench", "/award-tracker"],
    saveDraft: "grant",
    guidance: ["Skill: Impact essay.", NO_INVENTION, "Every claim must point at a logged activity, hour total or award in the skill result."].join(" "),
  },
  {
    id: "judging-practice",
    name: "Judging practice",
    group: "grants",
    purpose: "Practice judge questions and review past mock-judging notes.",
    starters: ["Give me five judge questions to practice", "What did judges ask us last time?"],
    reads: ["Judge-sim sessions and evidence", "Mock-judging sessions and prep notes"],
    libModules: ["lib/judge-sim", "lib/mock-judging"],
    keywords: /\b(judg(?:e|es|ing)|mock interview|pit interview|interview practice)\b/i,
    access: { minRole: "viewer", hub: "business" },
    home: { label: "Open Judging practice", path: "/judge-sim" },
    pages: ["/judge-sim", "/mock-judging", "/business?tab=judge-sim", "/business?tab=mock-judging"],
    saveDraft: null,
    guidance: ["Skill: Judging practice.", NO_INVENTION].join(" "),
  },
  {
    id: "grants",
    name: "Grants",
    group: "grants",
    purpose: "Grant deadlines, what each application still needs, and help answering a funder's question.",
    starters: ["Which grant deadlines are coming up?", "Help me answer a grant question"],
    reads: ["Grant applications and deadlines", "Requirements on file", "Awards on record", "Impact totals"],
    libModules: ["lib/business-data"],
    keywords: /\b(grants?|funders?|foundation application|application deadline)\b/i,
    access: { minRole: "viewer", hub: "business" },
    home: { label: "Open Grants", path: "/business?tab=grants" },
    pages: ["/business?tab=grants", "/business?tab=grant-calendar", "/business?tab=grant-eligibility-matcher", "/business?tab=evidence", "/team/grants", "/grant-eligibility-matcher"],
    saveDraft: "grant",
    guidance: ["Skill: Grants.", NO_INVENTION, "Quote deadlines exactly as recorded."].join(" "),
  },

  // ── Match strategy ─────────────────────────────────────────────────────────
  {
    id: "defense-planner",
    name: "Defense plans",
    group: "match-strategy",
    purpose: "Who to defend, how, and what your scouting says about it.",
    starters: ["Should we play defense next match?", "Who is worth defending at this event?"],
    reads: ["Defense matchups", "Scouting entries", "Event teams"],
    libModules: ["lib/defense-planner"],
    keywords: /\b(defen[cs]e|defend(?:ing)?|play d\b)\b/i,
    access: { minRole: "viewer", hub: "competition" },
    home: { label: "Open Defense plans", path: "/defense-planner" },
    pages: ["/defense-planner", "/competition?tab=defense-planner", "/counter-book", "/competition?tab=counter-book"],
    saveDraft: null,
    guidance: ["Skill: Defense plans.", NO_INVENTION].join(" "),
  },
  {
    id: "pick-list-reasons",
    name: "Pick-list reasons",
    group: "match-strategy",
    purpose: "Why each team sits where it does on your pick list, from your own data.",
    starters: ["Why is our first pick our first pick?", "Who might we be underrating?"],
    reads: ["Pick lists and their order", "Saved reasons", "Scouting and ratings"],
    libModules: ["lib/picklist-justifier"],
    keywords: /\b(pick ?lists?|alliance selection|who (?:should we|to) pick|first pick|second pick|draft order)\b/i,
    access: { minRole: "viewer", hub: "competition" },
    home: { label: "Open Pick desk", path: "/competition?tab=picks" },
    pages: ["/picklist-justifier", "/competition?tab=picks", "/competition?tab=picklist-justifier", "/competition?tab=pick-clock", "/competition?tab=alliance-selection-desk", "/pick-clock", "/alliance-selection-desk", "/strategy/draft"],
    saveDraft: null,
    guidance: ["Skill: Pick-list reasons.", NO_INVENTION].join(" "),
  },
  {
    id: "rule-impact",
    name: "Rule changes",
    group: "match-strategy",
    purpose: "What a rule or Team Update change means for your robot and strategy.",
    starters: ["What changed in the latest Team Update for us?", "Is our climber still legal?"],
    reads: ["Rule-impact assessments", "This season's rules", "Robot subsystems"],
    libModules: ["lib/rule-impact"],
    keywords: /\b(rule change|team update|rules? update|game manual|is (?:it|this|our \w+) (?:still )?legal|rule [GR]\d{2,4})\b/i,
    access: { minRole: "viewer", hub: "competition" },
    home: { label: "Open Rule changes", path: "/rule-impact" },
    pages: ["/rule-impact", "/kickoff", "/build?tab=kickoff"],
    saveDraft: null,
    guidance: ["Skill: Rule changes.", NO_INVENTION, "Quote rule numbers only when the skill result has them."].join(" "),
  },
  {
    id: "prediction-accuracy",
    name: "Prediction accuracy",
    group: "match-strategy",
    purpose: "How well match predictions have called played matches, and the biggest miss.",
    starters: ["How accurate have our predictions been?", "Which prediction missed worst?"],
    reads: ["Stored predictions", "Played match results"],
    libModules: ["lib/ai-insights (model_accuracy)"],
    keywords: /\b(prediction accuracy|how accurate|calibrat\w*|predicted wrong|biggest miss)\b/i,
    access: { minRole: "viewer", hub: "competition" },
    home: { label: "Open Schedule", path: "/schedule" },
    pages: ["/schedule", "/competition?tab=schedule", "/rankings", "/ranking-projection"],
    saveDraft: null,
    guidance: ["Skill: Prediction accuracy.", NO_INVENTION].join(" "),
  },
  {
    id: "match-prep",
    name: "Match prep",
    group: "match-strategy",
    purpose: "Your next match: partners, opponents, and a plan from scouting and event data.",
    starters: ["What's our plan for the next match?", "Who are our partners next match and what do they do?"],
    reads: ["Upcoming matches", "Match briefs", "Scouting", "Event data"],
    libModules: ["lib/match-copilot"],
    keywords: /\b(next match|match plan|pre[- ]?match|game plan|qual(?:ification)? ?\d+|qm ?\d+|briefing|match strategy|strategy for)\b/i,
    access: { minRole: "viewer", hub: "competition" },
    home: { label: "Open Pre-match briefing", path: "/competition?tab=briefing" },
    pages: ["/briefing", "/match-copilot", "/competition?tab=briefing", "/competition?tab=strategy", "/competition?tab=command", "/competition?tab=match-briefing", "/competition?tab=my-day", "/strategy", "/command", "/my-day", "/chemistry", "/match-strategy-cards", "/match-sim", "/alliance-sim", "/alliance-partner-brief"],
    saveDraft: null,
    guidance: ["Skill: Match prep.", NO_INVENTION].join(" "),
  },

  // ── Build and pit ──────────────────────────────────────────────────────────
  {
    id: "wiring",
    name: "Wiring",
    group: "build-pit",
    purpose: "Brownouts, CAN faults and breakers, checked against your wiring records.",
    starters: ["Why might we be browning out?", "What wiring checks are still open?"],
    reads: ["Wiring checks", "Power budget", "Failure notes"],
    libModules: ["lib/wiring-diagnoser"],
    keywords: /\b(wir(?:e|es|ing)|brown(?:ing)? ?outs?|can bus|can fault|breakers?|pdh|pdp|loose connection|electrical)\b/i,
    access: { minRole: "viewer", hub: "build" },
    home: { label: "Open Wiring", path: "/wiring-diagnoser" },
    pages: ["/wiring-diagnoser", "/wiring", "/power-budget", "/build?tab=power-budget"],
    saveDraft: null,
    guidance: ["Skill: Wiring.", NO_INVENTION, "Safety first: say to disable the robot before touching wiring."].join(" "),
  },
  {
    id: "inspection",
    name: "Inspection",
    group: "build-pit",
    purpose: "What still stands between you and passing inspection.",
    starters: ["What could fail us at inspection?", "Are we under the weight limit?"],
    reads: ["Inspection checklist", "Failures", "Weigh-ins"],
    libModules: ["lib/inspection-copilot", "lib/ai-insights (inspection_advisor)"],
    keywords: /\b(inspection|inspector|weigh[- ]?ins?|weight limit|bumper rules?|frame perimeter|pass inspection)\b/i,
    access: { minRole: "viewer", hub: "build" },
    home: { label: "Open Inspection", path: "/inspection" },
    pages: ["/inspection", "/inspection-copilot", "/robot-weigh-in", "/competition?tab=inspection-copilot", "/build?tab=inspection-copilot", "/build?tab=robot-weigh-in"],
    saveDraft: null,
    guidance: ["Skill: Inspection.", NO_INVENTION].join(" "),
  },
  {
    id: "repair-triage",
    name: "Pit repairs",
    group: "build-pit",
    purpose: "Triage what broke between matches and what to fix first.",
    starters: ["Something broke — what do we fix first?", "What repairs are still open?"],
    reads: ["Pit repair reports", "Failure notes", "Spares on hand"],
    libModules: ["lib/pit-repair-triage"],
    keywords: /\b(broke|broken|repairs?|damaged|pit crew|between matches|fix (?:the|our) robot)\b/i,
    access: { minRole: "viewer", hub: "competition" },
    home: { label: "Open Pit repairs", path: "/pit-repair-triage" },
    pages: ["/pit-repair-triage", "/competition?tab=pit-repair-triage", "/competition?tab=pit", "/pit"],
    saveDraft: null,
    guidance: ["Skill: Pit repairs.", NO_INVENTION].join(" "),
  },
  {
    id: "troubleshooting",
    name: "Troubleshooting",
    group: "build-pit",
    purpose: "Step through a symptom to the likely cause, using your past fixes.",
    starters: ["Our drivetrain won't move — where do we start?", "What have we fixed like this before?"],
    reads: ["Troubleshooting sessions", "Symptom tree", "Past fixes"],
    libModules: ["lib/troubleshoot"],
    keywords: /\b(troubleshoot\w*|not working|won'?t (?:move|drive|turn on|deploy|connect)|debug|error code|symptoms?)\b/i,
    access: { minRole: "viewer", hub: "build" },
    home: { label: "Open Troubleshooting", path: "/troubleshoot" },
    pages: ["/troubleshoot", "/build?tab=troubleshoot", "/bringup", "/build?tab=bringup"],
    saveDraft: null,
    guidance: ["Skill: Troubleshooting.", NO_INVENTION, "Safety first: disable the robot before hands-on checks."].join(" "),
  },
  {
    id: "spares",
    name: "Spares",
    group: "build-pit",
    purpose: "What spares to bring or reorder before you run out.",
    starters: ["What spares should we pack?", "What are we low on?"],
    reads: ["Spare forecast", "Spare-robot kit checklists", "Inventory and BOM"],
    libModules: ["lib/spare-forecast", "lib/spare-robot-kit", "lib/ai-insights (stock_advisor)"],
    keywords: /\b(spares?|spare parts|reorder|inventory|low on|run(?:ning)? out|stock)\b/i,
    access: { minRole: "viewer", hub: "build" },
    home: { label: "Open Spares", path: "/spare-forecast" },
    pages: ["/spare-forecast", "/spare-robot-kit", "/inventory", "/spares", "/packing", "/competition?tab=spare-robot-kit", "/competition?tab=packing", "/bin-shelf-locator"],
    saveDraft: null,
    guidance: ["Skill: Spares.", NO_INVENTION].join(" "),
  },
  {
    id: "robot-review",
    name: "Robot review",
    group: "build-pit",
    purpose: "The weakest subsystems on your robot blueprint and what to close next.",
    starters: ["Which subsystem is furthest behind?", "What should we finish before the next event?"],
    reads: ["Robot blueprint subsystems", "Their CAD, code and strategy links", "Blockers"],
    libModules: ["lib/ai-insights (robot_blueprint)", "lib/robot-blueprint"],
    keywords: /\b(blueprint|subsystem readiness|weakest subsystem|robot (?:review|status|readiness))\b/i,
    access: { minRole: "viewer", hub: "build" },
    home: { label: "Open Robot", path: "/robot" },
    pages: ["/robot", "/build?tab=robot", "/build?tab=subsystems", "/subsystems", "/readiness-score", "/build?tab=readiness-score"],
    saveDraft: null,
    guidance: ["Skill: Robot review.", NO_INVENTION].join(" "),
  },

  // ── Team running ───────────────────────────────────────────────────────────
  {
    id: "parent-updates",
    name: "Parent updates",
    group: "team-running",
    purpose: "A plain-words update for families about the coming week.",
    starters: ["Write this week's parent update", "What's on the calendar for families?"],
    reads: ["Whole-team calendar for the next 7 days"],
    libModules: ["lib/parent-comms"],
    keywords: /\b(parents?|families|guardians?|newsletter)\b/i,
    access: { minRole: "viewer", hub: "team" },
    home: { label: "Open Parents", path: "/team?tab=parents" },
    pages: ["/parents", "/team?tab=parents", "/parent-view"],
    saveDraft: null,
    guidance: ["Skill: Parent updates.", NO_INVENTION, "Write for a parent who has never seen a robot: no jargon."].join(" "),
  },
  {
    id: "standups",
    name: "Stand-ups",
    group: "team-running",
    purpose: "Today's stand-up: who did what, what's blocked.",
    starters: ["Summarize today's stand-up", "What's blocked right now?"],
    reads: ["Stand-up digest", "Tasks and blockers"],
    libModules: ["lib/standup-digest"],
    keywords: /\b(stand[- ]?ups?|daily update|blocked|blockers)\b/i,
    access: { minRole: "viewer", hub: "team" },
    home: { label: "Open Stand-up", path: "/standup-digest" },
    pages: ["/standup-digest", "/team?tab=standup-digest", "/tasks", "/todos", "/team?tab=todos", "/team?tab=task-board"],
    saveDraft: null,
    guidance: ["Skill: Stand-ups.", NO_INVENTION].join(" "),
  },
  {
    id: "meetings",
    name: "Meetings",
    group: "team-running",
    purpose: "A meeting agenda from open blockers, overdue tasks and unmade decisions.",
    starters: ["Build the agenda for our next meeting", "What action items are still open?"],
    reads: ["Open blockers", "Overdue tasks", "Unresolved decisions", "Action items"],
    libModules: ["lib/meeting-autopilot"],
    keywords: /\b(meetings?|agenda|action items?)\b/i,
    access: { minRole: "viewer", hub: "team" },
    home: { label: "Open Meeting agenda", path: "/meeting-autopilot" },
    pages: ["/meeting-autopilot", "/team?tab=meeting-autopilot"],
    saveDraft: null,
    guidance: ["Skill: Meetings.", NO_INVENTION].join(" "),
  },
  {
    id: "retros",
    name: "Retros",
    group: "team-running",
    purpose: "What went well, what broke, and what to carry into next time.",
    starters: ["Run a retro on our last event", "What lessons have we logged?"],
    reads: ["Retro sessions", "Learned items", "Hand-off notes"],
    libModules: ["lib/retro"],
    keywords: /\b(retro(?:spective)?s?|post[- ]?mortem|what went (?:well|wrong)|lessons learned)\b/i,
    access: { minRole: "viewer", hub: "team" },
    home: { label: "Open Retro", path: "/retro" },
    pages: ["/retro", "/team?tab=retro", "/match-debrief"],
    saveDraft: null,
    guidance: ["Skill: Retros.", NO_INVENTION].join(" "),
  },
  {
    id: "season-report",
    name: "Season report",
    group: "team-running",
    purpose: "The season in review, from your build, results, budget and outreach logs.",
    starters: ["Summarize our season so far", "What should our season report highlight?"],
    reads: ["Season snapshots", "Build, results, budget and outreach logs"],
    libModules: ["lib/season-report"],
    keywords: /\b(season (?:report|summary|recap|review)|end of (?:the )?season|year in review)\b/i,
    access: { minRole: "viewer", hub: "team" },
    home: { label: "Open Season report", path: "/season-report" },
    pages: ["/season-report", "/team?tab=season-report", "/season-rollover"],
    saveDraft: null,
    guidance: ["Skill: Season report.", NO_INVENTION].join(" "),
  },
  {
    id: "check-ins",
    name: "Check-ins",
    group: "team-running",
    purpose: "Who is on track with hours and who hasn't clocked in lately.",
    starters: ["Who should a mentor check in with?", "Who is behind on hours?"],
    reads: ["Logged hours", "Members"],
    libModules: ["lib/ai-insights (engagement_digest)", "lib/build-hours"],
    keywords: /\b(check in with|attendance|hours|who(?:'s| is) (?:behind|missing)|participation|engagement)\b/i,
    access: { minRole: "viewer", hub: "team" },
    home: { label: "Open Hours", path: "/hours" },
    pages: ["/hours", "/team?tab=hours", "/team?tab=attendance", "/attendance", "/mentor-hours", "/hours-self-view"],
    saveDraft: null,
    guidance: ["Skill: Check-ins.", NO_INVENTION, "Be kind: suggest a check-in, never a call-out."].join(" "),
  },
  {
    id: "schedule-risk",
    name: "Schedule risk",
    group: "team-running",
    purpose: "Overdue milestones, this week's load, and what threatens the next event.",
    starters: ["Are we on track for the next event?", "Which milestones are overdue?"],
    reads: ["Season milestones", "Calendar"],
    libModules: ["lib/ai-insights (schedule_risk)", "lib/season-calendar"],
    keywords: /\b(schedule risk|behind schedule|milestones?|on track)\b/i,
    access: { minRole: "viewer", hub: "team" },
    home: { label: "Open Calendar", path: "/team?tab=calendar" },
    pages: ["/calendar", "/team?tab=calendar", "/season-planning-workspace", "/team?tab=season-planning-workspace", "/roadmap"],
    saveDraft: null,
    guidance: ["Skill: Schedule risk.", NO_INVENTION].join(" "),
  },
  {
    id: "team-knowledge",
    name: "Team knowledge",
    group: "team-running",
    purpose: "Past decisions, who knows what, and onboarding new members.",
    starters: ["Why did we choose our drivetrain?", "Which skills does only one person have?", "Who should mentor our new members?"],
    reads: ["Decision log", "Knowledge gaps", "Onboarding buddy pairings"],
    libModules: ["lib/decision-search", "lib/knowledge-gap", "lib/onboarding-buddy"],
    keywords: /\b(decisions?|why did we|onboard(?:ing)?|new members?|knowledge gaps?|who knows|bus factor|buddy)\b/i,
    access: { minRole: "viewer", hub: "team" },
    home: { label: "Open Decision notes", path: "/decisions" },
    pages: ["/decisions", "/decision-search", "/knowledge-gap", "/onboarding-buddy", "/team?tab=decisions", "/team?tab=knowledge", "/team?tab=knowledge-gap", "/team?tab=onboarding-buddy", "/bus-factor", "/skills-graph", "/decision-critic"],
    saveDraft: null,
    guidance: ["Skill: Team knowledge.", NO_INVENTION].join(" "),
  },

  // ── Code and CAD ───────────────────────────────────────────────────────────
  {
    id: "code-review",
    name: "Code reviews",
    group: "code-cad",
    purpose: "What the latest pull request reviews found in your robot code.",
    starters: ["What did the last PR review flag?", "Which review findings are still open?"],
    reads: ["Stored pull request reviews", "Robot code map"],
    libModules: ["lib/github/pr-review-run"],
    keywords: /\b(pull requests?|\bprs?\b|code reviews?|github|robot code|wpilib|java code)\b/i,
    access: { minRole: "viewer", hub: "build" },
    home: { label: "Open Code", path: "/build?tab=code" },
    pages: ["/build?tab=code", "/code", "/bugbot", "/build?tab=bugbot", "/code-perf", "/code-deploy-log", "/build?tab=code-perf", "/build?tab=code-deploy-log"],
    saveDraft: null,
    guidance: ["Skill: Code reviews.", NO_INVENTION, "Quote file paths and findings exactly as stored; never claim a fix was pushed."].join(" "),
  },
  {
    id: "cad",
    name: "CAD",
    group: "code-cad",
    purpose: "Pointers into your CAD: briefs, vault files, and where the CAD agent edits Onshape.",
    starters: ["What CAD briefs do we have?", "Where do I ask the CAD agent to make a change?"],
    reads: ["CAD briefs", "CAD vault", "CAD connection status"],
    libModules: ["lib/cad (CAD agent lives at Build › CAD)"],
    keywords: /\b(cad|onshape|fusion|extrude|mechanism design|design brief)\b/i,
    access: { minRole: "viewer", hub: "build" },
    home: { label: "Open CAD", path: "/build?tab=cad" },
    pages: ["/build?tab=cad", "/cad", "/cad-vault", "/cad-change-radar", "/sketch-to-brief", "/build?tab=cad-vault", "/build?tab=cad-change-radar", "/build?tab=sketch-to-brief"],
    saveDraft: null,
    guidance: ["Skill: CAD.", NO_INVENTION, "CAD edits happen in the CAD agent on Build › CAD, never from this chat."].join(" "),
  },

  // ── Scouting insight ───────────────────────────────────────────────────────
  {
    id: "scouting-insight",
    name: "Scouting insight",
    group: "scouting",
    purpose: "What your scouts, video notes and overnight intel say about other teams.",
    starters: ["What did our scouts say about our next opponents?", "What came out of overnight intel?", "Sum up our video notes"],
    reads: ["Overnight intel brief", "Video review notes", "Scouting entries (through the team tools)"],
    libModules: ["lib/overnight-intel", "lib/ai-insights (video_scout_summary)"],
    keywords: /\b(scout(?:s|ing|ed)?|overnight|intel|video notes?|opponents?)\b/i,
    access: { minRole: "viewer", hub: "competition" },
    home: { label: "Open Scouting", path: "/competition?tab=scouting" },
    pages: ["/competition?tab=scouting", "/scouting", "/scout", "/video", "/video-analysis", "/overnight-intel", "/intel", "/dossier", "/teams", "/opponent-watchlist", "/competition?tab=teams", "/competition?tab=video", "/competition?tab=overnight-intel", "/competition?tab=intel"],
    saveDraft: null,
    guidance: ["Skill: Scouting insight.", NO_INVENTION, "Say whether each point is a scout's observation or a number from event data."].join(" "),
  },

  // ── Writing ────────────────────────────────────────────────────────────────
  {
    id: "writing",
    name: "Writing",
    group: "writing",
    purpose: "Emails, letters and grant answers in your team's voice, from your team profile.",
    starters: ["Write a cold email to a local engineering firm", "Answer a grant question about our impact", "Make this paragraph clearer"],
    reads: ["Writer team profile (mission, achievements, ask)", "Saved drafts", "Business facts"],
    libModules: ["lib/writer"],
    keywords: /\b(write|draft|email|letter|essay|rewrite|proofread|reword)\b/i,
    access: { minRole: "viewer", hub: null },
    home: { label: "Open saved drafts", path: "/ai?tab=writer" },
    pages: ["/ai?tab=writer", "/writer", "/team?tab=writer"],
    saveDraft: "cold_intro",
    guidance: ["Skill: Writing.", NO_INVENTION, "Put [brackets] around anything the team profile does not have."].join(" "),
  },
];

/** Keyword routing order: narrow skills before the umbrella ones that would also match. */
export const AI_SKILL_ROUTING_ORDER: readonly string[] = [
  "matching-gifts",
  "sponsor-roi",
  "media-kit",
  "grant-reports",
  "impact-essay",
  "judging-practice",
  "sponsorships",
  "grants",
  "defense-planner",
  "pick-list-reasons",
  "rule-impact",
  "prediction-accuracy",
  "match-prep",
  "wiring",
  "inspection",
  "repair-triage",
  "troubleshooting",
  "spares",
  "robot-review",
  "parent-updates",
  "standups",
  "meetings",
  "retros",
  "season-report",
  "check-ins",
  "schedule-risk",
  "team-knowledge",
  "code-review",
  "cad",
  "scouting-insight",
  "writing",
];

const BY_ID = new Map(AI_SKILLS.map((skill) => [skill.id, skill]));

export function aiSkillById(id: string | null | undefined): AiSkill | null {
  if (!id) return null;
  return BY_ID.get(id.trim().toLowerCase()) ?? null;
}

export function aiSkillGroup(id: AiSkillGroupId): AiSkillGroup {
  return AI_SKILL_GROUPS.find((group) => group.id === id)!;
}

export function aiSkillsInGroup(id: AiSkillGroupId): AiSkill[] {
  return AI_SKILLS.filter((skill) => skill.group === id);
}

/**
 * The cheap keyword router: the first skill (in routing order) whose words appear in the
 * message, or null. The model can still pick a skill itself when the provider calls tools.
 */
export function chooseAiSkillByKeywords(message: string, allowed?: ReadonlySet<string>): AiSkill | null {
  const text = message.trim();
  if (!text) return null;
  for (const id of AI_SKILL_ROUTING_ORDER) {
    if (allowed && !allowed.has(id)) continue;
    const skill = BY_ID.get(id);
    if (skill?.keywords.test(text)) return skill;
  }
  return null;
}

/** "/business" + "?tab=sponsors&orgId=…" → "/business?tab=sponsors". Other params are not a page. */
function pageKey(pathname: string, search = ""): { path: string; tabbed: string | null } {
  const path = (pathname || "/").replace(/\/+$/, "") || "/";
  const tab = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("tab");
  return { path, tabbed: tab ? `${path}?tab=${tab}` : null };
}

/**
 * The skill a page opens Ask AI on, or null. A hub tab (`/business?tab=sponsors`) wins over the
 * hub path; the longest path prefix wins otherwise (`/team/sponsors` over `/team`).
 */
export function aiSkillForPage(pathname: string, search = ""): AiSkill | null {
  const { path, tabbed } = pageKey(pathname, search);
  if (tabbed) {
    const exact = AI_SKILLS.find((skill) => skill.pages.includes(tabbed));
    if (exact) return exact;
  }
  let best: { skill: AiSkill; length: number } | null = null;
  for (const skill of AI_SKILLS) {
    for (const page of skill.pages) {
      if (page.includes("?")) continue;
      if (path === page || path.startsWith(`${page}/`)) {
        if (!best || page.length > best.length) best = { skill, length: page.length };
      }
    }
  }
  return best?.skill ?? null;
}

const ROLE_RANK: Record<AiSkillRole, number> = { viewer: 0, scout: 1, admin: 2, owner: 3 };

export function roleMeets(role: string | null | undefined, minRole: AiSkillRole): boolean {
  const rank = ROLE_RANK[(role ?? "") as AiSkillRole];
  return rank !== undefined && rank >= ROLE_RANK[minRole];
}

/** View only members may ask; only members who can change team data get "Save as draft". */
export function canSaveSkillDraft(skill: AiSkill | null, role: string | null | undefined): boolean {
  return Boolean(skill?.saveDraft) && roleMeets(role, "scout");
}

export type AskAiLink = {
  orgId?: string | null;
  /** Skill id to open on, or null to let the assistant choose. */
  skill?: string | null;
  /** The page the person came from (path + its tab), shown as "from …" and passed to the skill. */
  from?: string | null;
  /** A starter to put in the box (not sent until they press Send). */
  prompt?: string | null;
  /** What on that page this is about, e.g. a sponsor's name. */
  about?: string | null;
  /** Record ids the skill can narrow to. */
  sponsorId?: string | null;
  teamKey?: string | null;
  matchKey?: string | null;
  /** "background": open with "work on this in the background" switched on. */
  mode?: "background" | null;
};

/** The one way into Ask AI from any page. */
export function askAiHref(link: AskAiLink = {}): string {
  const params = new URLSearchParams();
  const skill = aiSkillById(link.skill ?? null);
  if (skill) params.set("skill", skill.id);
  if (link.from?.trim()) params.set("from", link.from.trim().slice(0, 200));
  if (link.about?.trim()) params.set("about", link.about.trim().slice(0, 120));
  if (link.prompt?.trim()) params.set("prompt", link.prompt.trim().slice(0, 600));
  if (link.sponsorId?.trim()) params.set("sponsorId", link.sponsorId.trim());
  if (link.teamKey?.trim()) params.set("teamKey", link.teamKey.trim().toLowerCase());
  if (link.matchKey?.trim()) params.set("matchKey", link.matchKey.trim().toLowerCase());
  if (link.mode === "background") params.set("mode", "background");
  if (link.orgId?.trim()) params.set("orgId", link.orgId.trim());
  const query = params.toString();
  return query ? `/ai?${query}` : "/ai";
}

/** A friendly label for the page Ask AI was opened from ("Sponsors", "Hours"). */
export function pageLabelFor(from: string | null | undefined): string | null {
  if (!from) return null;
  const [path = "", search = ""] = from.split("?");
  const tab = new URLSearchParams(search).get("tab");
  const raw = (tab ?? path.split("/").filter(Boolean).pop() ?? "").replace(/[-_]+/g, " ").trim();
  if (!raw) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
