"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import {
  DISPLAY_PHASE_LABELS,
  displayPhase,
  formatAlliance,
  matchLabel,
  stageRotation,
  type DisplayStagePayload,
  type DisplayStageScreen,
} from "../../lib/display";
import { kioskSides } from "../../lib/display/kiosk-view";

const SCREEN_WORDS: Record<DisplayStageScreen, string> = {
  schedule: "our schedule",
  pit_map: "pit map",
  queue: "queue",
  next_match: "next match",
  rankings: "rankings",
  alliance_selection: "alliance selection",
  bracket: "playoff bracket",
  results: "results",
  thanks: "sponsor thanks",
};

/** "in 9 min" / "in 1 h 5 min" / "now", or null without a posted time. */
function untilLabel(value: string | null, now: number): string | null {
  if (!value) return null;
  const at = new Date(value).getTime();
  if (!Number.isFinite(at)) return null;
  const minutes = Math.round((at - now) / 60_000);
  if (minutes <= 0) return "now";
  if (minutes < 60) return `in ${minutes} min`;
  return `in ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * A small, live copy of what the event board is showing right now, from the same feed the TV
 * reads. The real board cannot be framed into this page (the app refuses to be framed), so this
 * draws the part that matters from across the pit: the phase, the next match and our colour.
 */
function EventBoardPreview({ orgId, boardId }: { orgId: string; boardId: string }) {
  const [data, setData] = useState<DisplayStagePayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    const load = () =>
      fetch(`/api/display/stage?orgId=${encodeURIComponent(orgId)}&boardId=${encodeURIComponent(boardId)}`, { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : Promise.reject(new Error("stage"))))
        .then((body: DisplayStagePayload) => {
          if (!active) return;
          setData(body);
          setFailed(false);
          setNow(Date.now());
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void load();
    }, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [orgId, boardId]);

  if (!data) {
    return (
      <div className="ebp is-loading" aria-busy={!failed}>
        <p>{failed ? "Couldn't load the preview. Open the board to see it." : "Loading the live preview…"}</p>
      </div>
    );
  }

  const phase = displayPhase({ progress: data.progress ?? null });
  const rotation = stageRotation(phase, {
    schedule: data.schedule ?? [],
    rankings: data.rankings ?? [],
    playoffMatches: data.playoffMatches ?? [],
    sponsors: data.sponsors ?? [],
    nexus: data.nexus ?? null,
    eventStatus: data.eventStatus ?? null,
  });
  const next = data.schedule?.[0] ?? null;
  const sides = next ? kioskSides(next, data.organization.teamNumber) : null;
  const ours = (data.rankings ?? []).find((row) => row.teamKey === `frc${data.organization.teamNumber}`);

  return (
    <div className="ebp" aria-label="Live preview of the event board">
      <div className="ebp-head">
        <span>{DISPLAY_PHASE_LABELS[phase]}</span>
        <span>{data.activeEvent?.name ?? "No event set"}</span>
      </div>
      {next && sides ? (
        <div className="ebp-body">
          <strong className="ebp-big">
            {matchLabel(next.compLevel, next.matchNumber)}
            {untilLabel(next.scheduledTime, now) ? <small> {untilLabel(next.scheduledTime, now)}</small> : null}
          </strong>
          {sides.ourColor ? <p className={`ebp-band is-${sides.ourColor}`}>WE ARE {sides.ourColor.toUpperCase()}</p> : null}
          <p className="ebp-line">
            {sides.ourColor
              ? `With ${sides.partners.join(" · ") || "—"}  vs  ${sides.opponents.join(" · ") || "—"}`
              : `Red ${formatAlliance(next.redAlliance?.teamKeys)} · Blue ${formatAlliance(next.blueAlliance?.teamKeys)}`}
          </p>
        </div>
      ) : (
        <div className="ebp-body">
          <strong className="ebp-big">
            {phase === "alliance_selection" ? "Alliance selection" : rotation.length ? "No match ahead" : "Nothing synced yet"}
          </strong>
          <p className="ebp-line">
            {ours?.rank != null
              ? `We're ranked ${ours.rank}`
              : rotation.length
                ? "Our next match shows here once it is on the schedule."
                : "The board fills in on its own once the event schedule syncs."}
          </p>
        </div>
      )}
      <p className="ebp-foot">
        {/* The stage holds the next match on screen once ours is within 30 minutes; saying it
            "rotates" then promised a change the TV never made. */}
        {rotation.length
          ? rotation.length > 1 && rotation.includes("next_match")
            ? `Shows ${rotation.map((screen) => SCREEN_WORDS[screen]).join(", then ")}; stays on the next match from 30 minutes before it`
            : `Shows ${rotation.map((screen) => SCREEN_WORDS[screen]).join(", then ")}`
          : "Shows a screen only when there is real data for it"}
      </p>
    </div>
  );
}

/**
 * The recommended pit screen, first on the page: it follows the event on its own (next match
 * with bumper colour and who we play, the queue, rankings, then alliance selection and the
 * bracket), so most teams never need to build a board. It is shown through any saved board,
 * since it ignores the board's panels; a team with none gets one made in a click.
 */
export function EventBoardCard({
  orgId,
  boardId,
  canSync,
  busy,
  onCreate,
  onGetTvLink,
}: {
  orgId: string;
  boardId: string | null;
  canSync: boolean;
  busy: boolean;
  onCreate: () => void;
  onGetTvLink: (boardId: string) => void;
}) {
  const fullscreen = boardId
    ? `/display/stage?orgId=${encodeURIComponent(orgId)}&boardId=${encodeURIComponent(boardId)}`
    : null;
  return (
    <section className="event-board-card soft-panel" aria-labelledby="event-board-title">
      <div className="event-board-copy">
        <span className="event-board-badge">Recommended</span>
        <h2 id="event-board-title">Event board</h2>
        <p>
          Follows the event on its own: our next match with bumper colour and who we play, the queue, rankings, then
          alliance selection and the bracket. Nothing to set up.
        </p>
        <div className="display-actions">
          {fullscreen ? (
            <>
              <Button as="a" variant="primary" href={fullscreen} target="_blank" rel="noreferrer">
                Open the board
              </Button>
              {canSync ? (
                <Button variant="secondary" type="button" onClick={() => onGetTvLink(boardId!)}>
                  Get a TV link
                </Button>
              ) : null}
            </>
          ) : canSync ? (
            <Button variant="primary" type="button" disabled={busy} onClick={onCreate}>
              {busy ? "Setting up…" : "Turn on the event board"}
            </Button>
          ) : (
            <p className="app-muted">An owner or admin turns the event board on once. Then anyone can open it here.</p>
          )}
        </div>
      </div>
      {boardId ? (
        <EventBoardPreview orgId={orgId} boardId={boardId} />
      ) : (
        <div className="ebp is-loading">
          <p>The live preview appears here once the event board is on.</p>
        </div>
      )}
    </section>
  );
}
