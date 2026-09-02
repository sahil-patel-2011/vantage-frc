/**
 * Node-only tests for the My Kit loader. No database: the PoolClient is a stub that
 * answers by SQL shape. That is enough to pin the rules that actually matter —
 * a missing table degrades instead of throwing, a failing read empties one section
 * rather than the page, and nothing is ever invented for a member with no data.
 */
import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { MY_KIT_OPTIONAL_TABLES, displayNameFor, loadMyKit, presentTables } from "./load-my-kit";

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-03-04T18:00:00.000Z");

type Reply = { rows: unknown[]; rowCount?: number };

function mockClient(handler: (sql: string, params: unknown[]) => Reply | Error): PoolClient {
  return {
    query: vi.fn((sql: string, params: unknown[] = []) => {
      const reply = handler(sql, params);
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({ ...reply, rowCount: reply.rowCount ?? reply.rows.length });
    }),
  } as unknown as PoolClient;
}

type Fixture = {
  member?: boolean;
  displayName?: string | null;
  tables?: readonly string[];
  rows?: Record<string, unknown[]>;
  throwOn?: string[];
};

function fixtureClient(fixture: Fixture = {}): PoolClient {
  const tables = fixture.tables ?? MY_KIT_OPTIONAL_TABLES;
  const rows = fixture.rows ?? {};
  const throwOn = fixture.throwOn ?? [];
  return mockClient((sql) => {
    for (const marker of throwOn) {
      if (sql.includes(marker)) return new Error(`column does not exist: ${marker}`);
    }
    if (sql.includes("FROM memberships")) {
      return fixture.member === false
        ? { rows: [] }
        : {
            rows: [
              {
                orgId: ORG,
                orgName: "Team Vantage",
                teamNumber: 9999,
                orgRole: "member",
                teamRole: "student",
                displayName: fixture.displayName === undefined ? "Riley Chen" : fixture.displayName,
                firstName: null,
                lastName: null,
                userName: "riley.chen",
              },
            ],
          };
    }
    if (sql.includes("to_regclass")) return { rows: tables.map((name) => ({ name })) };
    for (const [table, value] of Object.entries(rows)) {
      if (sql.includes(`FROM ${table}`)) return { rows: value };
    }
    return { rows: [] };
  });
}

describe("displayNameFor", () => {
  it("prefers the profile display name, then first+last, then the account name", () => {
    expect(
      displayNameFor({
        orgId: ORG,
        orgName: "x",
        teamNumber: null,
        orgRole: "member",
        teamRole: null,
        displayName: "Riley C.",
        firstName: "Riley",
        lastName: "Chen",
        userName: "riley",
      }),
    ).toBe("Riley C.");
    expect(
      displayNameFor({
        orgId: ORG,
        orgName: "x",
        teamNumber: null,
        orgRole: "member",
        teamRole: null,
        displayName: "  ",
        firstName: "Riley",
        lastName: "Chen",
        userName: "riley",
      }),
    ).toBe("Riley Chen");
    expect(
      displayNameFor({
        orgId: ORG,
        orgName: "x",
        teamNumber: null,
        orgRole: "member",
        teamRole: null,
        displayName: null,
        firstName: null,
        lastName: null,
        userName: "riley",
      }),
    ).toBe("riley");
  });
});

describe("presentTables", () => {
  it("returns an empty set rather than throwing when the probe itself fails", async () => {
    const client = mockClient(() => new Error("no connection"));
    expect((await presentTables(client)).size).toBe(0);
  });
});

describe("loadMyKit", () => {
  it("asks for a workspace when the user has no membership", async () => {
    const view = await loadMyKit(fixtureClient({ member: false }), { userId: USER, now: NOW });
    expect(view.status).toBe("setup_required");
    if (view.status !== "setup_required") return;
    expect(view.steps[0]!.href).toBe("/workspace");
  });

  it("returns a live, entirely empty kit for a member with no data yet", async () => {
    const view = await loadMyKit(fixtureClient(), { userId: USER, now: NOW });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.orgId).toBe(ORG);
    expect(view.person.displayName).toBe("Riley Chen");
    expect(view.sections.every((section) => section.available)).toBe(true);
    expect(view.sections.every((section) => section.rows.length === 0)).toBe(true);
    expect(view.hours.totalMinutes).toBe(0);
    expect(view.actionableCount).toBe(0);
  });

  it("marks sections unavailable when their tables are absent from this database", async () => {
    const view = await loadMyKit(fixtureClient({ tables: ["team_todos", "hour_logs"] }), {
      userId: USER,
      now: NOW,
    });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.unavailableSections).toContain("tools");
    expect(view.unavailableSections).toContain("scouting");
    expect(view.unavailableSections).not.toContain("tasks");
    expect(view.unavailableSections).not.toContain("hours");
  });

  it("still reports live with zero optional tables present", async () => {
    const view = await loadMyKit(fixtureClient({ tables: [] }), { userId: USER, now: NOW });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.unavailableSections).toHaveLength(view.sections.length);
  });

  it("empties one section — not the page — when a read fails", async () => {
    const view = await loadMyKit(
      fixtureClient({
        throwOn: ["FROM hour_logs"],
        rows: {
          // Todos live on build_tasks since 0502; the same row reaches both the
          // name-matched and the member-matched read and must be listed once.
          build_tasks: [
            { id: "td1", title: "Order fabric", status: "todo", context: null, dueOn: null, priority: "normal" },
          ],
        },
      }),
      { userId: USER, now: NOW },
    );
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.sections.find((section) => section.id === "hours")!.rows).toEqual([]);
    expect(view.sections.find((section) => section.id === "tasks")!.rows).toHaveLength(1);
  });

  it("skips name-matched reads entirely when the member has no display name", async () => {
    const client = fixtureClient({ displayName: null, rows: {} });
    // With no display name and no account name the loader must not run the
    // free-text matches at all, or it would match every blank assignee.
    const noNameClient = mockClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return {
          rows: [
            {
              orgId: ORG,
              orgName: "Team Vantage",
              teamNumber: null,
              orgRole: "member",
              teamRole: null,
              displayName: null,
              firstName: null,
              lastName: null,
              userName: null,
            },
          ],
        };
      }
      if (sql.includes("to_regclass")) {
        return { rows: MY_KIT_OPTIONAL_TABLES.map((name) => ({ name })) };
      }
      if (sql.includes("FROM build_tasks") || sql.includes("FROM safety_certifications")) {
        throw new Error("must not query free-text assignee tables without a name");
      }
      return { rows: [] };
    });
    await expect(loadMyKit(client, { userId: USER, now: NOW })).resolves.toBeTruthy();
    const view = await loadMyKit(noNameClient, { userId: USER, now: NOW });
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.person.displayName).toBe("");
  });

  it("composes subteam membership into the focus lens", async () => {
    const view = await loadMyKit(
      fixtureClient({
        rows: {
          team_subteam_members: [{ id: "s1", name: "Scouting" }],
          scout_assignments: [
            {
              id: "sa1",
              eventKey: "2026week1",
              matchKey: "2026week1_qm3",
              teamKey: "frc9999",
              role: "primary",
              startsAt: null,
            },
          ],
        },
      }),
      { userId: USER, now: NOW },
    );
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.person.focus).toBe("scouting");
    expect(view.sections[0]!.id).toBe("scouting");
    expect(view.sections[0]!.rows).toHaveLength(1);
  });

  it("drops an onboarding track whose key is not a known template", async () => {
    const view = await loadMyKit(
      fixtureClient({
        rows: {
          member_onboarding_tracks: [
            { trackKey: "welcome", done: 2 },
            { trackKey: "not_a_real_track", done: 9 },
          ],
        },
      }),
      { userId: USER, now: NOW },
    );
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    const onboarding = view.sections.find((section) => section.id === "onboarding")!;
    expect(onboarding.rows).toHaveLength(1);
    expect(onboarding.rows[0]!.id).toBe("track:welcome");
    expect(onboarding.rows[0]!.detail).toBe("2 of 4 steps done");
  });

  it("ignores a scout accuracy snapshot whose score is not a number", async () => {
    const view = await loadMyKit(
      fixtureClient({
        rows: {
          scout_accuracy_snapshots: [
            {
              eventKey: "2026week1",
              scoutsScored: 5,
              computedAt: "2026-03-04T12:00:00Z",
              entriesScored: "12",
              accuracyScore: null,
              rank: "3",
            },
          ],
        },
      }),
      { userId: USER, now: NOW },
    );
    expect(view.status).toBe("live");
    if (view.status !== "live") return;
    expect(view.sections.find((section) => section.id === "scouting")!.rows).toEqual([]);
  });

  it("reads reimbursements only when migration 0482's table is present", async () => {
    const withoutTable = await loadMyKit(
      fixtureClient({
        tables: MY_KIT_OPTIONAL_TABLES.filter((name) => name !== "reimbursement_requests"),
        rows: { reimbursement_requests: [{ id: "r1", status: "submitted", createdAt: null }] },
      }),
      { userId: USER, now: NOW },
    );
    expect(withoutTable.status).toBe("live");
    if (withoutTable.status !== "live") return;
    expect(withoutTable.sections.find((section) => section.id === "money")!.rows).toEqual([]);

    const withTable = await loadMyKit(
      fixtureClient({
        rows: { reimbursement_requests: [{ id: "r1", status: "submitted", createdAt: null }] },
      }),
      { userId: USER, now: NOW },
    );
    expect(withTable.status).toBe("live");
    if (withTable.status !== "live") return;
    expect(withTable.sections.find((section) => section.id === "money")!.rows).toHaveLength(1);
  });

  it("never issues a write", async () => {
    const seen: string[] = [];
    const client = mockClient((sql) => {
      seen.push(sql);
      if (sql.includes("FROM memberships")) {
        return {
          rows: [
            {
              orgId: ORG,
              orgName: "Team Vantage",
              teamNumber: 9999,
              orgRole: "member",
              teamRole: "student",
              displayName: "Riley Chen",
              firstName: null,
              lastName: null,
              userName: null,
            },
          ],
        };
      }
      if (sql.includes("to_regclass")) {
        return { rows: MY_KIT_OPTIONAL_TABLES.map((name) => ({ name })) };
      }
      return { rows: [] };
    });
    await loadMyKit(client, { userId: USER, now: NOW });
    expect(seen.length).toBeGreaterThan(3);
    for (const sql of seen) {
      expect(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(sql)).toBe(false);
    }
  });
});
