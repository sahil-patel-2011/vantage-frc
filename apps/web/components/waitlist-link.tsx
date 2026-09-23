import type { ReactNode } from "react";

export const WAITLIST_PHRASE = "join the waitlist";

/** The setup sentence offers the waitlist (only sent when no team is open). */
export function mentionsWaitlist(text: string): boolean {
  return text.toLowerCase().includes(WAITLIST_PHRASE);
}

/**
 * The no-team sentence ("Choose your team to …, or join the waitlist.") names
 * the waitlist in the same words as the link, so the words become the link.
 * Text without the phrase comes back unchanged.
 */
export function withWaitlistLink(text: string): ReactNode {
  const at = text.toLowerCase().indexOf(WAITLIST_PHRASE);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <a href="/#waitlist">{text.slice(at, at + WAITLIST_PHRASE.length)}</a>
      {text.slice(at + WAITLIST_PHRASE.length)}
    </>
  );
}
