// Checklist Library domain types. Pure data shapes — no I/O, no framework imports.
// A reusable checklist library: teams define named templates (pit setup, transport
// load-out, competition load-in) once and re-run them at every event, checking off
// items and tracking how complete each run is.

export type ChecklistLibraryCategory = "pit" | "transport" | "load_in" | "load_out" | "other";

export type ChecklistLibraryItem = {
  key: string;
  label: string;
};

export type ChecklistLibraryTemplate = {
  id: string;
  name: string;
  category: ChecklistLibraryCategory;
  description: string | null;
  items: ChecklistLibraryItem[];
  active: boolean;
  createdAt: string;
};

export type ChecklistLibraryCheckedItem = {
  key: string;
  checkedAt: string;
};

export type ChecklistLibraryRun = {
  id: string;
  templateId: string;
  templateName: string;
  category: ChecklistLibraryCategory;
  label: string;
  startedAt: string;
  completedAt: string | null;
  items: ChecklistLibraryItem[];
  checkedItems: ChecklistLibraryCheckedItem[];
  /** True once every item on the template has a matching checked entry. */
  allDone: boolean;
  /** 0..1 fraction of items checked. */
  progress: number;
};

export type ChecklistLibrarySummary = {
  totalTemplates: number;
  activeTemplates: number;
  totalRuns: number;
  openRuns: number;
  completedRuns: number;
  byCategory: Array<{ category: ChecklistLibraryCategory; templates: number; runs: number }>;
};

/**
 * Pit/match item keys the Event Day checklist already understands.
 * Kept here so match-checklist can import the instantiate helper later without
 * this library depending on that module at runtime.
 */
export const PIT_CHECKLIST_ITEM_KEYS = [
  "bumper",
  "battery",
  "tether",
  "code",
  "sb50",
  "ds_power",
  "ds_ethernet",
  "ds_estop",
  "ds_shelf",
  "lenses",
  "bolts",
  "kraken_screws",
  "anderson_lock",
  "controller_lock",
  "ds_usb",
] as const;

export type PitChecklistItemKey = (typeof PIT_CHECKLIST_ITEM_KEYS)[number];

/** Shape match-checklist already persists on `match_checklist_runs.items`. */
export type PitChecklistItem = {
  key: PitChecklistItemKey;
  label: string;
  done: boolean;
  checkedAt: string | null;
  /** Original SOP key — ignored by today's pit sanitizer, kept for later import. */
  sourceSopKey: string;
};

export type PitChecklistInstantiation = {
  source: "checklist-library";
  templateId: string;
  templateName: string;
  matchLabel: string;
  items: PitChecklistItem[];
  unmapped: ChecklistLibraryItem[];
};

/** Read-through of `match_checklist_runs` — the pit SoR, not a copy. */
export type ChecklistLibraryPitRun = {
  id: string;
  matchLabel: string;
  eventKey: string | null;
  startedAt: string;
  completedAt: string | null;
  itemCount: number;
  checkedCount: number;
  href: string;
};

export type ChecklistLibraryPitProjection = {
  href: string;
  openRuns: number;
  completedRuns: number;
  runs: ChecklistLibraryPitRun[];
};

export type TemplatePitPreview = {
  mappedCount: number;
  unmapped: ChecklistLibraryItem[];
};
