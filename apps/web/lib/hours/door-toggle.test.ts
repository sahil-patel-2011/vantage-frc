import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it, vi } from "vitest";
import { DOOR_WINDOW_MS } from "./door-code";
import { toggleDoorCheckin } from "./door-toggle";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WINDOW = 29_870_000;

function stubClient(latest: { clockIn: string; clockOut: string | null; spent: boolean } | null) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
    if (sql.includes("ORDER BY clock_in DESC")) return { rows: latest ? [latest] : [], rowCount: latest ? 1 : 0 };
    if (sql.includes("UPDATE hour_logs")) {
      return latest && !latest.clockOut
        ? { rows: [{ clockIn: latest.clockIn, clockOut: "2026-10-16 20:00:00+00" }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes("INSERT INTO hour_logs")) return { rows: [{ clockIn: "2026-10-16 18:00:00+00" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { client: { query } as unknown as PoolClient, query };
}

const wrote = (query: ReturnType<typeof stubClient>["query"]) =>
  query.mock.calls.some(([sql]) => /UPDATE hour_logs|INSERT INTO hour_logs/.test(String(sql)));

describe("toggleDoorCheckin", () => {
  it("takes a per-member lock first, so two scans in flight take turns", async () => {
    const { client, query } = stubClient(null);
    await toggleDoorCheckin(client, { orgId: ORG, userId: USER, codeWindow: WINDOW });
    expect(query.mock.calls[0]![0]).toContain("pg_advisory_xact_lock");
    expect(query.mock.calls[0]![1]).toEqual([`door-checkin:${ORG}:${USER}`]);
  });

  it("asks whether the last clock change came after this code's minute began", async () => {
    const { client, query } = stubClient(null);
    await toggleDoorCheckin(client, { orgId: ORG, userId: USER, codeWindow: WINDOW });
    expect(query.mock.calls[1]![1]).toEqual([ORG, USER, (WINDOW * DOOR_WINDOW_MS) / 1000]);
  });

  it("checks in when nothing is open", async () => {
    const { client } = stubClient(null);
    expect(await toggleDoorCheckin(client, { orgId: ORG, userId: USER, codeWindow: WINDOW })).toEqual({
      state: "in",
      clockIn: "2026-10-16 18:00:00+00",
      clockOut: null,
      repeat: false,
    });
  });

  it("checks out with a fresh code when the member is in", async () => {
    const { client } = stubClient({ clockIn: "2026-10-16 18:00:00+00", clockOut: null, spent: false });
    expect(await toggleDoorCheckin(client, { orgId: ORG, userId: USER, codeWindow: WINDOW })).toMatchObject({ state: "out", repeat: false });
  });

  it("a repeat of the code that just checked them in leaves them in", async () => {
    const { client, query } = stubClient({ clockIn: "2026-10-16 18:00:00+00", clockOut: null, spent: true });
    expect(await toggleDoorCheckin(client, { orgId: ORG, userId: USER, codeWindow: WINDOW })).toEqual({
      state: "in",
      clockIn: "2026-10-16 18:00:00+00",
      clockOut: null,
      repeat: true,
    });
    expect(wrote(query)).toBe(false);
  });

  it("a repeat of the code that just checked them out leaves them out", async () => {
    const { client, query } = stubClient({ clockIn: "2026-10-16 18:00:00+00", clockOut: "2026-10-16 20:00:00+00", spent: true });
    expect(await toggleDoorCheckin(client, { orgId: ORG, userId: USER, codeWindow: WINDOW })).toMatchObject({ state: "out", repeat: true });
    expect(wrote(query)).toBe(false);
  });
});
