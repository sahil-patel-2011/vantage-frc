import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import type { WorkItem } from "../work-items/types";
import {
  computeKnowledgeGapView,
  draftStubPage,
  fromPersistedSubjectKind,
  runKnowledgeGapScan,
  toPersistedSubjectKind,
} from "./compute-knowledge-gap";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

vi.mock("../work-items/service", () => ({
  loadWorkItems: vi.fn(),
}));

import { loadWorkItems } from "../work-items/service";

const loadWorkItemsMock = vi.mocked(loadWorkItems);

function workItem(over: Partial<WorkItem> & Pick<WorkItem, "id" | "source" | "title">): WorkItem {
  return {
    orgId: ORG,
    status: "planned",
    dueOn: null,
    owners: [],
    grouping: null,
    subteamId: null,
    createdAt: "2026-02-01T00:00:00.000Z",
    completedAt: null,
    href: "/todos",
    flags: { daysToDue: null, overdue: false, dueSoon: false, open: true },
    ...over,
  };
}

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("computeKnowledgeGapView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeKnowledgeGapView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });
});

describe("runKnowledgeGapScan", () => {
  beforeEach(() => {
    loadWorkItemsMock.mockReset();
  });

  it("diffs work items against the wiki and persists only undocumented work", async () => {
    loadWorkItemsMock.mockResolvedValue({
      items: [
        workItem({ id: "todo-elevator", source: "todo", title: "Wire the elevator" }),
        workItem({ id: "task-shooter", source: "build_task", title: "Tune the shooter", grouping: "shooter" }),
        workItem({ id: "mile-reveal", source: "milestone", title: "Week 3 robot reveal" }),
        workItem({ id: "todo-dropped", source: "todo", title: "Cancelled vendor trip", status: "dropped" }),
      ],
      roster: [],
      asOf: "2026-03-10",
    });

    const inserted: { sql: string; params: unknown[] }[] = [];
    let scanRowCount = 0;

    const client = makeClient((sql, params) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM knowledge_pages") && sql.includes("SELECT id, title, body")) {
        return {
          rows: [
            {
              id: "page-1",
              title: "Elevator notes",
              body: "How we wire the elevator on the 2026 robot.",
              tags: [],
              seasonYear: 2026,
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO knowledge_gap_scans")) {
        inserted.push({ sql, params });
        scanRowCount += 1;
        return { rows: [{ id: "scan-1", createdAt: "2026-02-01T00:00:00.000Z" }] };
      }
      if (sql.includes("INSERT INTO knowledge_gap_items")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("DISTINCT season_year AS \"seasonYear\" FROM knowledge_gap_scans")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM knowledge_gap_scans") && sql.includes("SELECT id, season_year")) {
        if (scanRowCount === 0) return { rows: [] };
        return {
          rows: [
            {
              id: "scan-1",
              seasonYear: 2026,
              subsystemCount: 1,
              decisionCount: 1,
              eventCount: 1,
              pageCount: 1,
              gapCount: 2,
              coverageScore: "0.3333",
              summary: "2 of 3 work item(s) have no wiki coverage (33% documented).",
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM knowledge_gap_items") && sql.includes("SELECT id, subject_kind")) {
        return {
          rows: [
            {
              id: "item-shooter",
              subjectKind: "build_task",
              subjectRef: "Tune the shooter",
              subjectId: "task-shooter",
              seasonYear: 2026,
              reason: 'Build task "Tune the shooter" (shooter) has no wiki page documenting the work.',
              suggestedTemplate: "subsystem",
              status: "open",
              draftPageId: null,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
            {
              id: "item-reveal",
              subjectKind: "milestone",
              subjectRef: "Week 3 robot reveal",
              subjectId: "mile-reveal",
              seasonYear: 2026,
              reason: 'Milestone "Week 3 robot reveal" has no wiki page documenting the work.',
              suggestedTemplate: "season_handoff",
              status: "open",
              draftPageId: null,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const view = await runKnowledgeGapScan(client, { orgId: ORG, userId: USER, seasonYear: 2026 });

    expect(loadWorkItemsMock).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ orgId: ORG, seasonYear: 2026 }),
    );
    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.scan?.gapCount).toBe(2);
    expect(view.items).toHaveLength(2);
    expect(view.items.map((item) => item.subjectRef).sort()).toEqual([
      "Tune the shooter",
      "Week 3 robot reveal",
    ]);
    expect(view.items.some((item) => item.subjectRef === "Wire the elevator")).toBe(false);
    expect(view.items.some((item) => item.subjectRef === "Cancelled vendor trip")).toBe(false);
    expect(view.items.every((item) => item.href)).toBeTruthy();
    expect(view.items.find((item) => item.subjectId === "task-shooter")?.subjectKind).toBe("subsystem");
    expect(view.items.find((item) => item.subjectId === "mile-reveal")?.subjectKind).toBe("event");
    expect(JSON.stringify(view.items)).not.toMatch(/DEMO/i);

    const scanInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO knowledge_gap_scans"));
    expect(scanInsert).toBeDefined();
    expect(scanInsert?.params[6]).toBe(2); // gap_count
    expect(scanInsert?.params[2]).toBe(1); // build tasks → subsystem_count
    expect(scanInsert?.params[3]).toBe(1); // todos → decision_count
    expect(scanInsert?.params[4]).toBe(1); // milestones → event_count

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();

    const itemInserts = inserted.filter((entry) => entry.sql.includes("INSERT INTO knowledge_gap_items"));
    expect(itemInserts).toHaveLength(2);
    expect(itemInserts.map((entry) => entry.params[2]).sort()).toEqual(["build_task", "milestone"]);
    expect(itemInserts.map((entry) => entry.params[4]).sort()).toEqual(["mile-reveal", "task-shooter"]);
    expect(JSON.stringify(itemInserts)).not.toMatch(/DEMO/i);
  });

  it("persists a zero-gap scan when work items are empty — never invents rows", async () => {
    loadWorkItemsMock.mockResolvedValue({ items: [], roster: [], asOf: "2026-03-10" });

    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM knowledge_pages") && sql.includes("SELECT id, title, body")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO knowledge_gap_scans")) {
        inserted.push({ sql, params });
        return { rows: [{ id: "scan-empty", createdAt: "2026-02-01T00:00:00.000Z" }] };
      }
      if (sql.includes("INSERT INTO knowledge_gap_items")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM knowledge_gap_scans") && sql.includes("SELECT id, season_year")) {
        return {
          rows: [
            {
              id: "scan-empty",
              seasonYear: 2026,
              subsystemCount: 0,
              decisionCount: 0,
              eventCount: 0,
              pageCount: 0,
              gapCount: 0,
              coverageScore: "1.0000",
              summary: "No work items yet — nothing to check documentation against.",
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM knowledge_gap_items")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const view = await runKnowledgeGapScan(client, { orgId: ORG, userId: USER, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.scan?.gapCount).toBe(0);
    expect(view.items).toEqual([]);
    expect(inserted.filter((entry) => entry.sql.includes("INSERT INTO knowledge_gap_items"))).toHaveLength(0);
    const scanInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO knowledge_gap_scans"));
    expect(scanInsert?.params[6]).toBe(0);
    expect(scanInsert?.params[7]).toBe(1);
    expect(JSON.stringify(view.items)).not.toMatch(/DEMO/i);
  });
});

describe("native subject-kind mapping", () => {
  it("maps 0242 aliases and native work sources both ways — never invents kinds", () => {
    expect(toPersistedSubjectKind("subsystem")).toBe("build_task");
    expect(toPersistedSubjectKind("decision")).toBe("todo");
    expect(toPersistedSubjectKind("event")).toBe("milestone");
    expect(toPersistedSubjectKind("todo")).toBe("todo");
    expect(toPersistedSubjectKind("build_task")).toBe("build_task");
    expect(toPersistedSubjectKind("milestone")).toBe("milestone");
    expect(toPersistedSubjectKind("DEMO")).toBeNull();
    expect(toPersistedSubjectKind("placeholder")).toBeNull();

    expect(fromPersistedSubjectKind("todo")).toBe("decision");
    expect(fromPersistedSubjectKind("build_task")).toBe("subsystem");
    expect(fromPersistedSubjectKind("milestone")).toBe("event");
    expect(fromPersistedSubjectKind("decision")).toBe("decision");
    expect(fromPersistedSubjectKind("DEMO")).toBeNull();
  });

  it("drafts a stub from a persisted todo kind without inventing a DEMO title", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM knowledge_gap_items")) {
        return {
          rows: [
            {
              id: "item-todo",
              subjectKind: "todo",
              subjectRef: "Order bumpers",
              subjectId: "todo-1",
              seasonYear: 2026,
              reason: 'To-do "Order bumpers" has no wiki page documenting the work.',
              suggestedTemplate: "blank",
              status: "open",
              draftPageId: null,
              createdAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM knowledge_pages") && sql.includes("slug")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO knowledge_pages")) {
        return { rows: [{ id: "page-stub" }] };
      }
      return { rows: [] };
    });

    await draftStubPage(client, { orgId: ORG, userId: USER, itemId: "item-todo" });

    const pageInsert = calls.find((entry) => entry.sql.includes("INSERT INTO knowledge_pages"));
    expect(pageInsert?.params[2]).toBe("To-do: Order bumpers");
    expect(String(pageInsert?.params[2])).not.toMatch(/DEMO/i);
  });
});
