/**
 * Source audit of the main routes' header and first toolbar, taken 2026-10-26
 * before PageToolbar, and the placement the rule applies.
 *
 * Counts are button-like controls in that toolbar (a filled or quiet button, or
 * a link drawn as a button). Hub section tabs, settings rows, and per-row
 * actions are navigation or repeats, not this toolbar. Stylesheets do not hide
 * these controls between 390px and 1440px; they wrap. The same count applies
 * at both widths unless `note` says otherwise.
 *
 * `before` is how many of those controls the ready screen showed. `after` is
 * how many remain one tap away once More is counted as one control.
 */
import { layoutPageToolbar, visibleToolbarControls, type PageActionInput } from "./page-toolbar-model";

export type ToolbarAudit = {
  route: string;
  /** Visible button-like controls before the shared toolbar. Same at 1440 and 390. */
  before: number;
  actions: readonly PageActionInput[];
  /** Ids that must land in More. */
  overflow: readonly string[];
  note: string;
};

export const TOOLBAR_AUDITS: readonly ToolbarAudit[] = [
  {
    route: "dashboard",
    before: 2,
    actions: [
      { id: "empty", intent: "secondary" },
      { id: "edit", intent: "secondary" },
    ],
    overflow: [],
    note: "Home heading: Edit, plus Show empty cards when there is one board and some cards are hidden. Refresh sits under the board.",
  },
  {
    route: "competition",
    before: 0,
    actions: [],
    overflow: [],
    note: "The hub's section row is navigation. The embedded Scouting header is not shown.",
  },
  {
    route: "scouting",
    before: 2,
    actions: [
      { id: "share", intent: "secondary" },
      { id: "print", intent: "secondary" },
    ],
    overflow: [],
    note: "Copy share link and Print. Sync now appears only when something is waiting.",
  },
  {
    route: "strategy",
    before: 6,
    actions: [
      { id: "share", intent: "secondary" },
      { id: "print", intent: "secondary" },
      { id: "recompute", intent: "primary" },
      { id: "draft", intent: "secondary" },
      { id: "export", intent: "secondary" },
      { id: "team-data", intent: "secondary" },
    ],
    overflow: ["export", "team-data"],
    note: "Export and Team data move under More. Recompute stays the one filled action.",
  },
  {
    route: "schedule",
    before: 1,
    actions: [{ id: "refresh", intent: "secondary" }],
    overflow: [],
    note: "Refresh. Predict stays on each unplayed match row. Open the form stays on the assignment card.",
  },
  {
    route: "my-day",
    before: 0,
    actions: [],
    overflow: [],
    note: "Ready header is the title and related links.",
  },
  {
    route: "command",
    before: 3,
    actions: [
      { id: "refresh", intent: "secondary" },
      { id: "plan", intent: "secondary" },
      { id: "share", intent: "chrome" },
    ],
    overflow: [],
    note: "Refresh, Plan events, and the Share disclosure. Share is one control, not a second menu of actions.",
  },
  {
    route: "match-sim",
    before: 1,
    actions: [{ id: "predict", intent: "primary" }],
    overflow: [],
    note: "The form's Predict submit is the one filled action. The page header has none.",
  },
  {
    route: "ranking-projection",
    before: 4,
    actions: [
      { id: "best-path", intent: "primary" },
      { id: "apply", intent: "secondary" },
      { id: "clear", intent: "secondary" },
      { id: "ours", intent: "secondary" },
    ],
    overflow: [],
    note: "Planner worst case: Show best path, Apply, Clear, and Only our matches. That is the cap, so nothing moves. Open rankings stays a quiet link on the summary panel above the planner.",
  },
  {
    route: "intel",
    before: 2,
    actions: [
      { id: "brief", intent: "primary" },
      { id: "notes", intent: "secondary" },
    ],
    overflow: [],
    note: "Team card. Search is the lookup form's own filled action, on the form rather than this card.",
  },
  {
    route: "team",
    before: 0,
    actions: [],
    overflow: [],
    note: "Hub header has no action buttons. Sections are navigation.",
  },
  {
    route: "messages",
    before: 2,
    actions: [
      { id: "rename", intent: "secondary" },
      { id: "archive", intent: "destructive" },
    ],
    overflow: ["archive"],
    note: "A channel you created. The default team channel has neither. Archive moves under More.",
  },
  {
    route: "calendar",
    before: 1,
    actions: [{ id: "template", intent: "primary" }],
    overflow: [],
    note: "Use this template, inside the season panel. The page header has no buttons.",
  },
  {
    route: "todos",
    before: 1,
    actions: [{ id: "board", intent: "secondary" }],
    overflow: [],
    note: "Task board, in the header when the list is live.",
  },
  {
    route: "files",
    before: 3,
    actions: [
      { id: "layout", intent: "chrome" },
      { id: "upload", intent: "primary" },
    ],
    overflow: [],
    note: "Grid and List are one layout switch (two segments, counted in before). Upload is the filled action.",
  },
  {
    route: "business",
    before: 0,
    actions: [],
    overflow: [],
    note: "Hub header has no action buttons.",
  },
  {
    route: "build",
    before: 0,
    actions: [],
    overflow: [],
    note: "Hub header has no action buttons.",
  },
  {
    route: "ai",
    before: 0,
    actions: [],
    overflow: [],
    note: "Hub header has no action buttons.",
  },
  {
    route: "settings",
    before: 0,
    actions: [],
    overflow: [],
    note: "The list is navigation. Clear search appears only while a query is typed.",
  },
  {
    route: "account",
    before: 0,
    actions: [],
    overflow: [],
    note: "Header has no buttons. A failed load offers one Retry.",
  },
  {
    route: "notifications",
    before: 1,
    actions: [{ id: "read", intent: "secondary" }],
    overflow: [],
    note: "Mark all as read, only when something is unread. The filter is a menu, not a row of buttons.",
  },
  {
    route: "hours",
    before: 3,
    actions: [
      { id: "sync", intent: "secondary" },
      { id: "export", intent: "secondary" },
      { id: "end", intent: "destructive" },
    ],
    overflow: ["end"],
    note: "When a queue is waiting, an admin can export, and people are clocked in: Sync, Export CSV, and End meeting. End meeting moves under More. The clock card keeps its own filled action.",
  },
  {
    route: "pit",
    before: 1,
    actions: [{ id: "tv", intent: "secondary" }],
    overflow: [],
    note: "Show on the Pit TV.",
  },
  {
    route: "scout",
    before: 2,
    actions: [
      { id: "pit", intent: "primary" },
      { id: "match", intent: "secondary" },
    ],
    overflow: [],
    note: "One card is filled, the other is quiet. Which card is filled follows the next match.",
  },
  {
    route: "workspace",
    before: 6,
    actions: [
      { id: "scout", intent: "primary" },
      { id: "pit", intent: "secondary" },
      { id: "intel", intent: "secondary" },
      { id: "dossier", intent: "secondary" },
      { id: "ask", intent: "secondary" },
      { id: "cad", intent: "secondary" },
    ],
    overflow: ["ask", "cad"],
    note: "Ask AI and CAD agent move under More. Scout now stays filled.",
  },
];

export function auditAfter(row: ToolbarAudit): { visible: number; overflow: string[] } {
  const layout = layoutPageToolbar(row.actions);
  return { visible: visibleToolbarControls(layout), overflow: layout.overflow };
}
