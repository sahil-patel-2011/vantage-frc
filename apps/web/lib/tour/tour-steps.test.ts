import { describe, expect, it } from "vitest";
import {
  CARD_GAP,
  TOUR_DIALOG_LABEL,
  TOUR_STEPS,
  availableSteps,
  placeCard,
  stepProgress,
  tourIsForNewMember,
  tourIsWorthShowing,
  tourShouldYield,
  tourTargetForHref,
} from "./tour-steps";

const VIEWPORT = { width: 1200, height: 800 };
const CARD = { width: 320, height: 160 };

describe("TOUR_STEPS", () => {
  it("is short enough that nobody skips it out of boredom", () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(6);
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(8);
  });

  it("gives every step a title and a body, and a target unless it is the welcome", () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length, step.id).toBeGreaterThan(0);
      expect(step.body.length, step.id).toBeGreaterThan(0);
      if (step.id !== "welcome") expect(step.target, step.id).toBeTruthy();
    }
  });

  it("opens with a centred welcome that points at nothing, and ends at the feedback button", () => {
    const first = TOUR_STEPS[0]!;
    expect(first.id).toBe("welcome");
    expect(first.target).toBeNull();
    const last = TOUR_STEPS[TOUR_STEPS.length - 1]!;
    expect(last.id).toBe("feedback");
    expect(last.target).toBe("feedback");
    expect(last.body).toBe("Found a bug or have an idea? Tap here any time.");
  });

  it("shows the meaningful parts of the app, in order", () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual([
      "welcome",
      "event",
      "scouting",
      "team-work",
      "menu",
      "ask-ai",
      "customise",
      "feedback",
    ]);
  });

  it("says each thing in one or two plain sentences", () => {
    for (const step of TOUR_STEPS) {
      const sentences = step.body.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, step.id).toBeGreaterThanOrEqual(1);
      expect(sentences.length, step.id).toBeLessThanOrEqual(2);
      expect(step.body.length, step.id).toBeLessThanOrEqual(170);
      // No jargon a 14-year-old would have to look up.
      expect(step.body, step.id).not.toMatch(/\b(workspace|widget|dashboard|onboard|configure|API)\b/i);
    }
  });

  it("has no duplicate ids or targets", () => {
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOUR_STEPS.length);
    const targets = TOUR_STEPS.map((s) => s.target).filter((target) => target !== null);
    expect(new Set(targets).size).toBe(targets.length);
  });
});

describe("tourTargetForHref", () => {
  it("marks the Scout entry in the bottom bar and the Competition row in the sidebar", () => {
    expect(tourTargetForHref("/competition?tab=scouting")).toBe("scouting");
    expect(tourTargetForHref("/competition")).toBe("scouting");
  });

  it("marks Team, and nothing else", () => {
    expect(tourTargetForHref("/team")).toBe("team-work");
    expect(tourTargetForHref("/team?tab=messages")).toBeUndefined();
    expect(tourTargetForHref("/competition?tab=strategy")).toBeUndefined();
    expect(tourTargetForHref("/competition?tab=teams")).toBeUndefined();
    expect(tourTargetForHref("/dashboard")).toBeUndefined();
    expect(tourTargetForHref("/build")).toBeUndefined();
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

  it("keeps the welcome even when the page has none of the targets", () => {
    expect(availableSteps(TOUR_STEPS, () => false).map((s) => s.id)).toEqual(["welcome"]);
  });

  it("drops the event step on a team with no active event, and the tour still runs", () => {
    const steps = availableSteps(TOUR_STEPS, (target) => target !== "event");
    expect(steps.map((s) => s.id)).not.toContain("event");
    expect(tourIsWorthShowing(steps)).toBe(true);
  });
});

describe("tourIsWorthShowing", () => {
  it("needs at least two things to point at; a welcome and one stop is not a tour", () => {
    expect(tourIsWorthShowing([])).toBe(false);
    expect(tourIsWorthShowing(availableSteps(TOUR_STEPS, () => false))).toBe(false);
    expect(tourIsWorthShowing(availableSteps(TOUR_STEPS, (target) => target === "menu"))).toBe(false);
    expect(tourIsWorthShowing(availableSteps(TOUR_STEPS, (target) => target === "menu" || target === "feedback"))).toBe(true);
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

  it("puts the card above the feedback button in the bottom-right corner, fully on screen", () => {
    const fab = { top: 740, left: 1140, width: 44, height: 44 };
    const placed = placeCard({ target: fab, card: CARD, viewport: VIEWPORT, prefer: "top" });
    expect(placed.side).toBe("top");
    expect(placed.top + CARD.height).toBeLessThanOrEqual(fab.top);
    expect(placed.left + CARD.width).toBeLessThanOrEqual(VIEWPORT.width);
  });

  describe("a step with no target", () => {
    it("centres the card in the viewport", () => {
      const placed = placeCard({ target: null, card: CARD, viewport: VIEWPORT });
      expect(placed.side).toBe("center");
      expect(placed.left).toBe((VIEWPORT.width - CARD.width) / 2);
      expect(placed.top).toBe((VIEWPORT.height - CARD.height) / 2);
    });

    it("stays on screen on a small phone", () => {
      const phone = { width: 320, height: 480 };
      const placed = placeCard({ target: null, card: { width: 288, height: 220 }, viewport: phone });
      expect(placed.left).toBeGreaterThanOrEqual(CARD_GAP);
      expect(placed.left + 288).toBeLessThanOrEqual(phone.width);
      expect(placed.top).toBeGreaterThanOrEqual(CARD_GAP);
      expect(placed.top + 220).toBeLessThanOrEqual(phone.height);
    });

    it("ignores a preferred side, since there is nothing to be beside", () => {
      expect(placeCard({ target: null, card: CARD, viewport: VIEWPORT, prefer: "left" }).side).toBe("center");
    });
  });
});

describe("stepProgress", () => {
  it("counts from one, so nobody wonders how much longer this goes on", () => {
    expect(stepProgress(0, 5)).toBe("Step 1 of 5");
    expect(stepProgress(4, 5)).toBe("Step 5 of 5");
  });
});

describe("who the tour is for", () => {
  const now = Date.UTC(2026, 9, 5, 12);

  it("runs for an account in its first two weeks", () => {
    expect(tourIsForNewMember("2026-10-05 08:00:00.123456+00", now)).toBe(true);
    expect(tourIsForNewMember("2026-09-25T00:00:00Z", now)).toBe(true);
  });

  it("never replays for someone who has been here a while, whatever the browser remembers", () => {
    expect(tourIsForNewMember("2026-09-01 00:00:00+00", now)).toBe(false);
    expect(tourIsForNewMember("2026-07-15 00:00:00+00", now)).toBe(false);
  });

  it("waits when the account's age is unknown", () => {
    for (const value of [null, undefined, "", "soon", "10/05/2026"]) {
      expect(tourIsForNewMember(value, now), String(value)).toBe(false);
    }
  });
});

describe("where the tour waits", () => {
  it("stays off guided flows and runs in the app", async () => {
    const { tourBlockedOn } = await import("../../components/app-tour");
    expect(tourBlockedOn("/onboarding")).toBe(true);
    expect(tourBlockedOn("/invite")).toBe(true);
    expect(tourBlockedOn("/join-team")).toBe(true);
    expect(tourBlockedOn("/dashboard")).toBe(false);
    expect(tourBlockedOn("/invite-codes")).toBe(false);
  });
});
