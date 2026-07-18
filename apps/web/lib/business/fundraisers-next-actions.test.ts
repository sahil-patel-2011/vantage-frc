import { describe, expect, it } from "vitest";
import { fundraisersNextActions } from "./fundraisers-next-actions";

describe("fundraisersNextActions", () => {
  it("asks for a workspace when org is missing", () => {
    const actions = fundraisersNextActions({});
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
  });

  it("points empty calendars at first event, sponsors, grants, and orders — never DEMO totals", () => {
    const actions = fundraisersNextActions({
      orgId: "org-1",
      canManageMoney: true,
      eventCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(["first-event", "sponsors", "grants", "orders"]);
    expect(actions.find((a) => a.id === "first-event")?.href).toBe("/fundraisers?orgId=org-1");
    expect(actions.find((a) => a.id === "sponsors")?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(actions.find((a) => a.id === "grants")?.href).toBe("/business?tab=grants&orgId=org-1");
    expect(actions.find((a) => a.id === "orders")?.href).toBe("/business?tab=orders&orgId=org-1");
    expect(actions.every((a) => !/demo/i.test(a.label + a.detail))).toBe(true);
  });

  it("nudges recording proceeds when events exist but raised stays zero", () => {
    const actions = fundraisersNextActions({
      orgId: "org-1",
      canManageMoney: true,
      eventCount: 2,
      plannedCount: 1,
      activeCount: 1,
      totalGoalUsd: 500,
      totalRaisedUsd: 0,
    });
    expect(actions[0]?.id).toBe("record");
    expect(actions.some((a) => a.id === "sponsors")).toBe(true);
  });

  it("asks for event goals when proceeds exist without goals", () => {
    const actions = fundraisersNextActions({
      orgId: "org-1",
      canManageMoney: true,
      eventCount: 1,
      activeCount: 1,
      totalGoalUsd: 0,
      totalRaisedUsd: 120,
    });
    expect(actions.some((a) => a.id === "event-goals")).toBe(true);
  });
});
