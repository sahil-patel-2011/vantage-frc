import { describe, expect, it } from "vitest";
import { addAlumni, listAlumni, loadAlumniDirectory, removeAlumni } from "./store";
import type { AlumniRow } from "./types";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

type Stored = AlumniRow & { orgId: string };

function mockClient(options?: { member?: boolean; seed?: Stored[] }) {
  const rows: Stored[] = [...(options?.seed ?? [])];
  const member = options?.member !== false;
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM memberships")) {
        return member ? { rows: [{}], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("DELETE FROM team_alumni")) {
        const id = String(params[0]);
        const orgId = String(params[1]);
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i]?.id === id && rows[i]?.orgId === orgId) rows.splice(i, 1);
        }
        const removed = before - rows.length;
        return { rows: [], rowCount: removed };
      }
      if (sql.includes("INSERT INTO team_alumni")) {
        const id = `alum-${rows.length + 1}`;
        const stored: Stored = {
          id,
          orgId: String(params[0]),
          fullName: String(params[1]),
          gradYear: (params[2] as number | null) ?? null,
          currentRole: (params[3] as string | null) ?? null,
          email: (params[4] as string | null) ?? null,
          discordHandle: (params[5] as string | null) ?? null,
          linkedinUrl: (params[6] as string | null) ?? null,
          note: (params[7] as string | null) ?? null,
          isMentor: Boolean(params[8]),
          mentorTopic: (params[9] as string | null) ?? null,
          addedBy: String(params[10]),
          createdAt: "2026-03-01T00:00:00.000Z",
        };
        rows.push(stored);
        return { rows: [{ id }], rowCount: 1 };
      }
      if (sql.includes("FROM team_alumni")) {
        const orgId = String(params[0]);
        const listed = rows.filter((row) => row.orgId === orgId);
        return { rows: listed, rowCount: listed.length };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as import("@neondatabase/serverless").PoolClient;
  return { client, rows };
}

describe("alumni store — empty vs persisted row", () => {
  it("lists an empty directory when the org has no alumni rows", async () => {
    const { client } = mockClient();
    const directory = await listAlumni(client, { orgId: ORG, viewerId: USER });
    expect(directory.alumni).toEqual([]);
    expect(directory.summary.total).toBe(0);
    expect(directory.summary.mentors).toBe(0);
    expect(JSON.stringify(directory)).not.toMatch(/DEMO/i);
  });

  it("returns the persisted row after insert — never DEMO classmates", async () => {
    const { client, rows } = mockClient();

    const empty = await loadAlumniDirectory(client, { orgId: ORG, userId: USER });
    expect(empty.alumni).toHaveLength(0);

    const { id, directory } = await addAlumni(client, {
      orgId: ORG,
      userId: USER,
      body: {
        fullName: "Ada Lovelace",
        gradYear: 2019,
        currentRole: "Robotics Engineer",
        isMentor: true,
        mentorTopic: "CAD",
      },
    });

    expect(id).toBeTruthy();
    expect(rows).toHaveLength(1);
    expect(directory.alumni).toHaveLength(1);
    expect(directory.alumni[0]).toMatchObject({
      id,
      fullName: "Ada Lovelace",
      gradYear: 2019,
      isMentor: true,
      mentorTopic: "CAD",
      addedBy: USER,
    });
    expect(directory.summary).toEqual({ total: 1, mentors: 1 });
    expect(directory.alumni.every((row) => !isPlaceholder(row.fullName))).toBe(true);
  });

  it("does not leak another org's persisted row into an empty directory", async () => {
    const { client } = mockClient({
      seed: [
        {
          id: "other-1",
          orgId: OTHER,
          fullName: "Other Org Alum",
          gradYear: 2018,
          currentRole: null,
          email: null,
          discordHandle: null,
          linkedinUrl: null,
          note: null,
          isMentor: false,
          mentorTopic: null,
          addedBy: USER,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const directory = await listAlumni(client, { orgId: ORG, viewerId: USER });
    expect(directory.alumni).toEqual([]);
    expect(directory.summary.total).toBe(0);
  });

  it("refuses to persist a DEMO classmate seed", async () => {
    const { client, rows } = mockClient();
    await expect(
      addAlumni(client, { orgId: ORG, userId: USER, body: { fullName: "DEMO Classmate" } }),
    ).rejects.toThrow(/DEMO classmates/i);
    expect(rows).toHaveLength(0);
    const directory = await listAlumni(client, { orgId: ORG, viewerId: USER });
    expect(directory.alumni).toEqual([]);
  });

  it("removes a persisted row and returns to honest empty", async () => {
    const { client } = mockClient();
    const { id } = await addAlumni(client, {
      orgId: ORG,
      userId: USER,
      body: { fullName: "Sam Rivera" },
    });
    await removeAlumni(client, { orgId: ORG, userId: USER, id });
    const directory = await listAlumni(client, { orgId: ORG, viewerId: USER });
    expect(directory.alumni).toEqual([]);
    expect(directory.summary.total).toBe(0);
  });
});

function isPlaceholder(name: string): boolean {
  return /^(demo|classmate\s*\d+|sample\s+alum)/i.test(name);
}
