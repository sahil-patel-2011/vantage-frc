"use client";

import { useState } from "react";
import { MarketingInvitedNote } from "./site-header";
import { WaitlistForm, type WaitlistStage } from "./waitlist-form";

const HEADING: Record<WaitlistStage, { title: string; body: string }> = {
  setup: {
    title: "Join the waitlist.",
    body: "We set teams up one at a time and email you when yours is ready. Joining does not create an account.",
  },
  member: {
    title: "Already on a team?",
    body: "You don't need the waitlist. Your team's owner or a mentor invites your email, and the invite is all you need.",
  },
  joined: {
    title: "Thanks for joining.",
    body: "Your team is in line. Nothing else to do until our email arrives.",
  },
};

/**
 * The homepage waitlist section. Its heading follows the form: "Join the waitlist" sat next
 * to "My team already uses Vantage — no waitlist", and still asked people to join after they had.
 */
export function WaitlistSection() {
  const [stage, setStage] = useState<WaitlistStage>("setup");
  const copy = HEADING[stage];
  return (
    <section className="lux-waitlist" id="waitlist">
      <div>
        <p className="lux-eyebrow">Closed membership</p>
        {/* Once joined, the card's "You're on the list." is the one headline; this said "Thanks for
            joining." above it. */}
        {stage === "joined" ? <h2 className="sr-only">Waitlist</h2> : <h2>{copy.title}</h2>}
        {stage === "joined" ? null : <p>{copy.body}</p>}
        {stage === "joined" ? null : <MarketingInvitedNote />}
      </div>
      <WaitlistForm idPrefix="hero" onStageChange={setStage} />
    </section>
  );
}
