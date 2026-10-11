import { describe, expect, it } from "vitest";
import { BASE_ROLE_COPY, PROFILE_HUBS, isRoleProfileDenied } from "./role-profile-copy";

describe("role profile words", () => {
  it("uses the one role table and the places' current names", () => {
    expect([BASE_ROLE_COPY.scout.label, BASE_ROLE_COPY.admin.label, BASE_ROLE_COPY.viewer.label]).toEqual([
      "Student",
      "Mentor or coach",
      "Parent or guest",
    ]);
    // The Team hub's place is called Tasks (F's naming pass), not "work".
    expect(PROFILE_HUBS.find((hub) => hub.id === "team")?.hint).toBe("Calendar, chat, people, tasks, playbook");
  });
});

describe("isRoleProfileDenied", () => {
  it("hides the editor when the API refused the role", () => {
    expect(isRoleProfileDenied("Organization administrator access required")).toBe(true);
    expect(isRoleProfileDenied("Organization access denied")).toBe(true);
    expect(isRoleProfileDenied("Could not load role profiles")).toBe(false);
  });
});