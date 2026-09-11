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
import { predictionWinDisplay } from "../../lib/strategy/prediction-display";
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

  return (
    <main className={`edc-page${embedded ? " is-embedded" : ""}`}>
      <CommandReadyHeader
        embedded={embedded}
        orgId={orgId || null}
        title={snap.eventName ?? "Event Day Command"}
        orgName={snap.orgName ?? me.orgName ?? null}
        teamNumber={snap.teamNumber ?? me.teamNumber ?? null}
        eventKey={snap.eventKey ?? null}
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
      <DataSourceDegradedBanner health={snap?.dataSourceHealth} />
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

      <section className="edc-priority" aria-label="Priority panels">
        <article className={`edc-card edc-next ${next ? "live" : "empty"}`}>
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#1457d9", ["--tone-bg" as string]: "#e4ecfc" }}>
                <Icon name="swords" />
              </span>
              <div>
                <h2>Now / Next</h2>
                <p>{next ? "Your upcoming match from the event schedule" : "Waiting for schedule"}</p>
              </div>
            </div>
            {next ? <span className="edc-pill">{countdown}</span> : null}
          </header>
          {next ? (
            <>
              <div className={`edc-match-hero alliance-${next.ourAlliance ?? "tbd"}`}>
                <strong>
                  {next.compLevel.toUpperCase()} {next.matchNumber}
                </strong>
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
              {snap?.myDay ? (
                <ul className="edc-myday-strip" aria-label="Hotels and travel">
                  <li>
                    <span>Travel</span>
                    <b>
                      {snap.myDay.nextTravelLabel ??
                        "No leave time — open Logistics"}
                    </b>
                  </li>
                  <li>
                    <span>Room</span>
                    <b>
                      {snap.myDay.lodgingLabel ??
                        "No lodging assigned — mentors publish hotels on Logistics"}
                    </b>
                  </li>
                  {snap.myDay.onDutyLabel ? (
                    <li>
                      <span>On duty</span>
                      <b>{snap.myDay.onDutyLabel}</b>
                    </li>
                  ) : (
                    <li>
                      <span>On duty</span>
                      <b>No on-duty mentor posted yet</b>
                    </li>
                  )}
                </ul>
              ) : null}
              <footer className="edc-after edc-myday-links">
                <a href={matchChecklistHref}>Checklist</a>
                {after ? (
                  <span>
                    After · {after.compLevel.toUpperCase()} {after.matchNumber}
                    {after.scheduledTime ? ` · ${countdownLabel(after.scheduledTime)}` : ""}
                  </span>
                ) : null}
              </footer>
            </>
          ) : (
            <div className="dash-empty">
              <strong>No upcoming match</strong>
              <p>{snap?.message ?? "Set the event you’re at."}</p>
              {snap?.myDay ? (
                <ul className="edc-myday-strip" aria-label="Hotels and travel">
                  <li>
                    <span>Travel</span>
                    <b>{snap.myDay.nextTravelLabel ?? "No leave time published yet"}</b>
                  </li>
                  <li>
                    <span>Room</span>
                    <b>{snap.myDay.lodgingLabel ?? "No lodging assigned yet"}</b>
                  </li>
                </ul>
              ) : null}
              <a className="dash-empty-cta" href={matchChecklistHref}>
                Open checklist
              </a>
            </div>
          )}
        </article>

        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#15803d", ["--tone-bg" as string]: "#dcfce7" }}>
                <Icon name="clipboard" />
              </span>
              <div>
                <h2>Scout next</h2>
                <p>
                  {snap
                    ? `${snap.coverage.upcomingUnscouted} gap${snap.coverage.upcomingUnscouted === 1 ? "" : "s"} in upcoming alliances`
                    : "Coverage queue"}
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
              <span className="edc-icon" style={{ ["--tone" as string]: "#1457d9", ["--tone-bg" as string]: "#e4ecfc" }}>
                <Icon name="bolt" />
              </span>
              <div>
                <h2>Matchup snapshot</h2>
                <p>
                  {snap?.prediction.status === "live"
                    ? "Win chance from this event's ratings"
                    : "Labeled win/loss when schedule + metrics exist"}
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
                  ? ` · band ${pct(snap.prediction.confidenceLow)}–${pct(snap.prediction.confidenceHigh)}`
                  : ""}
              </p>
              <ul className="edc-factors">
                {snap.prediction.keyFactors.slice(0, 3).map((factor) => (
                  <li key={factor.name}>
                    <strong>{factor.name}</strong>
                    <span>{factor.evidence}</span>
                  </li>
                ))}
              </ul>
              {snap.prediction.caveats[0] ? <p className="edc-caveat">{snap.prediction.caveats[0]}</p> : null}
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
      </section>

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
                    : "Double-scouted vs unscouted rows for now/next matches"}
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
                    <b>
                      {cell.compLevel.toUpperCase()} {cell.matchNumber}
                    </b>
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
                When your next matches are on the board, uncovered vs double-scouted robots appear here — never
                coverage zeros.
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
                <p>Opponent tendencies + scout capabilities (cited)</p>
              </div>
            </div>
          </header>
          {snap?.briefs.length ? (
            <ul className="edc-briefs">
              {snap.briefs.map((brief) => (
                <li key={brief.teamKey}>
                  <div className="edc-brief-head">
                    <strong>{brief.teamNumber ?? teamLabel(brief.teamKey)}</strong>
                    <div className="edc-tags">
                      {brief.labels.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                  </div>
                  {brief.capabilities.length ? (
                    <p className="edc-caps">{brief.capabilities.join(" · ")}</p>
                  ) : null}
                  <ul>
                    {brief.evidence.slice(0, 3).map((line) => (
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
                  <span>{flag.detail}</span>
                  <small>{flag.evidence}</small>
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

        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#1457d9", ["--tone-bg" as string]: "#e4ecfc" }}>
                <Icon name="stats" />
              </span>
              <div>
                <h2>Season pulse</h2>
                <p>Record & rank with source label</p>
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
                <span>EPA</span>
              </div>
              <p className="edc-muted">
                Source: {snap.record.source ?? "reference"}
                {snap.record.syncedAt ? ` · synced ${new Date(snap.record.syncedAt).toLocaleString()}` : ""}
              </p>
              <p className="edc-muted">
                Scout coverage: {snap.coverage.matchReports} match · {snap.coverage.pitReports} pit
                {snap.coverage.openDisagreements ? ` · ${snap.coverage.openDisagreements} open disagreements` : ""}
              </p>
            </div>
          ) : (
            <div className="dash-empty calm">
              <strong>No event metrics yet</strong>
              <p>Rank and EPA appear after the event numbers sync.</p>
            </div>
          )}
        </article>
      </section>

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

