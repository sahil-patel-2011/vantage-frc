import { describe, expect, it } from "vitest";
import {
  CONNECTOR_LIFECYCLE,
  CONNECTOR_SAFETY,
  CONNECTOR_STEPS,
} from "./claude-connector-steps";

describe("CONNECTOR_STEPS", () => {
  it("is short enough that somebody finishes it", () => {
    expect(CONNECTOR_STEPS.length).toBeGreaterThanOrEqual(4);
    expect(CONNECTOR_STEPS.length).toBeLessThanOrEqual(6);
  });

  it("gives every step a title and a reason, not just a command", () => {
    for (const step of CONNECTOR_STEPS) {
      expect(step.title.length, step.id).toBeGreaterThan(0);
      expect(step.body.length, step.id).toBeGreaterThan(30);
      expect(step.body.trim().endsWith("."), step.id).toBe(true);
    }
  });

  it("signs in before pairing, and registers before restarting", () => {
    // The order is load-bearing: pairing without a session, or registering the
    // tools after the session that needs them is already open, both fail in
    // ways that look like the connector is broken.
    const order = CONNECTOR_STEPS.map((s) => s.id);
    expect(order.indexOf("login")).toBeLessThan(order.indexOf("pair"));
    expect(order.indexOf("register")).toBeLessThan(order.indexOf("restart"));
    expect(order.indexOf("restart")).toBeLessThan(order.indexOf("check"));
  });

  it("warns that a running session will not pick the tools up", () => {
    // This is the step people skip, and skipping it looks exactly like a broken
    // install. If the warning ever goes away, so does the only clue.
    const restart = CONNECTOR_STEPS.find((s) => s.id === "restart");
    expect(restart?.gotcha).toBeTruthy();
    expect(restart?.gotcha).toMatch(/new session/i);
  });

  it("has no duplicate ids", () => {
    expect(new Set(CONNECTOR_STEPS.map((s) => s.id)).size).toBe(CONNECTOR_STEPS.length);
  });
});

describe("CONNECTOR_LIFECYCLE", () => {
  it("answers the stay-open question differently for the two CAD tools", () => {
    // Saying "the connector stays running" without this split is how people
    // leave a window open forever for Onshape work that never needed one, or
    // close the one Fusion did.
    expect(CONNECTOR_LIFECYCLE.onshape.body).toMatch(/nothing|no window|stops/i);
    expect(CONNECTOR_LIFECYCLE.fusion.body).toMatch(/leave that terminal open/i);
    expect(CONNECTOR_LIFECYCLE.fusion.command).toBeTruthy();
  });

  it("does not claim Onshape needs something running", () => {
    expect(CONNECTOR_LIFECYCLE.onshape).not.toHaveProperty("command");
    expect(CONNECTOR_LIFECYCLE.onshape.body).not.toMatch(/leave.*open/i);
  });

  it("says what breaks when the Fusion terminal is closed", () => {
    expect(CONNECTOR_LIFECYCLE.fusion.body).toMatch(/Onshape work carries on/i);
  });
});

describe("CONNECTOR_SAFETY", () => {
  it("says to use a scratch document before it says anything else", () => {
    expect(CONNECTOR_SAFETY).toMatch(/scratch/i);
    expect(CONNECTOR_SAFETY).toMatch(/competition robot/i);
  });
});
