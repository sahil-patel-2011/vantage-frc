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
