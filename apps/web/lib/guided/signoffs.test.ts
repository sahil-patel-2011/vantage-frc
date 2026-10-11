import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { notifyLeadsOfRequest, notifyStudentOfDecision, requestSignoff, summarizeTeamProgress } from "./signoffs";
import { guidedTrackShortTitle } from "./tracks";

const ORG = "11111111-1111-4111-8111-111111111111";
const RILEY = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const ADMIN = "44444444-4444-4444-8444-444444444444";
const SIGNOFF = "55555555-5555-4555-8555-555555555555";

type Sent = { userId: string; orgId: string; type: string; payload: Record<string, unknown> };

function fakeClient(rows: Record<string, unknown[]>) {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      const hit = Object.keys(rows).find((needle) => sql.includes(needle));
      const found = hit ? rows[hit]! : [];
      return { rows: found, rowCount: found.length };
    },
  } as unknown as PoolClient;
  return { client, queries };
}

function recorder() {
  const sent: Sent[] = [];
  const emit = async (_client: PoolClient, input: Sent) => {
    sent.push(input);
  };
  return { sent, emit };
}

describe("team progress lists every member (A5-19)", () => {
  it("includes members who have not started, with empty counts", () => {
    const members = summarizeTeamProgress(
      [{ userId: RILEY, displayName: "Riley", lessonId: "guided:git-first-pr:install", at: "2026-10-10T00:00:00Z", via: "check" }],
      [
        { userId: OWNER, displayName: "Avery" },
        { userId: RILEY, displayName: "Riley" },
      ],
    );
    expect(members.map((m) => [m.displayName, m.tracks])).toEqual([
      ["Avery", {}],
      ["Riley", { "git-first-pr": 1 }],
    ]);
  });

  it("gives every track a short column heading", () => {
    expect(guidedTrackShortTitle({ id: "frc6925-programming", title: "Team 6925 programming, step by step" })).toBe("6925 Prog");
    expect(guidedTrackShortTitle({ id: "new-track", title: "A new track" })).toBe("A new track");
  });
});

describe("lead sign-off notices (A5-16)", () => {
  it("tells every owner and admin but the student, naming the step and where to sign it off", async () => {
    const { client, queries } = fakeClient({
      "FROM memberships": [{ userId: OWNER }, { userId: ADMIN }],
      "FROM users": [{ name: "Riley" }],
    });
    const { sent, emit } = recorder();
    const told = await notifyLeadsOfRequest(client, emit, {
      orgId: ORG,
      userId: RILEY,
      signoffId: SIGNOFF,
      trackId: "frc6925-mechanical",
      stepId: "mech-1-tools",
    });
    expect(told).toBe(2);
    expect(sent.map((s) => s.userId)).toEqual([OWNER, ADMIN]);
    expect(sent[0]!.type).toBe("guided_signoff_requested");
    expect(sent[0]!.payload.signoffId).toBe(SIGNOFF);
    expect(String(sent[0]!.payload.title)).toBe("Riley asked you to sign off a step");
    expect(sent[0]!.payload.href).toBe(`/learn/guided/team?orgId=${ORG}`);
    expect(queries[0]!.params).toEqual([ORG, RILEY]);
  });

  it("tells the student a step was sent back, with the lead's note and a link to the step", async () => {
    const { client } = fakeClient({});
    const { sent, emit } = recorder();
    const lessonId = "guided:git-first-pr:install";
    const told = await notifyStudentOfDecision(client, emit, {
      orgId: ORG,
      decided: { id: SIGNOFF, userId: RILEY, lessonId, status: "declined", note: "Show me the saw guard first." },
    });
    expect(told).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: RILEY, orgId: ORG, type: "guided_signoff_decided" });
    expect(String(sent[0]!.payload.title)).toMatch(/^Try again: /);
    expect(String(sent[0]!.payload.body)).toContain("“Show me the saw guard first.”");
    expect(sent[0]!.payload.href).toBe(`/learn/guided/git-first-pr?orgId=${ORG}#step-install`);
  });

  it("tells the student a step was signed off", async () => {
    const { client } = fakeClient({});
    const { sent, emit } = recorder();
    await notifyStudentOfDecision(client, emit, {
      orgId: ORG,
      decided: { id: SIGNOFF, userId: RILEY, lessonId: "guided:git-first-pr:install", status: "approved", note: null },
    });
    expect(String(sent[0]!.payload.title)).toMatch(/^Signed off: /);
    expect(String(sent[0]!.payload.body)).toMatch(/counts as done/);
  });

  it("reports a fresh request only once, so pressing Ask again doesn't spam the leads", async () => {
    const fresh = fakeClient({ "INSERT INTO guided_signoffs": [{ id: SIGNOFF, status: "requested" }] });
    expect(await requestSignoff(fresh.client, { orgId: ORG, userId: RILEY, trackId: "t", stepId: "s" })).toEqual({
      status: "requested",
      id: SIGNOFF,
      fresh: true,
    });
    const again = fakeClient({ "SELECT id::text AS id, status FROM guided_signoffs": [{ id: SIGNOFF, status: "requested" }] });
    expect(await requestSignoff(again.client, { orgId: ORG, userId: RILEY, trackId: "t", stepId: "s" })).toEqual({
      status: "requested",
      id: SIGNOFF,
      fresh: false,
    });
  });
});
