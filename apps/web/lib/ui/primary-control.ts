/**
 * R4: exactly one primary control per screen (zero is fine, two is a bug).
 *
 * `.is-primary` is the canonical class (Button variant="primary" adds it).
 * `.app-button.primary` and `.primary-action` are the legacy names still in
 * the wild — they count as the same thing so a screen cannot sneak a second
 * primary by using the old class.
 */
export const PRIMARY_CONTROL_SELECTOR = [
  ".is-primary",
  ".app-button.primary",
  ".primary-action",
  "[data-primary-action='true']",
].join(", ");

export function isPrimaryControl(className: string | null | undefined): boolean {
  if (!className) return false;
  const tokens = className.split(/\s+/);
  return (
    tokens.includes("is-primary") ||
    (tokens.includes("app-button") && tokens.includes("primary")) ||
    tokens.includes("primary-action")
  );
}
