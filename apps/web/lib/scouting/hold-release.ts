/** A press shorter than this is a tap: it locks the action on until the next tap. */
export const HOLD_TAP_MS = 320;

/**
 * What ending a press on a hold-to-record button does to the action.
 *
 * - A finger lifted after a hold stops it (it ran for as long as the finger was down).
 * - A tap on a running action stops it; a tap on a stopped one leaves it locked on.
 * - A press the browser cancelled (the touch turned into a scroll) never stops it: the scout
 *   did not let go, so the action stays on until their next tap. Treating cancel as "let go"
 *   cut a held 6-second shot short with no sign on screen.
 */
export function holdReleaseStops(input: { how: "up" | "cancel"; startedHere: boolean; heldMs: number }): boolean {
  if (input.how === "cancel") return false;
  return !input.startedHere || input.heldMs >= HOLD_TAP_MS;
}
