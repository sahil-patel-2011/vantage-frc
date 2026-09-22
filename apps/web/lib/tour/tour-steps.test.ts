import { describe, expect, it } from "vitest";
import {
  CARD_GAP,
  TOUR_DIALOG_LABEL,
  TOUR_STEPS,
  availableSteps,
  placeCard,
  stepProgress,
  tourShouldYield,
} from "./tour-steps";

const VIEWPORT = { width: 1200, height: 800 };
const CARD = { width: 320, height: 160 };

describe("TOUR_STEPS", () => {
  it("is short enough that nobody skips it out of boredom", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(4);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(6);
  });

  it("gives every step a target, a title and a body", () => {
    for (const step of TOUR_STEPS) {
      expect(step.target, step.id).toBeTruthy();
      expect(step.title.length, step.id).toBeGreaterThan(0);
      expect(step.body.length, step.id).toBeGreaterThan(0);
    }
  });

  it("has no duplicate ids or targets", () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    expect(new Set(TOUR_STEPS.map((s) => s.target)).size).toBe(TOUR_STEPS.length);
  });
});

describe("availableSteps", () => {
  it("drops steps whose target is not on the page", () => {
    // A control that needs a team, or a widget nobody added, must not leave the
    // spotlight pointing at nothing.
    const present = (target: string) => target !== "customise";
    const steps = availableSteps(TOUR_STEPS, present);
    expect(steps.map((s) => s.target)).not.toContain("customise");
    expect(steps.length).toBe(TOUR_STEPS.length - 1);
  });

  it("keeps the authored order", () => {
    const steps = availableSteps(TOUR_STEPS, () => true);
    expect(steps.map((s) => s.id)).toEqual(TOUR_STEPS.map((s) => s.id));
  });

  it("returns nothing when the page has none of the targets", () => {
    expect(availableSteps(TOUR_STEPS, () => false)).toEqual([]);
  });
});

describe("tourShouldYield", () => {
  it("stays up when the only dialog is the tour", () => {
    expect(tourShouldYield([TOUR_DIALOG_LABEL])).toBe(false);
    expect(tourShouldYield([])).toBe(false);
  });

  it("waits while another dialog is open, even without an accessible name", () => {
    expect(tourShouldYield([null])).toBe(true);
    expect(tourShouldYield([TOUR_DIALOG_LABEL, "Set active event"])).toBe(true);
  });
});

describe("placeCard", () => {
  const target = { top: 300, left: 500, width: 100, height: 40 };

  it("uses the preferred side when it fits", () => {
    expect(placeCard({ target, card: CARD, viewport: VIEWPORT, prefer: "bottom" }).side).toBe("bottom");
    expect(placeCard({ target, card: CARD, viewport: VIEWPORT, prefer: "top" }).side).toBe("top");
  });

  it("centres the card on the target when above or below", () => {
    const placed = placeCard({ target, card: CARD, viewport: VIEWPORT, prefer: "bottom" });
    expect(placed.left).toBe(target.left + target.width / 2 - CARD.width / 2);
    expect(placed.top).toBe(target.top + target.height + CARD_GAP);
  });

  it("flips away from a side with no room", () => {
    // Target hard against the top: "top" cannot fit a 160px card.
    const highUp = { top: 4, left: 500, width: 100, height: 40 };
    expect(placeCard({ target: highUp, card: CARD, viewport: VIEWPORT, prefer: "top" }).side).not.toBe("top");
  });

  it("keeps the card on screen even when nothing fits", () => {
    const tiny = { width: 200, height: 150 };
    const placed = placeCard({
      target: { top: 60, left: 60, width: 80, height: 30 },
      card: CARD,
      viewport: tiny,
      prefer: "right",
    });
    expect(placed.left).toBeGreaterThanOrEqual(0);
    expect(placed.top).toBeGreaterThanOrEqual(0);
    // A card half off-screen is useless; pinned to an edge is readable.
    expect(placed.left).toBeLessThanOrEqual(tiny.width);
    expect(placed.top).toBeLessThanOrEqual(tiny.height);
  });

  it("never pushes the card off the right or bottom edge", () => {
    const farRight = { top: 700, left: 1150, width: 40, height: 40 };
    const placed = placeCard({ target: farRight, card: CARD, viewport: VIEWPORT });
    expect(placed.left + CARD.width).toBeLessThanOrEqual(VIEWPORT.width);
    expect(placed.top + CARD.height).toBeLessThanOrEqual(VIEWPORT.height);
  });
});

describe("stepProgress", () => {
  it("counts from one, so nobody wonders how much longer this goes on", () => {
    expect(stepProgress(0, 5)).toBe("Step 1 of 5");
    expect(stepProgress(4, 5)).toBe("Step 5 of 5");
  });
});
