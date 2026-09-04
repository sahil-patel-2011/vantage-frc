import { describe, expect, it } from "vitest";
import {
  isolationFolderNote,
  isOrgWorkspaceId,
  orgWorkspaceFolderName,
  orgWorkspacePath,
  parseOrgIdHeader,
  PLATFORM_FREEBUFF_RELAY_NAME,
  resolveWorkspaceRoot,
} from "../src/org-workspace";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("per-team Freebuff coding folders", () => {
  it("names the platform Pi exactly", () => {
    expect(PLATFORM_FREEBUFF_RELAY_NAME).toBe("frcvantagefreebuff relay");
  });

  it("uses one UUID folder per org and refuses a shared dump", () => {
    expect(orgWorkspaceFolderName(ORG_A)).toBe(`org-${ORG_A}`);
    expect(orgWorkspaceFolderName(ORG_A)).not.toBe(orgWorkspaceFolderName(ORG_B));
    expect(() => orgWorkspaceFolderName("../etc")).toThrow(/uuid/i);
    expect(() => orgWorkspaceFolderName("shared")).toThrow(/uuid/i);
    expect(isOrgWorkspaceId(ORG_A)).toBe(true);
    expect(isOrgWorkspaceId("frc-6925")).toBe(false);
  });

  it("never lets a header rewrite the workspace root", () => {
    expect(parseOrgIdHeader(ORG_A)).toBe(ORG_A);
    expect(parseOrgIdHeader(` ${ORG_A.toUpperCase()} `)).toBe(ORG_A);
    expect(parseOrgIdHeader("../org-leak")).toBeNull();
    expect(parseOrgIdHeader("")).toBeNull();
    expect(orgWorkspacePath(ORG_A, { FREEBUFF_WORKSPACE_ROOT: "/var/lib/vantage-freebuff/orgs" })).toBe(
      `/var/lib/vantage-freebuff/orgs/org-${ORG_A}`,
    );
    expect(resolveWorkspaceRoot({ HOME: "/home/pi" })).toMatch(/vantage-freebuff\/orgs$/);
    expect(isolationFolderNote(ORG_A, `/tmp/org-${ORG_A}`)).toContain(ORG_A);
    expect(isolationFolderNote(ORG_A, `/tmp/org-${ORG_A}`)).not.toContain(ORG_B);
  });
});
