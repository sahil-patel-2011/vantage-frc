import { isKnownAppPath } from "./app-route-roots";
import { pathnameUsesAppShell } from "./product-route";

/**
 * The classes on <body> that say which frame a route is drawn in.
 *
 * Every `body.has-app-shell …` rule (product palette, the top bar's reserved height, the bottom
 * bar's padding) keys off these. AppShell used to add them in an effect, which runs after the
 * first paint: until hydration the page was drawn in the public palette with its heading under the
 * top bar, then jumped 52px. They are worked out from the path alone, so the server HTML can carry
 * them and the first paint is already the finished frame.
 */
export const SHELL_BODY_CLASSES = ["has-app-shell", "shell-bare", "shell-onboarding"] as const;

export type ShellBodyClass = (typeof SHELL_BODY_CLASSES)[number];

/**
 * The invite landing, join-by-code, "can't open this" and the 404 keep the product's styles but
 * not its chrome: the person there usually has no account yet, or took a wrong turn.
 */
export function pathnameIsBareShell(pathname: string): boolean {
  return (
    pathname === "/invite" ||
    pathname === "/join-team" ||
    pathname === "/access-unavailable" ||
    !isKnownAppPath(pathname)
  );
}

export function shellBodyClasses(pathname: string): ShellBodyClass[] {
  if (!pathnameUsesAppShell(pathname)) return [];
  const classes: ShellBodyClass[] = ["has-app-shell"];
  if (pathnameIsBareShell(pathname)) classes.push("shell-bare");
  if (pathname === "/onboarding") classes.push("shell-onboarding");
  return classes;
}
