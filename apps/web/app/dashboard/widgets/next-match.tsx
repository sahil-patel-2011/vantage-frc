"use client";

import { ourSideRange } from "../../../lib/strategy/our-side-range";
import { nextMatchDriverLines, nextMatchScoreLine } from "../../../lib/dashboard/next-match-copy";
import { numericOrNull } from "../../../lib/strategy/numeric-or-null";
import { predictionWinDisplay } from "../../../lib/strategy/prediction-display";
import { matchShortLabel } from "../../../lib/matches/no-next-match";
import { LiveCountdown } from "./live-countdown";

function allianceTeams(alliance: unknown) {
  if (!alliance || typeof alliance !== "object") return "—";
  const keys = (alliance as { teamKeys?: string[] }).teamKeys ?? [];
  return keys.map((key) => key.replace(/^frc/, "")).join(" · ") || "—";
}

export function NextMatchLive({ data }: { data: Record<string, unknown> }) {
  const scheduled = data.scheduledTime as string | undefined;
  const alliance = data.ourAlliance === "red" || data.ourAlliance === "blue" ? data.ourAlliance : null;
  const win = predictionWinDisplay({
    // numericOrNull, not Number(): a null probability coerces to 0, and the
    // widget then told the drive team "0% chance we win" for a match nobody
    // had predicted yet.
    pRed: numericOrNull(data.pRed),
    pBlue: numericOrNull(data.pBlue),
    alliance,
    modelVersion: typeof data.modelVersion === "string" ? data.modelVersion : null,
  });
  // Stored intervals are about red winning; show ours so the range brackets our win %.
  const range = ourSideRange(numericOrNull(data.confidenceLow), numericOrNull(data.confidenceHigh), alliance);
  const low = range?.low ?? null;
  const high = range?.high ?? null;
  const drivers = nextMatchDriverLines(data);

  return (
    <div className={`dash-next-match${alliance ? ` alliance-${alliance}` : ""}`}>
      <div>
        {/* "Qual 31", the name people say, not "QM" over "31". */}
        <strong>
          {typeof data.compLevel === "string" && Number.isFinite(Number(data.matchNumber))
            ? matchShortLabel(data.compLevel.toLowerCase(), Number(data.matchNumber))
            : `Match ${String(data.matchNumber ?? "")}`.trim()}
        </strong>
      </div>
      <div className="dash-countdown">
        <span>Starts in</span>
        <strong>{scheduled ? <LiveCountdown iso={scheduled} /> : "Time not posted"}</strong>
      </div>
      {typeof data.bumperCue === "string" && data.bumperCue ? (
        <p className="dash-bumper-cue">{data.bumperCue}</p>
      ) : null}
      {Array.isArray(data.partners) || Array.isArray(data.opponents) ? (
        <p className="dash-match-sides">
          With{" "}
          {Array.isArray(data.partners) && data.partners.length
            ? data.partners.map(String).join(" · ")
            : "—"}
          <em>
            {" "}
            vs{" "}
            {Array.isArray(data.opponents) && data.opponents.length
              ? data.opponents.map(String).join(" · ")
              : "—"}
          </em>
        </p>
      ) : null}
      {win ? (
        <p className="app-muted">
          {win.label} chance we win
          {low != null && high != null
            ? ` · typical range ${Math.round(low * 100)}–${Math.round(high * 100)}%`
            : ""}
        </p>
      ) : (
        <p className="app-muted">No win chance for this match yet.</p>
      )}
      {typeof data.redPredicted === "number" &&
      typeof data.bluePredicted === "number" &&
      Number.isFinite(data.redPredicted) &&
      Number.isFinite(data.bluePredicted) ? (
        <p className="app-muted">
          {nextMatchScoreLine({
            redPredicted: Number(data.redPredicted),
            bluePredicted: Number(data.bluePredicted),
            errorBand: typeof data.errorBand === "number" ? data.errorBand : null,
            redBand: numericOrNull(data.redBand),
            blueBand: numericOrNull(data.blueBand),
          })}
        </p>
      ) : null}
      {/* Where the doubt is coming from, in one sentence — usually a named
          robot that has been breaking down, which is the thing a drive team
          can actually do something about before the match starts. */}
      {typeof data.confidence === "string" && data.confidence.trim() ? (
        <p className="app-muted dash-next-confidence">{data.confidence.trim()}</p>
      ) : null}
      {typeof data.briefing === "string" && data.briefing ? (
        <p className="dash-bumper-cue">{data.briefing}</p>
      ) : null}
      {drivers.length ? (
        <ul className="dash-checklist">
          {drivers.map((line) => (
            <li key={line}>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {/* The alliances only when "With … vs …" above could not say them. */}
      {Array.isArray(data.partners) || Array.isArray(data.opponents) ? null : (
        <footer>
          <div>
            <span>Red</span> <b>{allianceTeams(data.redAlliance)}</b>
          </div>
          <div>
            <span>Blue</span> <b>{allianceTeams(data.blueAlliance)}</b>
          </div>
        </footer>
      )}
    </div>
  );
}
