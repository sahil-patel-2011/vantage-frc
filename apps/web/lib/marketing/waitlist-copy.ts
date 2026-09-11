/** Public waitlist copy. Safe for the client bundle — no database imports. */

export function waitlistUnavailableCopy(): { title: string; body: string } {
  return {
    title: "Waitlist isn't taking names right now.",
    body: "Email sahiljpatel2011@gmail.com and we'll add you when it's ready. Joining the waitlist does not create an account.",
  };
}

export function waitlistUnavailableMessage(): string {
  return waitlistUnavailableCopy().body;
}
