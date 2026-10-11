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
 * The waitlist section (home and Cost). Its heading follows the form: "Join the waitlist" sat next
 * to "My team already uses Vantage — no waitlist", and still asked people to join after they had.
 */
export function WaitlistSection() {
  const [stage, setStage] = useState<WaitlistStage>("setup");
  const copy = HEADING[stage];
  const joined = stage === "joined";
  return (
    <section className="mx-section mx-rule" id="waitlist" aria-labelledby="waitlist-title">
      <div className={`mx-wrap mx-waitlist${joined ? " is-joined" : ""}`}>
        {/* Once joined, the card's "You're on the list." is the one headline, and the column beside it
            would be an empty half page: the card is the whole section then. */}
        {joined ? (
          <h2 className="mx-sr-only" id="waitlist-title">
            Waitlist
          </h2>
        ) : (
          <div className="mx-waitlist-copy">
            <p className="mx-eyebrow">Closed membership</p>
            <h2 className="mx-h2" id="waitlist-title">
              {copy.title}
            </h2>
            <p className="mx-lead">{copy.body}</p>
            <MarketingInvitedNote className="mx-invited" />
          </div>
        )}
        <WaitlistForm idPrefix="hero" onStageChange={setStage} />
      </div>
    </section>
  );
}
