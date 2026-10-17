"use client";

import { Button } from "../../../components/ui";
import type { WidgetPayload } from "../../../lib/dashboard/snapshot";
import { hubHref } from "../../../lib/nav/hubs";

/**
 * Predict, always on Home. With a next match on the schedule the Next match card carries
 * "Predict this match"; this card covers every other moment: before the schedule is out, between
 * events, after quals while alliances are picked, and in playoffs before TBA posts the bracket.
 * Predict reads the event's schedule from the shared reference tables and the team's alliance
 * board, so nobody types six team numbers on a phone.
 */
export function HomePredictCard({
  orgId,
  nextMatch,
  canSetEvent,
}: {
  orgId: string;
  nextMatch: WidgetPayload | undefined;
  /** Leads can pick the event; everyone else is told who can. */
  canSetEvent: boolean;
}) {
  if (!nextMatch || nextMatch.status === "live") return null;
  const predictHref = `/match-sim?orgId=${encodeURIComponent(orgId)}`;
  const noEvent = nextMatch.status === "setup_required" && nextMatch.data?.missing === "event";
  // Why there is no next match is the Next match card's to say; repeating it here put the same
  // sentence on Home twice.
  return (
    <section className="dash-predict" aria-label="Predict a match" data-testid="home-predict">
      <div className="dash-predict-copy">
        <h2>Predict a match</h2>
        <p>
          {noEvent
            ? canSetEvent
              ? "Set your event to pick from its schedule. You can still predict any six robots."
              : "No event is set yet (a team lead sets it). You can still predict any six robots."
            : "Pick any match on the schedule, two playoff alliances, or any six robots."}
        </p>
      </div>
      <div className="dash-predict-actions">
        <Button as="a" variant="secondary" href={predictHref}>
          Predict a match
        </Button>
        {noEvent ? (
          canSetEvent ? <a href={hubHref("/competition", "command", orgId)}>Set active event</a> : null
        ) : (
          <a href={`${predictHref}#playoff-alliances`}>Playoff alliances</a>
        )}
      </div>
    </section>
  );
}
