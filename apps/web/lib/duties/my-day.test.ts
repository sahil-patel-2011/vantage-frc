import { describe, expect, it } from "vitest";
import {
  assignedWatches,
  loadOnDutyForMyDay,
  mapWatchRow,
  pickActiveWatch,
  watchToMyDayCue,
} from "./my-day";
import type { DutyWatch } from "./types";

const NOW = new Date("2026-03-07T16:00:00.000Z");
const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

function watch(overrides: Partial<DutyWatch> = {}): DutyWatch {
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
    mine: true,
    ...overrides,
  };
}

describe("assignedWatches + pickActiveWatch", () => {
  it("returns nothing until a slot has an assignee", () => {
    const open = watch({ assignedUserId: null, assignedUserName: null, mine: false });
    expect(assignedWatches([open])).toEqual([]);
    expect(pickActiveWatch([open], NOW)).toBeNull();
  });

  it("prefers the assigned slot that covers now", () => {
    const future = watch({
      id: "later",
      startsAt: "2026-03-08T14:00:00.000Z",
      endsAt: "2026-03-08T22:00:00.000Z",
    });
    const current = watch({ id: "now" });
    expect(pickActiveWatch([future, current], NOW)?.id).toBe("now");
  });

  it("falls forward to the next assigned slot when nobody is in window", () => {
    const past = watch({
      id: "past",
      startsAt: "2026-03-06T14:00:00.000Z",
      endsAt: "2026-03-06T18:00:00.000Z",
    });
    const next = watch({
      id: "next",
      kind: "chaperone",
      startsAt: "2026-03-08T08:00:00.000Z",
      endsAt: "2026-03-08T20:00:00.000Z",
    });
    expect(pickActiveWatch([past, next], NOW)?.id).toBe("next");
  });
});

describe("watchToMyDayCue", () => {
  it("maps an assigned watch onto the My Day on-duty cue", () => {
    expect(watchToMyDayCue(watch())).toEqual({
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
  });
});

describe("mapWatchRow", () => {
  it("drops roster kinds so a scouting slot cannot become the My Day adult", () => {
    expect(
      mapWatchRow(
        {
          id: "d1",
          kind: "scouting",
          title: "Scout",
          assignedUserId: USER,
          assignedUserName: "Alex",
          phone: "",
          startsAt: "2026-03-07T14:00:00.000Z",
          endsAt: null,
          locationNote: "",
          notes: "",
        },
        USER,
      ),
    ).toBeNull();
  });
});

describe("loadOnDutyForMyDay", () => {
  it("returns null when every row is unassigned or the table is missing", async () => {
    const empty = {
      query: async () => ({ rows: [], rowCount: 0 }),
    } as never;
    expect(await loadOnDutyForMyDay(empty, { orgId: ORG, now: NOW })).toBeNull();

    const boom = {
      query: async () => {
        throw new Error('relation "duty_assignments" does not exist');
      },
    } as never;
    expect(await loadOnDutyForMyDay(boom, { orgId: ORG, now: NOW })).toBeNull();
  });

  it("scopes the read to the org and only assigned on-duty / chaperone rows", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return {
          rows: [
            {
              id: "w1",
              kind: "chaperone",
              title: "Chaperone",
              assignedUserId: USER,
              assignedUserName: "Pat",
              phone: "",
              startsAt: "2026-03-07T14:00:00.000Z",
              endsAt: "2026-03-07T22:00:00.000Z",
              locationNote: "Hotel lobby",
              notes: "",
            },
          ],
          rowCount: 1,
        };
      },
    } as never;

    const cue = await loadOnDutyForMyDay(client, { orgId: ORG, userId: USER, now: NOW });
    expect(cue?.mentorName).toBe("Pat");
    expect(cue?.kind).toBe("chaperone");
    expect(calls[0]!.params[0]).toBe(ORG);
    expect(calls[0]!.sql).toMatch(/org_id = \$1::uuid/);
    expect(calls[0]!.sql).toMatch(/assigned_user_id IS NOT NULL/);
    expect(calls[0]!.params[1]).toEqual(["on_duty", "chaperone"]);
  });
});
