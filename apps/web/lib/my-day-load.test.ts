import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { loadMyDayLogistics } from "./my-day-load";

const NOW = new Date("2026-03-07T16:00:00.000Z");
const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

type WatchRow = {
  id: string;
  kind: string;
  title: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  phone: string;
  startsAt: string;
  endsAt: string | null;
  locationNote: string;
  notes: string;
};

const LODGING = {
  hotelName: "Pit Stop Inn",
  hotelAddress: "1 Queue St",
  hotelPhone: "555-0110",
  roomLabel: "214",
  checkInAt: "2026-03-06T22:00:00.000Z",
  checkOutAt: "2026-03-08T15:00:00.000Z",
  tripTitle: "San Diego",
  tripId: "trip-1",
};

const TRAVEL = {
  id: "leg-1",
  kind: "bus",
  title: "Venue departure",
  startsAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  endsAt: null,
  location: "Loading dock",
  meetingPoint: "Lobby",
  notes: "",
  tripId: "trip-1",
  tripTitle: "San Diego",
};

function assignedWatch(overrides: Partial<WatchRow> = {}): WatchRow {
  return {
    id: "w1",
    kind: "on_duty",
    title: "On duty",
    assignedUserId: USER,
    assignedUserName: "Alex Mentor",
    phone: "555-0100",
    startsAt: "2026-03-07T14:00:00.000Z",
    endsAt: "2026-03-07T22:00:00.000Z",
    locationNote: "Pit",
    notes: "",
    ...overrides,
  };
}

function mockClient(options: {
  lodging?: typeof LODGING | null;
  travel?: typeof TRAVEL | null;
  dutyRows?: WatchRow[];
  dutyError?: Error;
}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("duty_assignments")) {
        if (options.dutyError) throw options.dutyError;
        const rows = options.dutyRows ?? [];
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("logistics_room_assignments")) {
        const rows = options.lodging === null || options.lodging === undefined ? [] : [options.lodging];
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("logistics_travel_legs")) {
        const rows = options.travel === null || options.travel === undefined ? [] : [options.travel];
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("logistics_checklist_items")) {
        return { rows: [{ total: "0", done: "0" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as PoolClient;
  return { client, calls };
}

const INPUT = {
  orgId: ORG,
  userId: USER,
  teamRole: "student" as const,
  eventKey: "2026casd",
  now: NOW,
};

describe("loadMyDayLogistics on-duty cue", () => {
  it("uses an assigned /duties watch as the My Day cue and keeps lodging + travel", async () => {
    const { client, calls } = mockClient({
      lodging: LODGING,
      travel: TRAVEL,
      dutyRows: [assignedWatch()],
    });

    const bundle = await loadMyDayLogistics(client, INPUT);

    expect(bundle.onDuty).toEqual({
      id: "w1",
      tripId: null,
      mentorUserId: USER,
      mentorName: "Alex Mentor",
      phone: "555-0100",
      startsAt: "2026-03-07T14:00:00.000Z",
      endsAt: "2026-03-07T22:00:00.000Z",
      locationNote: "Pit",
      notes: "",
      kind: "on_duty",
    });
    expect(bundle.lodging?.hotelName).toBe("Pit Stop Inn");
    expect(bundle.nextTravel?.title).toBe("Venue departure");

    const dutyCall = calls.find((call) => call.sql.includes("duty_assignments"));
    expect(dutyCall).toBeDefined();
    expect(dutyCall!.params[0]).toBe(ORG);
    expect(dutyCall!.sql).toMatch(/org_id = \$1::uuid/);
    expect(dutyCall!.sql).toMatch(/assigned_user_id IS NOT NULL/);
    expect(calls.some((call) => call.sql.includes("logistics_on_duty"))).toBe(false);
  });

  it("leaves the cue null when every watch is unassigned", async () => {
    const { client } = mockClient({
      lodging: LODGING,
      travel: TRAVEL,
      dutyRows: [
        assignedWatch({
          assignedUserId: null,
          assignedUserName: null,
        }),
      ],
    });

    const bundle = await loadMyDayLogistics(client, INPUT);
    expect(bundle.onDuty).toBeNull();
    expect(bundle.lodging?.roomLabel).toBe("214");
    expect(bundle.nextTravel?.id).toBe("leg-1");
  });

  it("leaves the cue null when the duties table is empty or missing", async () => {
    const empty = mockClient({ lodging: LODGING, travel: TRAVEL, dutyRows: [] });
    expect((await loadMyDayLogistics(empty.client, INPUT)).onDuty).toBeNull();

    const missing = mockClient({
      lodging: LODGING,
      travel: TRAVEL,
      dutyError: new Error('relation "duty_assignments" does not exist'),
    });
    const bundle = await loadMyDayLogistics(missing.client, INPUT);
    expect(bundle.onDuty).toBeNull();
    expect(bundle.lodging?.tripTitle).toBe("San Diego");
    expect(bundle.nextTravel?.kind).toBe("bus");
    expect(JSON.stringify(bundle)).not.toMatch(/DEMO/i);
  });
});
