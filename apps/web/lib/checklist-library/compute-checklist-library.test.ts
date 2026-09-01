import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { checklistLibraryCategoryLabel, runProgress, sanitizeItems, summarizeChecklistLibrary } from ".";
import { computeChecklistLibraryView, instantiatePitChecklist } from "./compute-checklist-library";
import type { ChecklistLibraryRun, ChecklistLibraryTemplate } from "./types";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

function mockClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number }): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => Promise.resolve(handler(sql, params))),
  } as unknown as PoolClient;
}

describe("pure helpers", () => {
  it("sanitizes item lists, deriving keys from labels and dropping blanks", () => {
    const items = sanitizeItems([{ label: "Bumpers on" }, { label: "" }, { key: "battery", label: "Battery charged" }]);
    expect(items).toEqual([
      { key: "bumpers-on", label: "Bumpers on" },
      { key: "battery", label: "Battery charged" },
    ]);
  });

  it("computes run progress and allDone", () => {
    const items = [{ key: "a", label: "A" }, { key: "b", label: "B" }];
    const none = runProgress(items, []);
    expect(none.progress).toBe(0);
    expect(none.allDone).toBe(false);

    const partial = runProgress(items, [{ key: "a", checkedAt: "2026-07-01T00:00:00.000Z" }]);
    expect(partial.progress).toBe(0.5);
    expect(partial.allDone).toBe(false);

    const full = runProgress(items, [
      { key: "a", checkedAt: "2026-07-01T00:00:00.000Z" },
      { key: "b", checkedAt: "2026-07-01T00:00:00.000Z" },
    ]);
    expect(full.allDone).toBe(true);
  });

  it("summarizes templates and runs by category", () => {
    const templates: ChecklistLibraryTemplate[] = [
      { id: "t1", name: "Pit setup", category: "pit", description: null, items: [], active: true, createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const runs: ChecklistLibraryRun[] = [
      {
        id: "r1",
        templateId: "t1",
        templateName: "Pit setup",
        category: "pit",
        label: "Week 1",
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: null,
        items: [],
        checkedItems: [],
        allDone: false,
        progress: 0,
      },
    ];
    const summary = summarizeChecklistLibrary(templates, runs);
    expect(summary.totalTemplates).toBe(1);
    expect(summary.totalRuns).toBe(1);
    expect(summary.openRuns).toBe(1);
    expect(summary.byCategory).toEqual([{ category: "pit", templates: 1, runs: 1 }]);
  });

  it("labels categories for display", () => {
    expect(checklistLibraryCategoryLabel("load_in")).toBe("Load-in");
    expect(checklistLibraryCategoryLabel("other")).toBe("Other");
  });
});

describe("computeChecklistLibraryView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    const view = await computeChecklistLibraryView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with templates and run progress derived from checked items", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("JOIN organizations")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM checklist_library_templates")) {
        return {
          rows: [
            {
              id: "tmpl-1",
              name: "Load-in kit",
              category: "load_in",
              description: null,
              items: [{ key: "tote", label: "Totes loaded" }, { key: "battery", label: "Batteries charged" }],
              active: true,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM checklist_library_runs")) {
        return {
          rows: [
            {
              id: "run-1",
              templateId: "tmpl-1",
              templateName: "Load-in kit",
              category: "load_in",
              label: "Week 3 Regional",
              startedAt: "2026-07-01T00:00:00.000Z",
              completedAt: null,
              templateItems: [{ key: "tote", label: "Totes loaded" }, { key: "battery", label: "Batteries charged" }],
              checkedItems: [{ key: "tote", checkedAt: "2026-07-01T01:00:00.000Z" }],
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeChecklistLibraryView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.orgId).toBe(ORG);
      expect(view.templates).toHaveLength(1);
      expect(view.runs).toHaveLength(1);
      expect(view.runs[0]?.progress).toBe(0.5);
      expect(view.runs[0]?.allDone).toBe(false);
      expect(view.summary.totalTemplates).toBe(1);
      expect(view.summary.openRuns).toBe(1);
      expect(view.pitChecklist.href).toBe(`/competition?tab=match-checklist&orgId=${ORG}`);
      expect(view.pitChecklist.runs).toEqual([]);
    }
  });

  it("projects match_checklist_runs as the pit system of record, never as library copies", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("JOIN organizations")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM match_checklist_runs")) {
        return {
          rows: [
            {
              id: "pit-1",
              matchLabel: "Qual 12",
              eventKey: "2026miket",
              startedAt: "2026-07-01T00:00:00.000Z",
              completedAt: null,
              items: [
                { key: "bumper", label: "Bumpers secured", done: true },
                { key: "battery", label: "Battery seated", done: false },
              ],
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const view = await computeChecklistLibraryView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status === "live") {
      expect(view.runs).toEqual([]);
      expect(view.pitChecklist.openRuns).toBe(1);
      expect(view.pitChecklist.completedRuns).toBe(0);
      expect(view.pitChecklist.runs[0]).toMatchObject({
        id: "pit-1",
        matchLabel: "Qual 12",
        itemCount: 2,
        checkedCount: 1,
        href: `/competition?tab=match-checklist&orgId=${ORG}`,
      });
    }
  });
});

describe("instantiatePitChecklist", () => {
  it("writes match_checklist_runs from the stored SOP and never a library run", async () => {
    const inserts: Array<{ sql: string; params: unknown[] }> = [];
    const client = mockClient((sql, params) => {
      if (sql.includes("FROM checklist_library_templates")) {
        return {
          rows: [
            {
              id: "tmpl-1",
              name: "Pre-queue SOP",
              category: "pit",
              description: null,
              items: [
                { key: "bumper", label: "Bumpers secured" },
                { key: "tote", label: "Totes loaded" },
              ],
              active: true,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM organizations")) {
        return { rows: [{ teamNumber: 254 }], rowCount: 1 };
      }
      if (sql.includes("FROM org_active_context")) {
        return { rows: [{ activeEventKey: "2026miket" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO match_checklist_runs")) {
        inserts.push({ sql, params });
        return { rows: [{ id: "pit-run-1" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO checklist_library_runs")) {
        throw new Error("library runs are not the pit system of record");
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await instantiatePitChecklist(client, {
      orgId: ORG,
      userId: USER,
      templateId: "tmpl-1",
      matchLabel: "Qual 12",
    });

    expect(result).toEqual({
      runId: "pit-run-1",
      href: `/competition?tab=match-checklist&orgId=${ORG}`,
      itemCount: 1,
      unmappedCount: 1,
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.params[1]).toBe("Qual 12");
    expect(inserts[0]?.params[2]).toBe("2026miket");
    expect(inserts[0]?.params[3]).toBe(254);
    const stored = JSON.parse(String(inserts[0]?.params[4])) as Array<{ key: string; sourceTemplateId: string }>;
    expect(stored).toEqual([
      expect.objectContaining({
        key: "bumper",
        label: "Bumpers secured",
        done: false,
        sourceSopKey: "bumper",
        sourceTemplateId: "tmpl-1",
      }),
    ]);
  });

  it("refuses an inactive SOP instead of opening a hollow pit run", async () => {
    const client = mockClient((sql) => {
      if (sql.includes("FROM checklist_library_templates")) {
        return {
          rows: [
            {
              id: "tmpl-1",
              name: "Retired",
              category: "pit",
              description: null,
              items: [{ key: "bumper", label: "Bumpers" }],
              active: false,
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      instantiatePitChecklist(client, {
        orgId: ORG,
        userId: USER,
        templateId: "tmpl-1",
        matchLabel: "Qual 12",
      }),
    ).rejects.toThrow(/activate/i);
  });
});
