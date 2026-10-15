/**
 * The short guided tour a student sees once, the first time they land on Home, and again
 * whenever they ask ("Take the tour again" in the account menu and on the Help page).
 *
 * It is a tour, not onboarding: it says what Vantage is for, then points at the parts of the
 * app a new person will use, and ends at the feedback button. It never asks for input, never
 * blocks, and can be left at any point.
 *
 * Steps target elements by `data-tour`, so a step whose element is not on the
 * page — a control that needs a team, a widget nobody added — is dropped rather
 * than pointing the spotlight at nothing. A step with no target is a centred card.
 */

export type TourStep = {
  id: string;
  /**
   * Value of the `data-tour` attribute this step points at, or null for a centred card with
   * nothing highlighted (the welcome).
   */
  target: string | null;
  title: string;
  body: string;
  /** Preferred side; flips automatically when there is no room. */
  prefer?: "top" | "bottom" | "left" | "right";
};

export const TOUR_VERSION = 1;
export const TOUR_STORAGE_KEY = `vantage.tour.v${TOUR_VERSION}`;

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: "welcome",
    target: null,
    title: "Welcome to Vantage",
    body: "This is where your robotics team scouts, plans and builds together. Here's a quick look around, about a minute long.",
  },
  {
    id: "event",
    target: "event",
    title: "Your event",
    body: "Pick the competition you're headed to. Schedules, scouting and match predictions all follow it.",
    prefer: "bottom",
  },
  {
    id: "scouting",
    target: "scouting",
    title: "Scouting",
    body: "Scouts write down what every robot does in a match. Your team uses it to plan strategy and pick alliance partners.",
    // Beside the sidebar on a computer; above the bottom bar on a phone, where "right" has no room.
    prefer: "right",
  },
  {
    id: "team-work",
    target: "team-work",
    title: "Your team",
    body: "Calendar, tasks, chat and your teammates all live under Team, so everyone knows who is doing what.",
    prefer: "right",
  },
  {
    id: "menu",
    target: "menu",
    title: "Search and menu",
    body: "Tap here to find any page, tool or team record fast.",
    prefer: "bottom",
  },
  {
    id: "ask-ai",
    target: "ask-ai",
    title: "Ask AI",
    body: "Ask about strategy, match predictions or design. It answers from your team's own records and says when it doesn't know.",
    prefer: "right",
  },
  {
    id: "customise",
    target: "customise",
    title: "Make Home yours",
    body: "Add, move or remove cards so Home shows what you need most.",
    prefer: "left",
  },
  {
    id: "feedback",
    target: "feedback",
    title: "Tell us anything",
    body: "Found a bug or have an idea? Open Help, then Send feedback.",
    prefer: "top",
  },
] as const;

/**
 * Which `data-tour` name a navigation link carries, so the shell does not decide it twice.
 * The sidebar lists hubs ("/competition", "/team"); the bottom bar lists the four apps a person
 * picked ("/competition?tab=scouting"). Scouting is the Competition hub's front door, so both
 * point there. Anything else is not a tour stop.
 */
export function tourTargetForHref(href: string): string | undefined {
  const [path, query = ""] = href.split("?");
  const tab = new URLSearchParams(query).get("tab");
  if (path === "/competition" && (!tab || tab === "scouting")) return "scouting";
  if (path === "/team" && !tab) return "team-work";
  return undefined;
}

/**
 * Home is ready for the tour once this target is on the page: the cards load after the shell,
 * and starting before they do drops the steps that point at them.
 */
export const TOUR_HOME_READY_TARGET = "customise";

/**
 * How long after an account is created the tour is still offered.
 *
 * "Shown once" was kept in the browser, so every new browser, the desktop app and
 * the Scouting address each showed it again to someone who had been here for months.
 * The account's own age needs no storage and travels with the person: past the first
 * two weeks nobody is new, on any device.
 */
export const TOUR_NEW_MEMBER_DAYS = 14;

/**
 * True while the account is new enough for a first-run tour. An unknown or unreadable
 * date is "no" — the tour can wait for a load that knows who this is.
 */
export function tourIsForNewMember(memberSince: string | null | undefined, now: number = Date.now()): boolean {
  // Postgres sends "2026-07-20 03:12:45.123+00", which not every browser's Date parses.
  // The day is all a two-week window needs.
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(memberSince ?? "");
  if (!match) return false;
  const joined = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const ageDays = (now - joined) / 86_400_000;
  return ageDays >= -1 && ageDays <= TOUR_NEW_MEMBER_DAYS;
}

/** Steps whose target is present, in order. Absent targets are skipped; a centred card always stays. */
export function availableSteps(
  steps: readonly TourStep[],
  present: (target: string) => boolean,
): TourStep[] {
  return steps.filter((step) => step.target === null || present(step.target));
}

/**
 * Whether what is left is worth interrupting someone for. A welcome card and nothing to point at
 * is not a tour; two stops on the page is the least that is.
 */
export function tourIsWorthShowing(steps: readonly TourStep[]): boolean {
  return steps.filter((step) => step.target !== null).length >= 2;
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
export type Placement = { top: number; left: number; side: "top" | "bottom" | "left" | "right" | "center" };

export const CARD_GAP = 12;

/**
 * Where to put the tour card so it points at the target and stays on screen.
 *
 * Tries the preferred side, falls back to the side with the most room, then
 * clamps into the viewport. Clamping last matters: a card pinned to an edge is
 * readable, a card half off-screen is not, and on a phone in the stands the
 * preferred side often does not fit at all. A step with no target is centred.
 */
export function placeCard(input: {
  /** What the card points at; null (a step with no target) centres it in the viewport. */
  target: Rect | null;
  card: { width: number; height: number };
  viewport: { width: number; height: number };
  prefer?: TourStep["prefer"];
  gap?: number;
}): Placement {
  const gap = input.gap ?? CARD_GAP;
  const { target, card, viewport } = input;

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, max));

  if (!target) {
    return {
      side: "center",
      top: clamp((viewport.height - card.height) / 2, gap, Math.max(gap, viewport.height - card.height - gap)),
      left: clamp((viewport.width - card.width) / 2, gap, Math.max(gap, viewport.width - card.width - gap)),
    };
  }

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
