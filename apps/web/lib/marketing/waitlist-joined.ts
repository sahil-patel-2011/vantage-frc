/**
 * "This browser joined the waitlist with this email", kept on the device only.
 *
 * Someone who joined and then tried to sign in was told to join the waitlist again. The server
 * never says whether an address is waitlisted (that would tell anyone who is waiting), so the
 * sign-in screen asks this browser instead: it knows only what was typed into it.
 */
const KEY = "vantage.waitlist.joined";

export type WaitlistJoined = { email: string; team: string };

export function rememberWaitlistJoined(joined: WaitlistJoined): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ email: joined.email.trim().toLowerCase(), team: joined.team.trim() }));
  } catch {
    // Private mode: the sign-in screen falls back to its general copy.
  }
}

export function waitlistJoinedFor(email: string): WaitlistJoined | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<WaitlistJoined>) : null;
    if (!parsed?.email || parsed.email !== email.trim().toLowerCase()) return null;
    return { email: parsed.email, team: typeof parsed.team === "string" ? parsed.team : "" };
  } catch {
    return null;
  }
}
