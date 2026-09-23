/**
 * The short guided tour a student sees once, the first time they land on Home.
 *
 * It is a tour, not onboarding: it points at things that already exist and
 * explains what they are for. It never asks for input, never blocks, and can be
 * left at any point.
 *
 * Steps target elements by `data-tour`, so a step whose element is not on the
 * page — a control that needs a team, a widget nobody added — is dropped rather
 * than pointing the spotlight at nothing.
 */

export type TourStep = {
  id: string;
  /** Value of the `data-tour` attribute this step points at. */
  target: string;
  title: string;
  body: string;
  /** Preferred side; flips automatically when there is no room. */
  prefer?: "top" | "bottom" | "left" | "right";
};

export const TOUR_VERSION = 1;
export const TOUR_STORAGE_KEY = `vantage.tour.v${TOUR_VERSION}`;

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "menu",
    target: "menu",
    title: "Find any page",
    body: "Search opens every page. Ctrl or ⌘ + K does the same from anywhere.",
    prefer: "bottom",
  },
  {
    id: "island",
    target: "island",
    title: "Your shortcuts",
    body: "These are the apps you pinned. Edit apps, or the gear on the phone bar, changes them.",
    prefer: "top",
  },
  {
    id: "ask-ai",
    target: "ask-ai",
    title: "Ask about your own data",
    body: "Strategy, match predictions, design help. It answers from your team's records and says when it does not know.",
    prefer: "bottom",
  },
  {
    id: "event",
    target: "event",
    title: "Your active event",
    body: "Schedule, scouting and predictions all follow this. Tap it to open event day.",
    prefer: "bottom",
  },
  {
    id: "customise",
    target: "customise",
    title: "Make this page yours",
    body: "Add, move or remove cards so Home shows what your job actually needs.",
    prefer: "left",
  },
] as const;

/** Steps whose target is present, in order. Absent targets are skipped. */
export function availableSteps(
  steps: readonly TourStep[],
  present: (target: string) => boolean,
): TourStep[] {
  return steps.filter((step) => present(step.target));
}

/** Accessible name on the tour dialog. Anything else with role=dialog is real work. */
export const TOUR_DIALOG_LABEL = "Tour of Vantage";

/**
 * The tour's scrim covers the page. A form the person already opened — set
 * active event, invite someone — has to stay clickable, so the tour waits.
 */
export function tourShouldYield(openDialogLabels: readonly (string | null)[]): boolean {
  return openDialogLabels.some((label) => label !== TOUR_DIALOG_LABEL);
}

export type Rect = { top: number; left: number; width: number; height: number };
export type Placement = { top: number; left: number; side: "top" | "bottom" | "left" | "right" };

export const CARD_GAP = 12;

/**
 * Where to put the tour card so it points at the target and stays on screen.
 *
 * Tries the preferred side, falls back to the side with the most room, then
 * clamps into the viewport. Clamping last matters: a card pinned to an edge is
 * readable, a card half off-screen is not, and on a phone in the stands the
 * preferred side often does not fit at all.
 */
export function placeCard(input: {
  target: Rect;
  card: { width: number; height: number };
  viewport: { width: number; height: number };
  prefer?: TourStep["prefer"];
  gap?: number;
}): Placement {
  const gap = input.gap ?? CARD_GAP;
  const { target, card, viewport } = input;

  const room = {
    top: target.top,
    bottom: viewport.height - (target.top + target.height),
    left: target.left,
    right: viewport.width - (target.left + target.width),
  };
  const needsVertical = card.height + gap;
  const needsHorizontal = card.width + gap;

  const fits = (side: "top" | "bottom" | "left" | "right") =>
    side === "top" || side === "bottom"
      ? room[side] >= needsVertical
      : room[side] >= needsHorizontal;

  const order: Array<"top" | "bottom" | "left" | "right"> = ["bottom", "top", "right", "left"];
  let side = input.prefer && fits(input.prefer) ? input.prefer : order.find(fits);
  if (!side) {
    // Nothing fits — take the roomiest side and let the clamp do the rest.
    side = (Object.keys(room) as Array<keyof typeof room>).reduce((best, key) =>
      room[key] > room[best] ? key : best,
    );
  }

  let top: number;
  let left: number;
  if (side === "bottom") {
    top = target.top + target.height + gap;
    left = target.left + target.width / 2 - card.width / 2;
  } else if (side === "top") {
    top = target.top - card.height - gap;
    left = target.left + target.width / 2 - card.width / 2;
  } else if (side === "right") {
    top = target.top + target.height / 2 - card.height / 2;
    left = target.left + target.width + gap;
  } else {
    top = target.top + target.height / 2 - card.height / 2;
    left = target.left - card.width - gap;
  }

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, max));
  return {
    side,
    top: clamp(top, gap, Math.max(gap, viewport.height - card.height - gap)),
    left: clamp(left, gap, Math.max(gap, viewport.width - card.width - gap)),
  };
}

/** "Step 2 of 5" — so nobody wonders how much longer this goes on. */
export function stepProgress(index: number, total: number): string {
  return `Step ${index + 1} of ${total}`;
}
