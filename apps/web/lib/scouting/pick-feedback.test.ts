import type { PoolClient } from "@neondatabase/serverless";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seatTopAccurateScouts } from "./pick-feedback";

const notification = vi.hoisted(() => vi.fn());
vi.mock("@vantage/core", () => ({ emitPreferredNotification: notification }));
const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const userId = "11111111-1111-4111-8111-111111111111";
const input = { orgId, eventKey: "2026txho", assignedBy: userId, meetingOn: "2026-10-09", seatCount: 1 };
function fixture(inserted: boolean | null, checks = 4) {
  const query = vi.fn().mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ userId, checks, matches: checks, entries: 2 }] })
    .mockResolvedValueOnce({ rows: inserted === null ? [] : [{ inserted }] });
  return { query, client: { query } as unknown as PoolClient };
}
beforeEach(() => notification.mockReset().mockResolvedValue(undefined));
describe("confirmed and repeatable meeting seats", () => {
  it("does not repeat a notification when the same meeting seat already exists", async () => {
    const { client, query } = fixture(false);
    expect((await seatTopAccurateScouts(client, input)).seated.map(seat => seat.userId)).toEqual([userId]);
    expect(notification).not.toHaveBeenCalled();
    expect(query.mock.calls[0]?.[1]).toEqual([`scout-seats:${orgId}:${input.eventKey}:${input.meetingOn}`]);
  });
  it("does not announce an unconfirmed insert", async () => {
    const { client } = fixture(null);
    await expect(seatTopAccurateScouts(client, input)).rejects.toThrow("could not be confirmed");
    expect(notification).not.toHaveBeenCalled();
  });
  it("requires three robot-level official checks and excludes departed scouts and disabled rules in the query", async () => {
    const { client, query } = fixture(true, 2);
    expect((await seatTopAccurateScouts(client, input)).seated).toEqual([]);
    expect(query).toHaveBeenCalledTimes(2);
    const sql = String(query.mock.calls[1]?.[0]);
    expect(sql).toContain("member.org_id=e.org_id AND member.user_id=e.scout_user_id");
    expect(sql).toContain("v.org_id=e.org_id AND v.official_source='tba'");
    expect(sql).toContain("p.schema_id=e.schema_id AND p.field_key=v.field_key AND NOT p.enabled");
    expect(notification).not.toHaveBeenCalled();
  });
  it("notifies a newly confirmed scout with the correct event and date", async () => {
    const { client } = fixture(true);
    await seatTopAccurateScouts(client, input);
    expect(notification).toHaveBeenCalledWith(client, expect.objectContaining({ userId, orgId, payload: expect.objectContaining({ eventKey: input.eventKey, meetingOn: input.meetingOn, href: expect.stringContaining(`eventKey=${input.eventKey}`) }) }));
  });
});
