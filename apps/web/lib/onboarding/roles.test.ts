import { describe, expect, it } from "vitest";
import {
  formatRoleList,
  parseStoredCrews,
  parseStoredRoles,
  serializeStoredRoles,
} from "./roles";

describe("stored role lists", () => {
  it("reads a single legacy value", () => {
    expect(parseStoredRoles("student")).toEqual(["student"]);
    expect(parseStoredCrews("cad")).toEqual(["cad"]);
  });

  it("reads comma-separated identities and jobs", () => {
    expect(parseStoredRoles("student,parent")).toEqual(["student", "parent"]);
    expect(parseStoredCrews("scout, programming, cad")).toEqual(["scout", "programming", "cad"]);
    expect(serializeStoredRoles(["scout", "cad"])).toBe("scout,cad");
  });

  it("drops unknown tokens instead of inventing roles", () => {
    expect(parseStoredRoles("student,captain")).toEqual(["student"]);
    expect(parseStoredCrews("wizard")).toEqual([]);
  });

  it("formats a short list for review", () => {
    expect(formatRoleList(["student", "parent"], { student: "Student", parent: "Parent" })).toBe(
      "Student + Parent",
    );
  });
});
