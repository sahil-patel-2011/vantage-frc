"use client";
// Nexus queue countdown, announcement feed, and parts-request board for Event Day.
//
// Renders ONLY when the org has an active event and a Nexus API key is configured.
// Without a key it renders nothing at all so the page's existing setup guidance
// stays the single instruction. With a key but no cached payload it says so —
// it never draws a countdown Nexus has not posted.

import { useEffect, useState } from "react";
import { NEXUS_QUEUE_STAGES, type NexusQueueStage } from "@vantage/reference";
import { hasNexusQueueSignal, nexusQueueCountdown } from "./nexus-queue";
import type { CommandNexus } from "./types";
import "./nexus-queue-panel.css";

function stageState(stage: NexusQueueStage, entry: NexusQueueStage): "done" | "current" | "todo" {
  const order = NEXUS_QUEUE_STAGES.map((item) => item.stage);
  const current = order.indexOf(stage);
  const index = order.indexOf(entry);
  if (current < 0) return "todo";
  if (index < current) return "done";
  return index === current ? "current" : "todo";
}

function clockLabel(ms: number | null): string | null {
  if (ms === null) return null;
  const date = new Date(ms);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function NexusQueuePanel({
  nexus,
  eventKey,
}: {
  nexus: CommandNexus | null;
  eventKey: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(tick);
  }, []);

  // No event, or Nexus is not set up: the page's own setup guidance covers it.
  if (!eventKey || !nexus?.configured) return null;

  const queue = nexus.queue;
  if (!queue || !hasNexusQueueSignal(queue)) {
    return (
      <section className="nq-panel" aria-label="Nexus queue">
        <header className="nq-head">
          <h2>Nexus queue</h2>
          <a href={nexus.attributionHref} rel="noreferrer" target="_blank">
            frc.nexus
          </a>
        </header>
        <p className="nq-empty">
          Nexus has not posted a queue, announcement, or parts request for {eventKey} yet. Nothing is
          shown until it does.
        </p>
      </section>
    );
  }

  const countdown = nexusQueueCountdown(queue, now);
  const upNext = queue.ourMatches.slice(1);
  const queueAt = clockLabel(countdown.match?.estimatedQueueTime ?? null);
  const startAt = clockLabel(countdown.match?.estimatedStartTime ?? null);

  return (
    <section className={`nq-panel${countdown.urgent ? " is-urgent" : ""}`} aria-label="Nexus queue">
      <header className="nq-head">
        <h2>Nexus queue</h2>
        <a href={nexus.attributionHref} rel="noreferrer" target="_blank">
          frc.nexus
        </a>
      </header>

      {countdown.match ? (
        <div className="nq-countdown">
          <div className="nq-countdown-main">
            <span className="nq-label">{countdown.match.label ?? "Our next match"}</span>
            <strong aria-live="polite">{countdown.label}</strong>
            {countdown.cue ? <em className={`nq-cue cue-${countdown.cue.replace(/\s+/g, "-").toLowerCase()}`}>{countdown.cue}</em> : null}
            <small>
              {queueAt ? `Queue ${queueAt}` : "No queue time posted"}
              {startAt ? ` · Match ${startAt}` : ""}
            </small>
          </div>
          <ol className="nq-stages" aria-label="Queue stages">
            {NEXUS_QUEUE_STAGES.map((entry) => (
              <li key={entry.stage} className={`nq-stage ${stageState(countdown.stage, entry.stage)}`}>
                {entry.label}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <p className="nq-empty">
          Nexus has not posted a match with your team in the queue. Announcements and parts requests
          below are still live.
        </p>
      )}

      {upNext.length ? (
        <p className="nq-upnext">
          Then{" "}
          {upNext
            .map((match) => match.label ?? "an unlabelled match")
            .join(" · ")}
        </p>
      ) : null}

      {queue.announcements.length ? (
        <div className="nq-block">
          <h3>Announcements</h3>
          <ul className="nq-announcements">
            {queue.announcements.map((entry, index) => (
              <li key={entry.id ?? `${index}-${entry.message}`}>
                <span>{entry.message}</span>
                {clockLabel(entry.postedAtMs) ? <time>{clockLabel(entry.postedAtMs)}</time> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {queue.partsRequests.length ? (
        <div className="nq-block">
          <h3>Parts requests</h3>
          <ul className="nq-parts">
            {queue.partsRequests.map((request, index) => (
              <li key={request.id ?? `${index}-${request.parts}`} className={request.nearby ? "is-near" : undefined}>
                <strong>
                  {request.requestedByTeam ? `Team ${request.requestedByTeam}` : "A team"} needs{" "}
                  {request.parts}
                </strong>
                <small>
                  {request.pitAddress ? `Pit ${request.pitAddress}` : "Pit location not posted"}
                  {request.nearby && queue.ourPitAddress
                    ? ` · same row as your pit ${queue.ourPitAddress}`
                    : ""}
                </small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="nq-foot">
        Live from Nexus{nexus.syncedAt ? ` · synced ${new Date(nexus.syncedAt).toLocaleTimeString()}` : ""}
        {queue.serverNowMs ? " · countdown on the Nexus server clock" : ""}
      </p>
    </section>
  );
}
