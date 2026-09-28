import { describe, expect, it } from "vitest";
import { provisioningReady, PROVISIONING_PHASES, type ProvisioningStatus } from "./model";
describe("verified setup", () => {
  const ready: ProvisioningStatus = { state: "ready", phase: "ready", completedPhases: PROVISIONING_PHASES.map((phase) => phase.id), verifiedAt: "2026-09-26T12:00:00Z", error: null };
  it("opens Home as soon as every phase has been verified", () => expect(provisioningReady(ready)).toBe(true));
  it("rejects a misleading ready state or partial setup", () => {
    expect(provisioningReady({ ...ready, verifiedAt: null })).toBe(false);
    expect(provisioningReady({ ...ready, completedPhases: ["team", "workspace"] })).toBe(false);
    expect(provisioningReady({ ...ready, state: "failed" })).toBe(false);
    expect(provisioningReady({ ...ready, state: "waiting", retryAfterAt: "2026-09-27T00:00:00Z" })).toBe(false);
  });
});
