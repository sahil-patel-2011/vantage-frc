import { describe, expect, it } from "vitest";
import {
  ALLOWLISTED_CAD_OPERATIONS,
  DESTRUCTIVE_CAD_OPERATIONS,
  VERIFY_CAD_OPERATIONS,
  canAutoRunWithinAllowlist,
  isAllowlistedCadOperation,
  requiresDestructiveConfirmation,
  type CadOperation,
} from "../src/agent-policy";

/**
 * The one rule that keeps a CAD agent from quietly editing somebody's robot.
 *
 * Two sets decide what happens without a human: `VERIFY_CAD_OPERATIONS` may run
 * unattended, `DESTRUCTIVE_CAD_OPERATIONS` may not. `assertAllowlistedPlan` in
 * `agent-loop.ts` skips its approval check entirely for anything in the verify
 * set — which is correct only for as long as the two sets share no members.
 *
 * Nothing checked that. They are disjoint today, and the day somebody adds a
 * new operation to both — or drops a `create_*` into the verify set because it
 * is cheap and they wanted it to run without a prompt — the agent would mutate
 * geometry unattended and no test would notice. The failure is silent and the
 * damage is somebody's part studio, so the invariant gets its own file.
 */
describe("nothing destructive can run unattended", () => {
  it("shares no operation between the verify set and the destructive set", () => {
    const both = [...VERIFY_CAD_OPERATIONS].filter((operation) =>
      DESTRUCTIVE_CAD_OPERATIONS.has(operation),
    );
    expect(
      both,
      `these may run unattended AND mutate geometry: ${both.join(", ")}`,
    ).toEqual([]);
  });

  it("refuses to auto-run anything that needs confirmation", () => {
    for (const operation of DESTRUCTIVE_CAD_OPERATIONS) {
      expect(requiresDestructiveConfirmation(operation), operation).toBe(true);
      // Even with auto-run turned all the way on.
      expect(canAutoRunWithinAllowlist(operation, true), operation).toBe(false);
    }
  });

  it("auto-runs nothing at all when auto-run is off", () => {
    for (const operation of VERIFY_CAD_OPERATIONS) {
      expect(canAutoRunWithinAllowlist(operation, true), operation).toBe(true);
      expect(canAutoRunWithinAllowlist(operation, false), operation).toBe(false);
    }
  });

  it("never auto-runs an operation that is not on the allowlist", () => {
    for (const operation of VERIFY_CAD_OPERATIONS) {
      expect(isAllowlistedCadOperation(operation), operation).toBe(true);
    }
    // A plausible-looking operation that nobody allowlisted stays refused.
    for (const invented of ["delete_everything", "run_script", "create_extrude_fast"]) {
      const operation = invented as CadOperation;
      expect(isAllowlistedCadOperation(operation), invented).toBe(false);
      expect(canAutoRunWithinAllowlist(operation, true), invented).toBe(false);
    }
  });

  it("classifies every allowlisted operation as one thing or the other", () => {
    // An operation in neither set is the interesting case: it is allowed, it
    // will not auto-run, and it is not flagged as needing confirmation — so
    // whether it is gated depends entirely on the caller setting
    // `requiresApproval`, which is the kind of implicit contract that rots.
    const unclassified = ALLOWLISTED_CAD_OPERATIONS.filter(
      (operation) =>
        !VERIFY_CAD_OPERATIONS.has(operation) && !DESTRUCTIVE_CAD_OPERATIONS.has(operation),
    );
    expect(
      unclassified,
      `neither verify nor destructive — decide which: ${unclassified.join(", ")}`,
    ).toEqual([]);
  });
});
