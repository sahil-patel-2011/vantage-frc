import { describe, expect, it } from "vitest";
import { reviewMutationRequest } from "./request";
import { confirmedReviewResult, isReviewView } from "./view-contract";
import { MAX_REPORT_TARGET } from "./types";

const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const eventKey = "2026custom-team-practice";
const nudgeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const scope = { orgId, eventKey };
const target = { ...scope, action: "set-threshold", thinThreshold: 2, expectedThreshold: 1 };

describe("coverage review request and acknowledgement boundaries", () => {
  it("validates seen targets and rejects out-of-range targets", () => {
    expect(reviewMutationRequest.safeParse(target).success).toBe(true);
    // The route gives older clients without a baseline an actionable refresh-required 409.
    expect(reviewMutationRequest.safeParse({ ...target, expectedThreshold: undefined }).success).toBe(true);
    for (const thinThreshold of [0, 1.5, MAX_REPORT_TARGET + 1]) {
      expect(reviewMutationRequest.safeParse({ ...target, thinThreshold }).success).toBe(false);
    }
    // An older large target can be reduced without pretending the baseline was 20.
    expect(reviewMutationRequest.safeParse({ ...target, expectedThreshold: 100 }).success).toBe(true);
  });
  it("supports custom-event matches but refuses blank flags, invented match keys and extra actions", () => {
    const flag = { ...scope, action: "send-nudge", matchKey: `${eventKey}_sf2m1`, teamKey: "frc6925", message: " Please review this robot. " };
    expect(reviewMutationRequest.parse(flag).action).toBe("send-nudge");
    for (const invalid of [{ ...flag, message: " " }, { ...flag, matchKey: "match 1" }, { ...flag, acknowledgeAll: true }]) {
      expect(reviewMutationRequest.safeParse(invalid).success).toBe(false);
    }
  });
  it("does not call a different target, robot or flag a confirmed save", () => {
    expect(confirmedReviewResult({ action: "set-threshold", thinThreshold: 3 }, { action: "set-threshold", thinThreshold: 2, expectedThreshold: 1 })).toBeNull();
    const flag = { action: "send-nudge" as const, matchKey: `${eventKey}_qm1`, teamKey: "frc6925", message: "Review" };
    expect(confirmedReviewResult({ ...flag, nudgeId, created: true }, flag)?.action).toBe("send-nudge");
    expect(confirmedReviewResult({ ...flag, teamKey: "frc254", nudgeId, created: true }, flag)).toBeNull();
    expect(confirmedReviewResult({ action: "acknowledge-nudge", nudgeId: orgId, acknowledgedAt: "2026-10-09T12:00:00Z" }, { action: "acknowledge-nudge", nudgeId })).toBeNull();
    expect(confirmedReviewResult({ action: "send-nudge", nudgeId, created: true }, flag)).toBeNull();
  });
  it("rejects another team's device copy and an unexpected event", () => {
    const setup = { ...scope, status: "setup_required", message: "No schedule", steps: [] };
    expect(isReviewView(setup, orgId, eventKey)).toBe(true);
    expect(isReviewView(setup, nudgeId, eventKey)).toBe(false);
    expect(isReviewView(setup, orgId, "2026other")).toBe(false);
    expect(isReviewView({ ...setup, steps: null }, orgId)).toBe(false);
  });
});
