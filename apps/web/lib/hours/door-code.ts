import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The QR code on the shop door. Members scan it with their phone to check in or out; it is only
 * good at the door because it changes every minute and is signed by the server, so a photo of
 * yesterday's code (or one texted home) doesn't work. No table: the code is the team id, the
 * minute and a signature over both.
 */

/** Each code is good for this long, plus one window of grace for a slow scan. */
export const DOOR_WINDOW_MS = 60_000;

function sign(secret: string, orgId: string, window: number): string {
  return createHmac("sha256", secret).update(`door-checkin:${orgId}:${window}`).digest("base64url").slice(0, 24);
}

export function doorWindow(now: number): number {
  return Math.floor(now / DOOR_WINDOW_MS);
}

export function doorCode(secret: string, orgId: string, now: number): { window: number; sig: string; expiresAt: number } {
  const window = doorWindow(now);
  return { window, sig: sign(secret, orgId, window), expiresAt: (window + 1) * DOOR_WINDOW_MS };
}

/** True for this minute's code or the last minute's (a scan started just before the change). */
export function verifyDoorCode(secret: string, orgId: string, window: number, sig: string, now: number): boolean {
  if (!Number.isInteger(window) || typeof sig !== "string" || sig.length !== 24) return false;
  const current = doorWindow(now);
  if (window !== current && window !== current - 1) return false;
  const expected = Buffer.from(sign(secret, orgId, window));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** The address the QR holds: opening it on a signed-in phone checks that person in or out. */
export function doorCheckinPath(orgId: string, code: { window: number; sig: string }): string {
  return `/hours/checkin?${new URLSearchParams({ orgId, w: String(code.window), s: code.sig })}`;
}
