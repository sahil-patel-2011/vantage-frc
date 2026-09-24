"use client";

import {
  countdownState,
  hasReadinessSignal,
  kioskNextMatchEmptyCopy,
  matchLabel,
  queueCue,
  rankLabel,
  recordLabel,
  widgetValue,
  type DisplayNextMatch,
  type DisplaySnapshot,
} from "../../../lib/display";
import type { DisplayMatchIntel } from "../../../lib/display/match-intel";
import { kioskOpponentIntel, kioskSides, kioskWinLine } from "../../../lib/display/kiosk-view";
import { WIDGET_LABEL, isWidgetType } from "../../../lib/display/widget-layout";

function timeLabel(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * The panel a pit crew reads from three metres away: which match, how long until queue, what
 * colour bumpers, and who is with and against us. It is the same whether the board is the
 * "Next match" preset or a board the team built, so adding panels never costs the countdown.
 */
export function NextMatchHero({
  match,
  teamNumber,
  now,
  intel,
}: {
  match: DisplayNextMatch | null;
  teamNumber: number;
  now: number;
  intel: DisplayMatchIntel | null;
}) {
  if (!match) {
    return (
      <article className="kp kp-hero kp-next is-empty">
        <span className="kp-label">Next match</span>
        <strong className="kp-hero-title">No match ahead</strong>
        <p className="kp-sub">{kioskNextMatchEmptyCopy(teamNumber)}</p>
      </article>
    );
  }
  const clock = countdownState(match.scheduledTime, now);
  const sides = kioskSides(match, teamNumber);
  const cueClass = clock.queueNow ? "is-now" : clock.queueSoon ? "is-soon" : clock.leavePit ? "is-leave" : "";
  const tagsFor = (team: string) =>
    intel?.teams.find((row) => row.teamKey.replace(/^frc/i, "") === team)?.tags.join(" · ") ?? "";
  const lineup = (teams: string[], color: "red" | "blue" | null) => (
    <ul className={`kp-lineup${color ? ` is-${color}` : ""}`}>
      {teams.length ? (
        teams.map((team) => (
          <li key={team}>
            <b>{team}</b>
            {tagsFor(team) ? <small>{tagsFor(team)}</small> : null}
          </li>
        ))
      ) : (
        <li>
          <b>—</b>
        </li>
      )}
    </ul>
  );
  const theirs = sides.ourColor === "red" ? "blue" : sides.ourColor === "blue" ? "red" : null;

  return (
    <article className="kp kp-hero kp-next">
      <div className="kp-next-top">
        <div>
          <span className="kp-label">Next match</span>
          <strong className="kp-hero-title">{matchLabel(match.compLevel, match.matchNumber)}</strong>
          <span className="kp-sub">{timeLabel(match.scheduledTime) ?? "No time posted yet"}</span>
        </div>
        <div className="kp-clock">
          <strong className={clock.queueSoon ? "is-soon" : undefined}>{clock.label}</strong>
          {clock.remainingMs != null ? <em className={cueClass}>{queueCue(clock)}</em> : null}
        </div>
      </div>
      {sides.ourColor ? (
        <p className={`kp-bumper is-${sides.ourColor}`}>
          WE ARE {sides.ourColor.toUpperCase()} <small>{sides.ourColor} bumpers on</small>
        </p>
      ) : (
        <p className="kp-bumper">Bumper colour not posted</p>
      )}
      {sides.ourColor ? (
        <div className="kp-sides">
          <section>
            <h3>With us</h3>
            {lineup(sides.partners, sides.ourColor)}
          </section>
          <section>
            <h3>Against us</h3>
            {lineup(sides.opponents, theirs)}
          </section>
        </div>
      ) : (
        <div className="kp-sides">
          <section>
            <h3>Red</h3>
            {lineup(sides.red, "red")}
          </section>
          <section>
            <h3>Blue</h3>
            {lineup(sides.blue, "blue")}
          </section>
        </div>
      )}
    </article>
  );
}

/** One panel on a board the team built: a label, one big line, one small line. */
export function KioskPanel({
  type,
  data,
  now,
  intel,
  hero,
}: {
  type: string;
  data: DisplaySnapshot;
  now: number;
  intel: DisplayMatchIntel | null;
  hero: boolean;
}) {
  const teamNumber = data.organization.teamNumber;
  if (type === "next_match" && hero) {
    return <NextMatchHero match={data.nextMatch} teamNumber={teamNumber} now={now} intel={intel} />;
  }
  const label = isWidgetType(type) ? WIDGET_LABEL[type] : type.replaceAll("_", " ");
  let value = widgetValue(type, data);
  let detail: string | null = null;
  let tone: string | undefined;
  let lines: Array<{ team: string; words: string }> = [];

  switch (type) {
    case "next_match": {
      const match = data.nextMatch;
      if (!match) value = "No match ahead";
      if (match) {
        const clock = countdownState(match.scheduledTime, now);
        const sides = kioskSides(match, teamNumber);
        value = `${matchLabel(match.compLevel, match.matchNumber)} · ${clock.label}`;
        detail = sides.ourColor ? `We are ${sides.ourColor.toUpperCase()} · ${queueCue(clock)}` : queueCue(clock);
        tone = sides.ourColor ?? undefined;
      }
      break;
    }
    case "prediction": {
      const win = kioskWinLine(data, teamNumber);
      value = win.value;
      detail = win.detail;
      break;
    }
    case "robot_readiness":
      if (hasReadinessSignal(data.readiness)) {
        const r = data.readiness!;
        value = `${r.batteriesActive} ${r.batteriesActive === 1 ? "battery" : "batteries"} ready`;
        detail = `${r.openFailures} open ${r.openFailures === 1 ? "repair" : "repairs"} · ${r.openMaintenance} maintenance due`;
      }
      break;
    case "event_status":
      if (data.eventStatus) {
        value = `Rank ${rankLabel(data.eventStatus)}`;
        detail = `Record ${recordLabel(data.eventStatus)}`;
      }
      break;
    case "scouting_coverage":
      value = `${data.scouting.reports} ${data.scouting.reports === 1 ? "report" : "reports"}`;
      detail = `${data.scouting.assignments} scout assignments at this event`;
      break;
    case "alerts":
      // The pit's alerts are the robot's: open repairs someone logged. Scout disagreements
      // ("43 to review") are a scouting lead's desk job, not something a pit crew can act on.
      if (hasReadinessSignal(data.readiness)) {
        const open = data.readiness!.openFailures;
        value = open > 0 ? `${open} open ${open === 1 ? "repair" : "repairs"}` : "All clear";
        detail = open > 0 ? "Robot problems logged and not fixed yet" : "No open robot problems";
      }
      break;
    case "team_intel": {
      const match = data.nextMatch;
      if (match) {
        const sides = kioskSides(match, teamNumber);
        lines = kioskOpponentIntel(intel, sides.opponents);
        // With lines to show, they are the content; the caption only explains an empty panel.
        detail = lines.length ? null : `Opponents in ${matchLabel(match.compLevel, match.matchNumber)}`;
      }
      break;
    }
    default:
      break;
  }

  return (
    <article className={`kp kp-${type}${hero ? " kp-hero" : ""}${tone ? ` is-${tone}` : ""}`}>
      <span className="kp-label">{label}</span>
      {lines.length ? (
        <ul className="kp-lines">
          {lines.map((line) => (
            <li key={line.team}>
              <b>{line.team}</b> {line.words}
            </li>
          ))}
        </ul>
      ) : (
        <strong className="kp-value">{value}</strong>
      )}
      {detail ? <small className="kp-sub">{detail}</small> : null}
    </article>
  );
}
