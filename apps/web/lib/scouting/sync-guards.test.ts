import { describe, expect, it } from "vitest";
import type { SyncEntry } from "@vantage/scouting";
import {
  OTHER_ROBOT_REASON,
  entryRefusal,
  isMissingReferenceError,
  isTransientDbError,
  notInMatchReason,
  resolveSyncTarget,
} from "./sync-guards";
import { NOTHING_RECORDED_REASON } from "./entry-answers";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

type Row = {
  id: string;
  eventKey: string;
  matchKey: string | null;
  teamKey: string;
  scoutUserId: string;
  clientId: string | null;
};

/** A tiny stand-in for the request's database client: receipts and match rows, nothing else. */
function fakeClient(state: { receipts: Array<{ clientId: string; entryType: "match" | "pit"; serverEntryId: string }>; rows: Row[] }) {
  const inserted: Array<{ clientId: string; entryId: string }> = [];
  return {
    inserted,
    async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      if (sql.includes("FROM scout_sync_receipts")) {
        const found = state.receipts.find((receipt) => receipt.clientId === params[1]);
        return { rows: (found ? [found] : []) as T[] };
      }
      if (sql.includes("INSERT INTO scout_sync_receipts")) {
        inserted.push({ clientId: String(params[1]), entryId: String(params[3]) });
        return { rows: [] };
      }
      if (sql.includes("id = $2::uuid")) {
        return { rows: state.rows.filter((row) => row.id === params[1]) as T[] };
      }
      if (sql.includes("client_id = $2")) {
        return { rows: state.rows.filter((row) => row.clientId === params[1]) as T[] };
      }
      if (sql.includes("scout_user_id = $5::uuid")) {
        return {
          rows: state.rows.filter(
            (row) =>
              row.eventKey === params[1] &&
              row.matchKey === params[2] &&
              row.teamKey === params[3] &&
              row.scoutUserId === params[4],
          ) as T[],
        };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
}

function entry(partial: Partial<SyncEntry> = {}): SyncEntry {
  return {
    clientId: "new-id",
    orgId: ORG,
    type: "match",
    eventKey: "2026gacmp",
    matchKey: "2026gacmp_qm33",
    teamKey: "frc1678",
    schemaId: "schema",
    payload: { autoPoints: 4 },
    confidence: "normal",
    source: "manual",
    updatedAt: "2026-09-26T15:00:00.000Z",
    ...partial,
  };
}

describe("resolveSyncTarget", () => {
  it("files a new id for a robot this scout already has as an edit of that report", async () => {
    const client = fakeClient({
      receipts: [{ clientId: "old-id", entryType: "match", serverEntryId: "row-1" }],
      rows: [{ id: "row-1", eventKey: "2026gacmp", matchKey: "2026gacmp_qm33", teamKey: "frc1678", scoutUserId: ME, clientId: "old-id" }],
    });
    const target = await resolveSyncTarget(client, { orgId: ORG, userId: ME, entry: entry() });
    expect(target).toMatchObject({ kind: "existing-report", entry: { clientId: "old-id", payload: { autoPoints: 4 } } });
  });

  it("leaves a teammate's report of the same robot alone (two scouts, two reports)", async () => {
    const client = fakeClient({
      receipts: [],
      rows: [{ id: "row-1", eventKey: "2026gacmp", matchKey: "2026gacmp_qm33", teamKey: "frc1678", scoutUserId: OTHER, clientId: "their-id" }],
    });
    const target = await resolveSyncTarget(client, { orgId: ORG, userId: ME, entry: entry() });
    expect(target).toEqual({ kind: "as-sent", entry: entry() });
  });

  it("refuses an id already filed for a different match instead of overwriting it", async () => {
    const client = fakeClient({
      receipts: [{ clientId: "qr-id", entryType: "match", serverEntryId: "row-5" }],
      rows: [{ id: "row-5", eventKey: "2026gacmp", matchKey: "2026gacmp_qm5", teamKey: "frc254", scoutUserId: ME, clientId: "qr-id" }],
    });
    const target = await resolveSyncTarget(client, {
      orgId: ORG,
      userId: ME,
      entry: entry({ clientId: "qr-id", matchKey: "2026gacmp_qm9", teamKey: "frc254" }),
    });
    expect(target).toEqual({ kind: "refuse", reason: OTHER_ROBOT_REASON });
  });

  it("gives a report filed without a receipt one, so editing it updates it", async () => {
    const client = fakeClient({
      receipts: [],
      rows: [{ id: "row-9", eventKey: "2026gacmp", matchKey: "2026gacmp_qm33", teamKey: "frc1678", scoutUserId: ME, clientId: "seeded" }],
    });
    const target = await resolveSyncTarget(client, { orgId: ORG, userId: ME, entry: entry({ clientId: "seeded" }) });
    expect(target.kind).toBe("as-sent");
    expect(client.inserted).toEqual([{ clientId: "seeded", entryId: "row-9" }]);
  });

  it("sends an edit of the same robot through as it was sent", async () => {
    const client = fakeClient({
      receipts: [{ clientId: "new-id", entryType: "match", serverEntryId: "row-1" }],
      rows: [{ id: "row-1", eventKey: "2026gacmp", matchKey: "2026gacmp_qm33", teamKey: "frc1678", scoutUserId: ME, clientId: "new-id" }],
    });
    expect((await resolveSyncTarget(client, { orgId: ORG, userId: ME, entry: entry() })).kind).toBe("as-sent");
  });
});

describe("sync error kinds", () => {
  it("keeps lost races, deadlocks, timeouts and dropped connections queued", () => {
    for (const code of ["40001", "40P01", "57014", "08006"]) expect(isTransientDbError({ code })).toBe(true);
    expect(isTransientDbError({ code: "23514" })).toBe(false);
    expect(isTransientDbError(new Error("x"))).toBe(false);
  });

  it("names a missing schedule row", () => {
    expect(isMissingReferenceError({ code: "23503" })).toBe(true);
    expect(isMissingReferenceError({ code: "23505" })).toBe(false);
  });
});

describe("entryRefusal", () => {
  const schedule = (compLevel: string, red: string[], blue: string[]) => ({
    async query<T>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      if (!sql.includes("FROM matches_ref")) throw new Error(`unexpected query: ${sql}`);
      return {
        rows: (params[0] === "2026gacmp_qm33" || params[0] === "2026gacmp_sf1m1"
          ? [{ compLevel, redAlliance: { teamKeys: red }, blueAlliance: { teamKeys: blue } }]
          : []) as T[],
      };
    },
  });
  const qual33 = schedule("qm", ["frc1678", "frc148", "frc118"], ["frc2056", "frc67", "frc7457"]);

  it("refuses a qualification robot that is not in that match", async () => {
    // 254 is not in Qual 33: a mistyped match or team used to be filed and counted.
    expect(await entryRefusal(qual33, entry({ teamKey: "frc254" }))).toBe(notInMatchReason("frc254", "2026gacmp_qm33"));
    expect(notInMatchReason("frc254", "2026gacmp_qm33")).toMatch(/^Team 254 is not in Qual 33 on the event schedule/);
    expect(await entryRefusal(qual33, entry({ teamKey: "frc1678" }))).toBeNull();
  });

  it("leaves playoffs, unpublished alliances and unknown matches to the other checks", async () => {
    const playoff = schedule("sf", ["frc1", "frc2", "frc3"], ["frc4", "frc5", "frc6"]);
    expect(await entryRefusal(playoff, entry({ matchKey: "2026gacmp_sf1m1", teamKey: "frc254" }))).toBeNull();
    expect(await entryRefusal(schedule("qm", [], []), entry({ teamKey: "frc254" }))).toBeNull();
    expect(await entryRefusal(qual33, entry({ matchKey: "2026gacmp_qm99", teamKey: "frc254" }))).toBeNull();
  });

  it("refuses a report with nothing recorded, pit or match", async () => {
    const noQueries = { async query(): Promise<never> { throw new Error("no query expected"); } };
    expect(await entryRefusal(noQueries, entry({ type: "pit", matchKey: undefined, payload: {} }))).toBe(NOTHING_RECORDED_REASON);
    expect(await entryRefusal(noQueries, entry({ payload: { alliance_station: "red1" } }))).toBe(NOTHING_RECORDED_REASON);
    expect(await entryRefusal(noQueries, entry({ type: "pit", matchKey: undefined, payload: { drivetrain: "swerve" } }))).toBeNull();
  });
});
