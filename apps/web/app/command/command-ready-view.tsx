"use client";

import type { ReactNode } from "react";
import { Icon } from "../../components/icon";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { OfflineBanner } from "../../components/offline-banner";
import { VenueShortcutCheatsheet, type VenueShortcut } from "../../hooks/use-venue-shortcuts";
import { countdownLabel } from "../dashboard/widgets";
import type { EventDayNextAction } from "../../lib/command/event-day-actions";
import NexusQueuePanel from "../../lib/command/nexus-queue-panel";
import type { CommandSnapshot } from "../../lib/command/types";
import { formatMyDayWhen } from "../../lib/my-day";
import { hubHref } from "../../lib/nav/hubs";
import { predictionWinDisplay } from "../../lib/strategy/prediction-display";
import { plainStrategyText } from "../../lib/briefing/plain-text";
import { matchShortLabel } from "../../lib/matches/no-next-match";
import { intelTags } from "../../lib/display/match-intel";
import {
  CommandReadyHeader,
  EventDayNextActionsPanel,
} from "./command-chrome";
import { pct, teamLabel, type CommandHrefs, type Me } from "./command-model";

function AllianceChips({
  keys,
  ours,
  highlight,
}: {
  keys: string[];
  ours: string | null;
  highlight?: "red" | "blue";
}) {
  return (
    <ul className="edc-alliance">
      {keys.map((key) => (
        <li key={key} className={key === ours ? "us" : highlight ?? ""}>
          {teamLabel(key)}
        </li>
      ))}
    </ul>
  );
}

export function CommandReadyView({
  embedded,
  orgId,
  me,
  snap,
  hrefs,
  liveActions,
  next,
  after,
  countdown,
  loading,
  fromCache,
  cachedAt,
  error,
  eventMessage,
  recomputing,
  cheatOpen,
  shortcuts,
  eventPicker,
  onSelectEvent,
  onRefresh,
  onRecompute,
  onCloseCheatsheet,
}: {
  embedded: boolean;
  orgId: string;
  me: Me;
  snap: CommandSnapshot;
  hrefs: CommandHrefs;
  liveActions: EventDayNextAction[];
  next: CommandSnapshot["matches"][number] | null;
  after: CommandSnapshot["matches"][number] | null;
  countdown: string;
  loading: boolean;
  fromCache: boolean;
  cachedAt: string | null;
  error: string;
  eventMessage: string;
  recomputing: boolean;
  cheatOpen: boolean;
  shortcuts: VenueShortcut[];
  eventPicker: ReactNode;
  onSelectEvent: () => void;
  onRefresh: () => void;
  onRecompute: () => void;
  onCloseCheatsheet: () => void;
}) {
  const strategyHref = hrefs.strategy;
  const scoutingHref = hrefs.scouting;
  const matchChecklistHref = hrefs.matchChecklist;
  const pitHref = hrefs.pit;
  const batteriesHref = hrefs.batteries;
  const intelHref = hrefs.intel;
  const chemistryHref = hrefs.chemistry;
  const rankingsHref = hubHref("/competition", "rankings", orgId || null);
  // With no match coming up, every "next match" card below would be empty. Show what is
  // true now (why, the record, what to do) instead of a grid of "No …" cards.
  const quiet = !next;

  const seasonPulse = (
        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#0e5a66", ["--tone-bg" as string]: "#e2edef" }}>
                <Icon name="stats" />
              </span>
              <div>
                <h2>Season pulse</h2>
                <p>Record, rank and rating at this event</p>
              </div>
            </div>
          </header>
          {snap?.record.status === "live" ? (
            <div className="edc-pulse">
              <div>
                <strong>
                  {snap.record.wins ?? 0}-{snap.record.losses ?? 0}-{snap.record.ties ?? 0}
                </strong>
                <span>W-L-T</span>
              </div>
              <div>
                <strong>{snap.record.rank ?? "—"}</strong>
                <span>Rank</span>
              </div>
              <div>
                <strong>{snap.record.epaTotal != null ? Math.round(snap.record.epaTotal * 10) / 10 : "—"}</strong>
                <span>Rating</span>
              </div>
              <p className="edc-muted">
                {snap.record.fromResults ? "Record from this event's results" : "Record from the event data"}
                {snap.record.syncedAt ? ` · rank updated ${new Date(snap.record.syncedAt).toLocaleString()}` : ""}
              </p>
              <p className="edc-muted">
                Scout coverage: {snap.coverage.matchReports} match · {snap.coverage.pitReports} pit
                {snap.coverage.openDisagreements ? ` · ${snap.coverage.openDisagreements} open disagreements` : ""}
              </p>
            </div>
          ) : (
            <div className="dash-empty calm">
              <strong>No event metrics yet</strong>
              <p>Record and rank appear once this event's results are posted.</p>
            </div>
          )}
        </article>
  );

  return (
    <main className={`edc-page${embedded ? " is-embedded" : ""}`}>
      <CommandReadyHeader
        embedded={embedded}
        orgId={orgId || null}
        title={snap.eventName ?? "Event day"}
        orgName={snap.orgName ?? me.orgName ?? null}
        teamNumber={snap.teamNumber ?? me.teamNumber ?? null}
        eventKey={snap.eventKey ?? null}
        eventName={snap.eventName ?? null}
        loading={loading && !snap}
        computedAt={snap.computedAt ?? null}
        canSetEvent={Boolean(snap.canSetEvent)}
        onSelectEvent={onSelectEvent}
        onRefresh={onRefresh}
      />
      <OfflineBanner feature="Competition" fromCache={fromCache} cachedAt={cachedAt} />
      <VenueShortcutCheatsheet open={cheatOpen} onClose={onCloseCheatsheet} shortcuts={shortcuts} />

      {error ? <p className="edc-banner error">{error}</p> : null}
      {eventMessage ? <p className="edc-banner ok">{eventMessage}</p> : null}
      <DataSourceDegradedBanner health={snap?.dataSourceHealth} canOpenTeamData={snap.canSetEvent === true} />
      {snap?.nexus ? (
        <p className="edc-freshness" role="status">
          Nexus queue: {snap.nexus.nowQueuing ?? "none posted"}
          {snap.nexus.pitCount ? ` · ${snap.nexus.pitCount} pit addresses cached` : ""}
          {" · "}
          <a href={snap.nexus.attributionHref} rel="noreferrer" target="_blank">
            frc.nexus
          </a>
        </p>
      ) : null}

      <NexusQueuePanel nexus={snap?.nexus ?? null} eventKey={snap?.eventKey ?? null} />

      <EventDayNextActionsPanel actions={liveActions} />

      <section className={`edc-priority${quiet ? " is-quiet" : ""}`} aria-label="Priority panels">
        <article className={`edc-card edc-next ${next ? "live" : "empty"}`}>
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#0e5a66", ["--tone-bg" as string]: "#e2edef" }}>
                <Icon name="swords" />
              </span>
              <div>
                <h2>Now / Next</h2>
                <p>{next ? "Your upcoming match from the event schedule" : "Nothing on the schedule for us right now"}</p>
              </div>
            </div>
            {next ? <span className="edc-pill">{countdown}</span> : null}
          </header>
          {next ? (
            <>
              <div className={`edc-match-hero alliance-${next.ourAlliance ?? "tbd"}`}>
                <strong>{matchShortLabel(next.compLevel, next.matchNumber)}</strong>
                <span className="edc-match-when">{formatMyDayWhen(next.scheduledTime) ?? "Time TBD"}</span>
                <span className={`edc-bumper-cue ${next.ourAlliance ?? ""}`}>
                  {snap?.myDay?.bumperCue ??
                    (next.ourAlliance
                      ? `Switch to ${next.ourAlliance.toUpperCase()} bumpers`
                      : "Alliance TBD — confirm bumpers")}
                </span>
              </div>
              <p className="edc-partners">
                <span>With</span>{" "}
                <b>
                  {(next.ourAlliance === "red"
                    ? next.red.teamKeys
                    : next.ourAlliance === "blue"
                      ? next.blue.teamKeys
                      : []
                  )
                    .filter((key) => key !== snap?.teamKey)
                    .map((key) => teamLabel(key))
                    .join(" · ") || "—"}
                </b>
                <span className="edc-vs"> vs </span>
                <b>
                  {(next.ourAlliance === "red"
                    ? next.blue.teamKeys
                    : next.ourAlliance === "blue"
                      ? next.red.teamKeys
                      : []
                  )
                    .map((key) => teamLabel(key))
                    .join(" · ") || "—"}
                </b>
              </p>
              {/* The Red/Blue rows only repeated "With … vs …" above; they stay for a match
                  we are not in, where "With" has nothing to say. */}
              {next.ourAlliance ? null : (
                <div className="edc-alliances">
                  <div>
                    <span>Red</span>
                    <AllianceChips keys={next.red.teamKeys} ours={snap?.teamKey ?? null} highlight="red" />
                  </div>
                  <div>
                    <span>Blue</span>
                    <AllianceChips keys={next.blue.teamKeys} ours={snap?.teamKey ?? null} highlight="blue" />
                  </div>
                </div>
              )}
              {/* Only what the team has posted. Three "nothing yet" lines under the match
                  (leave time, room, on-duty mentor) were noise on an event day. */}
              {snap?.myDay && (snap.myDay.nextTravelLabel || snap.myDay.lodgingLabel || snap.myDay.onDutyLabel) ? (
                <ul className="edc-myday-strip" aria-label="Hotels and travel">
                  {snap.myDay.nextTravelLabel ? (
                    <li>
                      <span>Travel</span>
                      <b>{snap.myDay.nextTravelLabel}</b>
                    </li>
                  ) : null}
                  {snap.myDay.lodgingLabel ? (
                    <li>
                      <span>Room</span>
                      <b>{snap.myDay.lodgingLabel}</b>
                    </li>
                  ) : null}
                  {snap.myDay.onDutyLabel ? (
                    <li>
                      <span>On duty</span>
                      <b>{snap.myDay.onDutyLabel}</b>
                    </li>
                  ) : null}
                </ul>
              ) : null}
              <footer className="edc-after edc-myday-links">
                <a href={matchChecklistHref}>Checklist</a>
                {after ? (
                  <span>
                    After · {matchShortLabel(after.compLevel, after.matchNumber)}
                    {after.scheduledTime ? ` · ${countdownLabel(after.scheduledTime)}` : ""}
                  </span>
                ) : null}
              </footer>
            </>
          ) : (
            <div className="dash-empty">
              <strong>
                {snap.playoffsAhead ? "Quals are done" : snap.eventOver ? "Our matches here are done" : "No upcoming match"}
              </strong>
              <p>{snap?.message ?? "Set the event you’re at."}</p>
              {snap?.myDay?.nextTravelLabel || snap?.myDay?.lodgingLabel ? (
                <ul className="edc-myday-strip" aria-label="Hotels and travel">
                  {snap.myDay.nextTravelLabel ? (
                    <li>
                      <span>Travel</span>
                      <b>{snap.myDay.nextTravelLabel}</b>
                    </li>
                  ) : null}
                  {snap.myDay.lodgingLabel ? (
                    <li>
                      <span>Room</span>
                      <b>{snap.myDay.lodgingLabel}</b>
                    </li>
                  ) : null}
                </ul>
              ) : null}
              <div className="edc-empty-actions">
                {snap.playoffsAhead ? (
                  <a className="dash-empty-cta" href={hubHref("/competition", "alliance-selection-desk", orgId || null)}>
                    Get ready for alliance selection
                  </a>
                ) : null}
                {snap.eventOver && !snap.playoffsAhead && snap.canSetEvent ? (
                  <button type="button" className="dash-empty-cta" onClick={onSelectEvent}>
                    Pick your next event
                  </button>
                ) : null}
                {snap.eventOver ? (
                  <a className="dash-empty-cta secondary" href={rankingsHref}>
                    See the rankings
                  </a>
                ) : (
                  <a className="dash-empty-cta" href={scoutingHref}>
                    Open Scouting
                  </a>
                )}
              </div>
            </div>
          )}
        </article>

        {quiet ? seasonPulse : null}
        {quiet ? null : (
        <>
        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#15803d", ["--tone-bg" as string]: "#dcfce7" }}>
                <Icon name="clipboard" />
              </span>
              <div>
                <h2>Scout next</h2>
                <p>
                  {/* Counts the list below. It said "0 gaps in upcoming alliances" over a list of
                      eight robots missing pit scouting. */}
                  {snap?.scoutQueue.length
                    ? `${snap.scoutQueue.length} ${snap.scoutQueue.length === 1 ? "robot" : "robots"} still to scout`
                    : "Nothing waiting"}
                </p>
              </div>
            </div>
          </header>
          {snap?.scoutQueue.length ? (
            <ul className="edc-queue">
              {snap.scoutQueue.map((item) => (
                <li key={`${item.teamKey}-${item.matchKey}`}>
                  <div>
                    <strong>{item.teamNumber ?? teamLabel(item.teamKey)}</strong>
                    <span>
                      {item.matchLabel ?? "Event"} · {item.reasons.slice(0, 2).join(" · ")}
                    </span>
                  </div>
                  <a href={item.formHref}>Scout</a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dash-empty calm">
              <strong>Queue clear</strong>
              <p>
                {snap?.eventKey
                  ? "Upcoming alliance partners and opponents already have coverage, or no matches are queued."
                  : "Set your active event to build the scout queue from schedule gaps."}
              </p>
              <a className="dash-empty-cta" href={scoutingHref}>
                Open Scouting
              </a>
            </div>
          )}
        </article>

        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#0e5a66", ["--tone-bg" as string]: "#e2edef" }}>
                <Icon name="bolt" />
              </span>
              <div>
                <h2>Matchup snapshot</h2>
                <p>
                  {snap?.prediction.status === "live"
                    ? "Win chance from this event's ratings"
                    : "A win chance, once the schedule and ratings are in"}
                </p>
              </div>
            </div>
          </header>
          {snap?.prediction.status === "live" &&
          predictionWinDisplay({
            winProbability: snap.prediction.pOur,
            modelVersion: snap.prediction.modelVersion,
            caveats: snap.prediction.caveats,
          }) ? (
            <>
              <div className="edc-prob">
                <strong>
                  {predictionWinDisplay({
                    winProbability: snap.prediction.pOur,
                    modelVersion: snap.prediction.modelVersion,
                    caveats: snap.prediction.caveats,
                  })?.label}
                </strong>
                <span>Our win probability</span>
              </div>
              <p className="edc-muted">
                Opp{" "}
                {predictionWinDisplay({
                  winProbability: snap.prediction.pOpp,
                  modelVersion: snap.prediction.modelVersion,
                  caveats: snap.prediction.caveats,
                })?.label ?? "—"}
                {snap.prediction.confidenceLow != null && snap.prediction.confidenceHigh != null
                  ? ` · likely ${pct(snap.prediction.confidenceLow)}–${pct(snap.prediction.confidenceHigh)}`
                  : ""}
              </p>
              <ul className="edc-factors">
                {snap.prediction.keyFactors.slice(0, 3).map((factor) => (
                  <li key={factor.name}>
                    <strong>{plainStrategyText(factor.name)}</strong>
                    <span>{plainStrategyText(factor.evidence)}</span>
                  </li>
                ))}
              </ul>
              {plainStrategyText(snap.prediction.caveats[0]) ? (
                <p className="edc-caveat">{plainStrategyText(snap.prediction.caveats[0])}</p>
              ) : null}
              <button
                type="button"
                className="edc-link"
                disabled={recomputing}
                onClick={onRecompute}
              >
                {recomputing ? "Recomputing…" : "Recompute prediction"}
              </button>
              <a className="edc-link" href={strategyHref}>
                Open full strategy →
              </a>
            </>
          ) : (
            <div className="dash-empty calm">
              <strong>No prediction yet</strong>
              <p>Needs an upcoming match plus event numbers.</p>
              <a className="dash-empty-cta" href={strategyHref}>
                Open Strategy
              </a>
            </div>
          )}
        </article>
        </>
        )}
      </section>

      {quiet ? null : (
      <>
      <section className="edc-coverage-section" aria-label="Live scout coverage">
        <article className={`edc-card edc-coverage ${snap?.coverage.missingRows ? "gap" : ""}`}>
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#b45309", ["--tone-bg" as string]: "#ffedd5" }}>
                <Icon name="users" />
              </span>
              <div>
                <h2>Live coverage</h2>
                <p>
                  {snap?.coverage.liveBoard?.length
                    ? `${snap.coverage.missingRows} uncovered · ${snap.coverage.doubleCovered} double-scouted on now/next`
                    : "Which robots still need a scout for the next matches"}
                </p>
              </div>
            </div>
            {snap?.coverage.coordinatorNudge?.status === "sent" ? (
              <span className="edc-pill warn">Coordinator nudged</span>
            ) : snap?.coverage.coordinatorNudge?.status === "throttled" ? (
              <span className="edc-pill">Nudge cooling down</span>
            ) : null}
          </header>
          {snap?.coverage.liveBoard?.length ? (
            <>
              <div className="edc-coverage-board" role="list">
                {snap.coverage.liveBoard.slice(0, 24).map((cell) => (
                  <article key={`${cell.matchKey}-${cell.teamKey}`} className={cell.state} role="listitem">
                    <b>{matchShortLabel(cell.compLevel, cell.matchNumber)}</b>
                    <span>{cell.teamNumber ?? teamLabel(cell.teamKey)}</span>
                    <small>
                      {cell.state.replaceAll("_", " ")}
                      {cell.entryCount > 1 ? ` · ${cell.entryCount}` : ""}
                    </small>
                  </article>
                ))}
              </div>
              {snap.coverage.coordinatorNudge?.message ? (
                <p className="edc-muted">{snap.coverage.coordinatorNudge.message}</p>
              ) : null}
              <a className="edc-link" href={scoutingHref}>
                Open Scouting →
              </a>
            </>
          ) : (
            <div className="dash-empty calm">
              <strong>No live match rows yet</strong>
              <p>
                When the next matches are posted, this shows which robots still need a scout.
              </p>
              <a className="dash-empty-cta" href={scoutingHref}>
                Open Scouting
              </a>
            </div>
          )}
        </article>
      </section>

      <section className="edc-secondary" aria-label="Briefs and flags">
        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#0f766e", ["--tone-bg" as string]: "#ccfbf1" }}>
                <Icon name="target" />
              </span>
              <div>
                <h2>Drive coach briefs</h2>
                <p>What our opponents tend to do, from scouting</p>
              </div>
            </div>
          </header>
          {snap?.briefs.length ? (
            <ul className="edc-briefs">
              {snap.briefs.map((brief) => (
                <li key={brief.teamKey}>
                  <div className="edc-brief-head">
                    <strong>{brief.teamNumber ?? teamLabel(brief.teamKey)}</strong>
                    {/* The engine's labels ("scout-auto-capable", "pit-noted") in words. */}
                    <div className="edc-tags">
                      {intelTags(brief.labels).map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                  </div>
                  {brief.capabilities.length ? (
                    <p className="edc-caps">{plainStrategyText(brief.capabilities.join(" · "))}</p>
                  ) : null}
                  <ul>
                    {brief.evidence
                      .slice(0, 3)
                      .map((line) => plainStrategyText(line))
                      .filter(Boolean)
                      .map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dash-empty calm">
              <strong>No opponent briefs</strong>
              <p>Briefs appear once your next match is known and reference metrics or scout notes exist.</p>
            </div>
          )}
        </article>

        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#b91c1c", ["--tone-bg" as string]: "#fee2e2" }}>
                <Icon name="bell" />
              </span>
              <div>
                <h2>Pit flags · this match</h2>
                <p>Mechanical / reliability signals that matter now</p>
              </div>
            </div>
          </header>
          {snap?.pitFlags.length ? (
            <ul className="edc-flags">
              {snap.pitFlags.map((flag) => (
                <li key={`${flag.teamKey}-${flag.title}`} data-severity={flag.severity}>
                  <strong>
                    {flag.teamNumber ?? teamLabel(flag.teamKey)} · {flag.title}
                  </strong>
                  <span>{plainStrategyText(flag.detail)}</span>
                  <small>{plainStrategyText(flag.evidence)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dash-empty calm">
              <strong>No pit flags</strong>
              <p>Pit and match scout reliability notes for the next alliance appear here when logged.</p>
            </div>
          )}
        </article>

        {seasonPulse}
      </section>
      </>
      )}

      <nav className="edc-actions" aria-label="More competition tools">
        <a href={pitHref}>
          <Icon name="cube" />
          <strong>Pit</strong>
          <span>Release gate & batteries</span>
        </a>
        <a href={batteriesHref}>
          <Icon name="bolt" />
          <strong>Batteries</strong>
          <span>Fleet readiness</span>
        </a>
        <a href={intelHref}>
          <Icon name="stats" />
          <strong>Research</strong>
          <span>Team lookup</span>
        </a>
        <a href={chemistryHref}>
          <Icon name="users" />
          <strong>Chemistry</strong>
          <span>Alliance fit</span>
        </a>
      </nav>

      {eventPicker}
    </main>
  );
}

