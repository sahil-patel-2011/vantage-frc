import { describe, expect, it } from "vitest";
import {
  draftFor,
  hubAccessFor,
  rowChange,
  toggleSection,
  togglePower,
  withRole,
  type GridMember,
} from "./permissions-grid";

const student: GridMember = {
  userId: "u1",
  name: "Sam",
  email: "sam@example.org",
  role: "scout",
  capabilities: [],
  hubAccess: [],
};

describe("permissions grid", () => {
  it("treats no stored rows as every section open", () => {
    expect(draftFor(student).open).toHaveLength(6);
    expect(rowChange(student, draftFor(student))).toBeNull();
  });

  it("stores only the open sections once one is turned off", () => {
    const draft = toggleSection(draftFor(student), "business");
    const change = rowChange(student, draft);
    expect(change?.changed).toEqual({ role: false, capabilities: false, hubAccess: true });
    expect(change?.hubAccess.map((row) => row.hubId)).not.toContain("business");
    expect(change?.hubAccess).toHaveLength(5);
  });

  it("goes back to storing nothing when every section is on again", () => {
    const limited: GridMember = { ...student, hubAccess: [{ hubId: "team", allowedTabIds: [] }] };
    let draft = draftFor(limited);
    for (const id of ["competition", "business", "build", "ai", "media"] as const) draft = toggleSection(draft, id);
    expect(hubAccessFor(limited, draft)).toEqual([]);
  });

  it("keeps page limits on a section that stays on", () => {
    const limited: GridMember = {
      ...student,
      hubAccess: [
        { hubId: "competition", allowedTabIds: ["scouting"] },
        { hubId: "team", allowedTabIds: [] },
      ],
    };
    const change = rowChange(limited, toggleSection(draftFor(limited), "build"));
    expect(change?.hubAccess.find((row) => row.hubId === "competition")?.allowedTabIds).toEqual(["scouting"]);
  });

  it("never turns off the last open section", () => {
    const one: GridMember = { ...student, hubAccess: [{ hubId: "team", allowedTabIds: [] }] };
    const draft = draftFor(one);
    expect(toggleSection(draft, "team")).toBe(draft);
  });

  it("gives a scouting lead every Competition page", () => {
    const limited: GridMember = { ...student, hubAccess: [{ hubId: "competition", allowedTabIds: ["scouting"] }, { hubId: "team", allowedTabIds: [] }] };
    const rows = hubAccessFor(limited, togglePower(draftFor(limited), "manage_scouting"));
    expect(rows.find((row) => row.hubId === "competition")?.allowedTabIds).toEqual([]);
  });

  it("drops sections and powers for a mentor and changes only the role", () => {
    const change = rowChange(student, withRole(student, togglePower(draftFor(student), "manage_members"), "admin"));
    expect(change).toEqual({
      role: "admin",
      capabilities: [],
      hubAccess: [],
      changed: { role: true, capabilities: false, hubAccess: false },
    });
  });

  it("starts a mentor made a student with everything open and no powers", () => {
    const mentor: GridMember = { ...student, role: "admin" };
    const draft = withRole(mentor, draftFor(mentor), "scout");
    expect(draft).toEqual({ role: "scout", capabilities: [], open: draftFor(student).open });
    expect(rowChange(mentor, draft)?.changed).toEqual({ role: true, capabilities: false, hubAccess: false });
  });
});
