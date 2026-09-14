import { describe, expect, it } from "vitest";
import { workspaceShellCopy } from "../workspace/workspace-join";

describe("leftover workspace setup chrome", () => {
  it("incomplete profile is Needs setup and Finish your profile", () => {
    expect(workspaceShellCopy("setup").badge).toBe("Needs setup");
    expect(workspaceShellCopy("setup").title).toBe("Finish your profile");
    expect(workspaceShellCopy("select").title).toBe("Choose your team");
  });
});
