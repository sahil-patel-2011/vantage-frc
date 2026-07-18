// Pure helper functions for Checklist Library — no I/O, no framework imports.
// Unit-testable in isolation from the DB layer.

import type {
  ChecklistLibraryCategory,
  ChecklistLibraryCheckedItem,
  ChecklistLibraryItem,
  ChecklistLibraryRun,
  ChecklistLibrarySummary,
  ChecklistLibraryTemplate,
} from "./types";

export const CHECKLIST_LIBRARY_CATEGORIES: ChecklistLibraryCategory[] = [
  "pit",
  "transport",
  "load_in",
  "load_out",
  "other",
];

const CATEGORY_LABELS: Record<ChecklistLibraryCategory, string> = {
  pit: "Pit setup",
  transport: "Transport",
  load_in: "Load-in",
  load_out: "Load-out",
  other: "Other",
};

export function checklistLibraryCategoryLabel(category: ChecklistLibraryCategory): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** Compute run progress/allDone from a template's items and the run's checked entries. */
export function runProgress(
  items: ChecklistLibraryItem[],
  checkedItems: ChecklistLibraryCheckedItem[],
): { progress: number; allDone: boolean } {
  if (items.length === 0) return { progress: 0, allDone: false };
  const checkedKeys = new Set(checkedItems.map((c) => c.key));
  const checkedCount = items.filter((item) => checkedKeys.has(item.key)).length;
  const progress = checkedCount / items.length;
  return { progress, allDone: checkedCount === items.length };
}

export function summarizeChecklistLibrary(
  templates: ChecklistLibraryTemplate[],
  runs: ChecklistLibraryRun[],
): ChecklistLibrarySummary {
  const byCategory = CHECKLIST_LIBRARY_CATEGORIES.map((category) => ({
    category,
    templates: templates.filter((t) => t.category === category).length,
    runs: runs.filter((r) => r.category === category).length,
  })).filter((row) => row.templates > 0 || row.runs > 0);

  return {
    totalTemplates: templates.length,
    activeTemplates: templates.filter((t) => t.active).length,
    totalRuns: runs.length,
    openRuns: runs.filter((r) => !r.completedAt).length,
    completedRuns: runs.filter((r) => r.completedAt).length,
    byCategory,
  };
}

export function sanitizeItems(raw: unknown): ChecklistLibraryItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: ChecklistLibraryItem[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const label = typeof (entry as { label?: unknown }).label === "string" ? (entry as { label: string }).label.trim() : "";
    if (!label) continue;
    let key = typeof (entry as { key?: unknown }).key === "string" ? (entry as { key: string }).key.trim() : "";
    if (!key) key = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({ key, label: label.slice(0, 200) });
  }
  return items.slice(0, 100);
}

export * from "./types";
