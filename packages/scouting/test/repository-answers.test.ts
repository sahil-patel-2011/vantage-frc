import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { ScoutingRepository } from "../src/repository";
import type { SchemaDefinition } from "../src";

const matchDefinition: SchemaDefinition = {
  title: "Match",
  fields: [
    { key: "auto", label: "Auto", type: "number" },
    { key: "scout_name", label: "Scout name", type: "text" },
  ],
};

const pitDefinition: SchemaDefinition = {
  title: "Pit",
  fields: [{ key: "drivetrain_type", label: "Drivetrain", type: "drivetrain_type" }],
};

function makeClient(state: {
  eventKey: string | null;
  matchRows?: unknown[];
  pitRows?: unknown[];
  unexpected: string[];
}) {
  return {
    async query(sql: string) {
      if (sql.includes("FROM org_active_context")) {
        return { rows: [{ activeEventKey: state.eventKey }], rowCount: 1 };
      }
      if (!state.eventKey) {
        state.unexpected.push(sql);
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM scout_schemas") && sql.includes("DISTINCT ON (type)")) {
        return {
          rows: [
            { type: "match", definition: matchDefinition },
            { type: "pit", definition: pitDefinition },
          ],
          rowCount: 2,
        };
      }
      if (sql.includes("FROM match_scout_entries") && sql.includes("e.payload")) {
        return { rows: state.matchRows ?? [], rowCount: state.matchRows?.length ?? 0 };
      }
      if (sql.includes("FROM pit_scout_entries") && sql.includes("e.payload")) {
        return { rows: state.pitRows ?? [], rowCount: state.pitRows?.length ?? 0 };
      }
      state.unexpected.push(sql);
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
}

describe("ScoutingRepository.listEventAnswers", () => {
  it("returns empty schemas and rows when no active event is set", async () => {
    const unexpected: string[] = [];
    const repo = new ScoutingRepository(makeClient({ eventKey: null, unexpected }));
    await expect(repo.listEventAnswers("org-1")).resolves.toEqual({
      eventKey: null,
      matchDefinition: null,
      pitDefinition: null,
      rows: [],
    });
    expect(unexpected).toEqual([]);
  });

  it("lists real match and pit payloads without inventing rows", async () => {
    const unexpected: string[] = [];
    const repo = new ScoutingRepository(
      makeClient({
        eventKey: "2026test",
        unexpected,
        matchRows: [
          {
            eventKey: "2026test",
            matchKey: "2026test_qm1",
            teamKey: "frc254",
            confidence: "high",
            source: "manual",
            updatedAt: "2026-03-15T18:00:00.000Z",
            scoutName: "Alex",
            payload: { auto: 4 },
          },
        ],
        pitRows: [
          {
            eventKey: "2026test",
            teamKey: "frc1678",
            confidence: "normal",
            source: "manual",
            updatedAt: new Date("2026-03-15T19:00:00.000Z"),
            scoutName: "Sam",
            payload: { drivetrain_type: "swerve" },
          },
        ],
      }),
    );
    const result = await repo.listEventAnswers("org-1");
    expect(result.eventKey).toBe("2026test");
    expect(result.matchDefinition?.fields.map((field) => field.key)).toEqual(["auto"]);
    expect(result.pitDefinition?.fields.map((field) => field.key)).toEqual(["drivetrain_type"]);
    expect(result.rows).toEqual([
      {
        type: "match",
        eventKey: "2026test",
        matchKey: "2026test_qm1",
        teamKey: "frc254",
        scoutName: "Alex",
        source: "manual",
        confidence: "high",
        updatedAt: "2026-03-15T18:00:00.000Z",
        payload: { auto: 4 },
      },
      {
        type: "pit",
        eventKey: "2026test",
        matchKey: null,
        teamKey: "frc1678",
        scoutName: "Sam",
        source: "manual",
        confidence: "normal",
        updatedAt: "2026-03-15T19:00:00.000Z",
        payload: { drivetrain_type: "swerve" },
      },
    ]);
    expect(unexpected).toEqual([]);
  });

  it("returns published columns with zero rows when the event has no answers", async () => {
    const repo = new ScoutingRepository(
      makeClient({ eventKey: "2026empty", unexpected: [], matchRows: [], pitRows: [] }),
    );
    const result = await repo.listEventAnswers("org-1");
    expect(result.eventKey).toBe("2026empty");
    expect(result.matchDefinition).not.toBeNull();
    expect(result.rows).toEqual([]);
  });
});
