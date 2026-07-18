import { describe, expect, it } from "vitest";
import {
  assertSchemaIdentityLock,
  bindScoutIdentity,
  isScoutIdentityField,
  lockScoutPayload,
  stripScoutIdentityFields,
} from "../src/identity";

describe("scout identity lock", () => {
  it("flags free-text scout name fields by key and label", () => {
    expect(isScoutIdentityField({ key: "scout_name", label: "Scout" })).toBe(true);
    expect(isScoutIdentityField({ key: "scouter", label: "Who" })).toBe(true);
    expect(isScoutIdentityField({ key: "name", label: "Scout Name" })).toBe(true);
    expect(isScoutIdentityField({ key: "who_scouted", label: "Who scouted?" })).toBe(true);
    expect(isScoutIdentityField({ key: "notes", label: "Notes" })).toBe(false);
    expect(isScoutIdentityField({ key: "auto_score", label: "Auto" })).toBe(false);
  });

  it("strips identity fields from schemas and payloads", () => {
    const stripped = stripScoutIdentityFields({
      title: "Match",
      fields: [
        { key: "auto", label: "Auto", type: "number" },
        { key: "scout_name", label: "Scout name", type: "text" },
        { key: "notes", label: "Notes", type: "text" },
      ],
    });
    expect(stripped.removed.map((field) => field.key)).toEqual(["scout_name"]);
    expect(stripped.definition.fields.map((field) => field.key)).toEqual(["auto", "notes"]);

    const locked = lockScoutPayload({
      auto: 3,
      scout_name: "Chleo",
      notes: "clean",
      scouter: "Chloe",
    });
    expect(locked.removedKeys.sort()).toEqual(["scout_name", "scouter"]);
    expect(locked.payload).toEqual({ auto: 3, notes: "clean" });
  });

  it("rejects schemas that still carry free-text scout identity", () => {
    expect(
      assertSchemaIdentityLock({
        title: "Bad",
        fields: [{ key: "scoutName", label: "Name", type: "text" }],
      }),
    ).toMatch(/locked to membership userId/i);
    expect(
      assertSchemaIdentityLock({
        title: "Good",
        fields: [{ key: "climb", label: "Climb", type: "select", options: ["none"] }],
      }),
    ).toBeNull();
  });

  it("binds display name from membership profile, never typed payload", () => {
    expect(bindScoutIdentity({ userId: "u1", displayName: "  Chloe  " })).toEqual({
      userId: "u1",
      displayName: "Chloe",
      email: null,
    });
    expect(bindScoutIdentity({ userId: "u2", email: "scout@team.org" }).displayName).toBe(
      "scout@team.org",
    );
  });
});
