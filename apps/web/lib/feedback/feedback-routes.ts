import { pathnameIsEntryScreen, pathnameUsesAppShell } from "../nav/product-route";

/**
 * Where the corner feedback button stays out of the way.
 *
 * The button is fixed to the bottom-right corner. On a page where the person is doing one thing
 * with a thumb (entering a match, weighing a robot, signing in to the pit) a corner button is
 * something to mis-tap, and it covers the Save and Next controls that live in that corner. The
 * list is here, in one place, so the rule is easy to read and to test.
 *
 * Pages outside the app frame (marketing, public forms, sign-in, the TV boards) never mount the
 * button at all; `pathnameUsesAppShell` and `pathnameIsEntryScreen` already say which those are,
 * so they are asked first and the list below only adds what the frame cannot say for itself.
 */
export const FEEDBACK_BUTTON_HIDDEN_ROUTES: ReadonlyArray<{ prefix: string; why: string }> = [
  {
    prefix: "/scout",
    why: "The Scouting app: Quick scout, pit scouting, match entry. One-handed task screens with Save in that corner.",
  },
  {
    prefix: "/hours/kiosk",
    why: "The hours kiosk is a shared sign-in screen that stays up; it is not a place to send feedback from.",
  },
  {
    prefix: "/display",
    why: "Pit, stage and kiosk boards are shown on a TV or a wall display; nobody is signed in to tap.",
  },
  { prefix: "/onboarding", why: "First-run setup is its own guided flow." },
  { prefix: "/claim", why: "Claiming a team is a guided flow of its own." },
  { prefix: "/desktop-link", why: "Linking the desktop app is a guided flow of its own." },
  { prefix: "/showcase/present", why: "Presentation mode is shown to an audience." },
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The route that hides the button, or null when the button may show. For the test and the docs. */
export function feedbackButtonHiddenBy(pathname: string | null | undefined): string | null {
  const path = (pathname ?? "").replace(/\/+$/, "") || "/";
  // The named task screens first, so the answer for a Quick scout page is "/scout" and not the
  // more general "outside the app frame" (it is both; the first is the reason someone will look for).
  const hit = FEEDBACK_BUTTON_HIDDEN_ROUTES.find(({ prefix }) => matchesPrefix(path, prefix));
  if (hit) return hit.prefix;
  if (pathnameIsEntryScreen(path)) return "sign-in and entry screens";
  if (!pathnameUsesAppShell(path)) return "outside the app frame";
  return null;
}

/** True where the corner button may appear (it still needs a signed-in person and the app frame). */
export function feedbackButtonAllowedOn(pathname: string | null | undefined): boolean {
  return feedbackButtonHiddenBy(pathname) === null;
}
