import { describe, expect, it } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  inviteAcceptedNotice,
  latestTeamRemoval,
  notifyRemovedFromTeam,
  notifyRoleChanged,
  ownershipGivenNotice,
  removedNotice,
  roleChangedNotice,
  teamDisplayName,
} from "./membership-notices";
import { prefKeyForNotificationType } from "./in-app-notifications";

type Call = { sql: string; params: unknown[] };
function mockClient(route: (sql: string) => Record<string, unknown>[] | Error = () => []) {
  const calls: Call[] = [];
  const client = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const result = route(sql);
      if (result instanceof Error) throw result;
      return { rows: result, rowCount: result.length };
    },
  } as unknown as PoolClient;
  return { client, calls };
}

describe("membership notices (QA A3-15/16)", () => {
  it("names the team once, never 'Team 9301 · Team 9301'", () => {
    expect(teamDisplayName(9301, "QA 3 Alpha")).toBe("Team 9301 · QA 3 Alpha");
    expect(teamDisplayName(9301, "Team 9301")).toBe("Team 9301");
    expect(teamDisplayName(null, null)).toBe("your team");
  });

  it("tells someone their access changed, in role words, and who to ask when it went down", () => {
    const lowered = roleChangedNotice({ orgId: "o", team: "Team 9301", actorName: "Quinn", role: "viewer", previousRole: "scout" });
    expect(lowered.type).toBe("team_role_changed");
    expect(lowered.payload.title).toBe("You're now a parent or guest on Team 9301");
    expect(lowered.payload.body).toContain("Quinn changed your access from Student to Parent or guest.");
    expect(lowered.payload.body).toContain("ask Quinn");
    const raised = roleChangedNotice({ orgId: "o", team: "Team 9301", actorName: "Quinn", role: "admin", previousRole: "scout" });
    expect(raised.payload.body).not.toContain("mistake");
  });

  it("tells a removed member which team and that their account is theirs", () => {
    const notice = removedNotice({ orgId: "o", team: "Team 9301 · QA 3 Alpha", teamNumber: 9301, teamName: "QA 3 Alpha", actorName: "Quinn" });
    expect(notice.type).toBe("team_removed");
    expect(notice.payload.title).toBe("You were removed from Team 9301 · QA 3 Alpha");
    expect(notice.payload.body).toContain("still yours");
    expect(notice.payload.orgId).toBe("o");
  });

  it("tells the new owner they were handed the team", () => {
    expect(ownershipGivenNotice({ orgId: "o", team: "Team 9301", actorName: "Quinn" }).payload.title).toBe(
      "You're now the owner of Team 9301",
    );
  });

  it("announces a code joiner accurately: how they came in, and what they said they are (QA A3-02)", () => {
    const parent = inviteAcceptedNotice({ userId: "u", who: "Pam", role: "viewer", viaCode: true, selfRole: "parent" });
    expect(parent.payload.title).toBe("Pam joined with the team code as Parent or guest");
    const mentor = inviteAcceptedNotice({ userId: "u", who: "Mike", role: "scout", viaCode: true, selfRole: "mentor" });
    expect(mentor.payload.body).toBe("They said they're a mentor. If Mentor or coach fits better, change their access in Team admin.");
    const student = inviteAcceptedNotice({ userId: "u", who: "Sam", role: "viewer", viaCode: true, selfRole: null });
    expect(student.payload.body).toContain("give them Student access");
    const invited = inviteAcceptedNotice({ userId: "u", who: "Sam", role: "scout", viaCode: false, selfRole: "student" });
    expect(invited.payload).toEqual({ userId: "u", title: "Sam joined as Student", body: "They're on the team now." });
  });

  it("keeps every membership notice outside the inbox preferences", () => {
    for (const type of ["team_role_changed", "team_removed", "team_ownership_given", "invite_suggestion"]) {
      expect(prefKeyForNotificationType(type)).toBeNull();
    }
  });

  it("writes the removal notice without an org (they can't open the team) inside a savepoint", async () => {
    const { client, calls } = mockClient((sql) =>
      sql.includes("FROM organizations") ? [{ teamNumber: 9301, teamName: "QA 3 Alpha", actorName: "Quinn" }] : [],
    );
    await expect(notifyRemovedFromTeam(client, { orgId: "org-1", actorUserId: "lead", userId: "kid" })).resolves.toBe(true);
    const insert = calls.find((call) => call.sql.includes("INSERT INTO notifications"))!;
    expect(insert.params[0]).toBe("kid");
    expect(insert.params[1]).toBeNull();
    expect(insert.params[2]).toBe("team_removed");
    expect(calls[0]!.sql).toBe("SAVEPOINT membership_notice");
  });

  it("never fails the change when the notice can't be written", async () => {
    const { client, calls } = mockClient((sql) => (sql.includes("INSERT INTO notifications") ? new Error("policy") : []));
    await expect(
      notifyRoleChanged(client, { orgId: "org-1", actorUserId: "lead", userId: "kid", role: "viewer", previousRole: "scout" }),
    ).resolves.toBe(false);
    expect(calls.some((call) => call.sql === "ROLLBACK TO SAVEPOINT membership_notice")).toBe(true);
    // Not for yourself, and not when nothing changed.
    const quiet = mockClient();
    await notifyRoleChanged(quiet.client, { orgId: "org-1", actorUserId: "a", userId: "a", role: "viewer", previousRole: "scout" });
    await notifyRoleChanged(quiet.client, { orgId: "org-1", actorUserId: "a", userId: "b", role: "scout", previousRole: "scout" });
    expect(quiet.calls).toHaveLength(0);
  });

  it("reads the newest removal for the no-team screen", async () => {
    const { client } = mockClient(() => [
      {
        payload: { orgId: "org-1", teamNumber: 9301, teamName: "QA 3 Alpha", removedBy: "Quinn", removedAt: "2026-10-11T20:00:00.000Z" },
        createdAt: new Date("2026-10-11T20:00:00Z"),
      },
    ]);
    await expect(latestTeamRemoval(client, "kid")).resolves.toEqual({
      orgId: "org-1",
      team: "Team 9301 · QA 3 Alpha",
      removedBy: "Quinn",
      removedAt: "2026-10-11T20:00:00.000Z",
    });
    await expect(latestTeamRemoval(mockClient().client, "kid")).resolves.toBeNull();
  });
});
