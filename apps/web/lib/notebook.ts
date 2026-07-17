// Engineering / build notebook: dated design-decision entries tagged by
// subsystem and build phase. This is the team's build-season record — useful on
// its own and as concrete evidence when writing the Impact award. Pure helpers
// (validation, tag parsing, rollups) live here and are shared by API + UI.

export const BUILD_PHASES = [
  "brainstorm",
  "design",
  "prototype",
  "build",
  "test",
  "iterate",
  "competition",
  "reflection",
] as const;
export type BuildPhase = (typeof BUILD_PHASES)[number];

export const BUILD_PHASE_LABEL: Record<BuildPhase, string> = {
  brainstorm: "Brainstorm",
  design: "Design",
  prototype: "Prototype",
  build: "Build",
  test: "Test",
  iterate: "Iterate",
  competition: "Competition",
  reflection: "Reflection",
};

const MAX_TAGS = 10;
const MAX_TAG_LEN = 30;

export function parseTags(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const tag = item.trim().toLowerCase().slice(0, MAX_TAG_LEN);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

export type EntryInput = { title: string; entryDate: string; phase: BuildPhase; subsystem: string; body: string; tags: string[] };

export function validateEntry(
  raw: Record<string, unknown>,
): { ok: true; value: EntryInput } | { ok: false; error: string } {
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!title) return { ok: false, error: "Title is required" };
  const entryDate = typeof raw.entryDate === "string" ? raw.entryDate : "";
  if (!entryDate || Number.isNaN(new Date(entryDate).getTime())) return { ok: false, error: "A valid date is required" };
  const phase = String(raw.phase ?? "");
  if (!BUILD_PHASES.includes(phase as BuildPhase)) return { ok: false, error: "Invalid build phase" };
  const subsystem = typeof raw.subsystem === "string" ? raw.subsystem.trim() : "";
  const body = typeof raw.body === "string" ? raw.body.trim() : "";
  return { ok: true, value: { title, entryDate, phase: phase as BuildPhase, subsystem, body, tags: parseTags(raw.tags) } };
}

export function summarizeNotebook(entries: { subsystem: string; phase: BuildPhase; entryDate: string }[]) {
  const bySubsystem = new Map<string, number>();
  const byPhase = new Map<BuildPhase, number>();
  for (const entry of entries) {
    const key = entry.subsystem || "General";
    bySubsystem.set(key, (bySubsystem.get(key) ?? 0) + 1);
    byPhase.set(entry.phase, (byPhase.get(entry.phase) ?? 0) + 1);
  }
  const lastEntryOn = entries.length
    ? entries.map((e) => e.entryDate).sort((a, b) => b.localeCompare(a))[0]!
    : null;
  return {
    total: entries.length,
    subsystems: [...bySubsystem.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    phases: BUILD_PHASES.filter((p) => byPhase.has(p)).map((p) => ({ phase: p, count: byPhase.get(p)! })),
    lastEntryOn,
  };
}

// ---- request validation --------------------------------------------------

export type NotebookAction =
  | { action: "create_entry"; orgId: string; seasonYear: number; title: string; entryDate: string; phase: BuildPhase; subsystem: string; body: string; tags: string[] }
  | { action: "update_entry"; orgId: string; id: string; patch: { title?: string; phase?: BuildPhase; subsystem?: string; body?: string; tags?: string[] } }
  | { action: "delete_entry"; orgId: string; id: string };

function reqStr(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export function parseNotebookAction(raw: unknown): NotebookAction {
  if (!raw || typeof raw !== "object") throw new Error("Invalid request body");
  const body = raw as Record<string, unknown>;
  const action = reqStr(body.action, "action");
  const orgId = reqStr(body.orgId, "orgId");

  switch (action) {
    case "create_entry": {
      const validated = validateEntry(body);
      if (!validated.ok) throw new Error(validated.error);
      const seasonYear = Number(body.seasonYear);
      if (!Number.isInteger(seasonYear)) throw new Error("seasonYear is required");
      return { action, orgId, seasonYear, ...validated.value };
    }
    case "update_entry": {
      const patch: { title?: string; phase?: BuildPhase; subsystem?: string; body?: string; tags?: string[] } = {};
      if (body.title !== undefined) patch.title = reqStr(body.title, "title");
      if (body.phase !== undefined) {
        const phase = String(body.phase);
        if (!BUILD_PHASES.includes(phase as BuildPhase)) throw new Error("Invalid build phase");
        patch.phase = phase as BuildPhase;
      }
      if (body.subsystem !== undefined) patch.subsystem = typeof body.subsystem === "string" ? body.subsystem.trim() : "";
      if (body.body !== undefined) patch.body = typeof body.body === "string" ? body.body.trim() : "";
      if (body.tags !== undefined) patch.tags = parseTags(body.tags);
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id: reqStr(body.id, "id"), patch };
    }
    case "delete_entry":
      return { action, orgId, id: reqStr(body.id, "id") };
    default:
      throw new Error("Unsupported notebook action");
  }
}
