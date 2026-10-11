import { describe, expect, it } from "vitest";
import {
  GOOGLE_NOT_CONNECTED_COPY,
  GOOGLE_PROVISIONING_PHASES,
  googleWorkspaceDeferred,
  provisioningHeadline,
  provisioningReady,
  workspaceReady,
  PROVISIONING_PHASES,
  type ProvisioningStatus,
} from "./model";
describe("verified setup", () => {
  const ready: ProvisioningStatus = { state: "ready", phase: "ready", completedPhases: PROVISIONING_PHASES.map((phase) => phase.id), verifiedAt: "2026-09-26T12:00:00Z", error: null };
  it("opens Home as soon as every phase has been verified", () => expect(provisioningReady(ready)).toBe(true));
  it("rejects a misleading ready state or partial setup", () => {
    expect(provisioningReady({ ...ready, verifiedAt: null })).toBe(false);
    expect(provisioningReady({ ...ready, completedPhases: ["team", "workspace"] })).toBe(false);
    expect(provisioningReady({ ...ready, state: "failed" })).toBe(false);
    expect(provisioningReady({ ...ready, state: "waiting", retryAfterAt: "2026-09-27T00:00:00Z" })).toBe(false);
  });
  it("lets initialized tools work while external copies wait, without claiming verified recovery", () => {
    const background: ProvisioningStatus = { ...ready, state: "failed", phase: "workspace", completedPhases: ["team", "tools"], verifiedAt: null };
    expect(workspaceReady(background)).toBe(true);
    expect(provisioningReady(background)).toBe(false);
    expect(workspaceReady({ ...background, completedPhases: ["team"] })).toBe(false);
  });
});

describe("a server without Google", () => {
  const deferred: ProvisioningStatus = {
    state: "waiting",
    phase: "workspace",
    completedPhases: ["team", "tools"],
    verifiedAt: null,
    error: null,
    retryAfterAt: null,
    googleWorkspace: "not_connected",
  };
  it("reads as a ready team with an optional step, never as needing attention", () => {
    expect(googleWorkspaceDeferred(deferred)).toBe(true);
    expect(workspaceReady(deferred)).toBe(true);
    expect(provisioningReady(deferred)).toBe(false);
    expect(provisioningHeadline(deferred)).toBe("Your team is ready");
    expect(GOOGLE_NOT_CONNECTED_COPY.status).toMatch(/Optional/);
  });
  it("keeps the real failure and provider-wait headings", () => {
    expect(provisioningHeadline({ ...deferred, googleWorkspace: null, state: "failed" })).toBe("Your setup needs attention");
    expect(provisioningHeadline({ ...deferred, googleWorkspace: null })).toBe("Your setup is waiting");
    expect(provisioningHeadline({ ...deferred, googleWorkspace: null, state: "running" })).toBe("Setting up your team");
  });
  it("lists only the Google steps as needing the connection", () => {
    expect(GOOGLE_PROVISIONING_PHASES).toEqual(["workspace", "sheets", "recovery", "verify"]);
  });
});
