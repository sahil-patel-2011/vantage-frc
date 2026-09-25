"use client";

import { ourSideRange } from "../../../lib/strategy/our-side-range";
import { nextMatchScoreLine } from "../../../lib/dashboard/next-match-copy";
import { numericOrNull } from "../../../lib/strategy/numeric-or-null";
import { predictionWinDisplay } from "../../../lib/strategy/prediction-display";
import { matchShortLabel } from "../../../lib/matches/no-next-match";
import { MatchClock } from "./live-countdown";

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

  const label =
    typeof data.compLevel === "string" && Number.isFinite(Number(data.matchNumber))
      ? matchShortLabel(data.compLevel.toLowerCase(), Number(data.matchNumber))
      : `Match ${String(data.matchNumber ?? "")}`.trim();
  const partners = Array.isArray(data.partners) ? data.partners.map(String) : null;
  const opponents = Array.isArray(data.opponents) ? data.opponents.map(String) : null;

  // Laid out like a scoreboard: which match and how long until it, our colour as a filled
  // pill, who is with and against us as chips, and the win chance as a bar. It was a column of
  // small grey lines with the countdown floating alone on the right.
  return (
    <div className={`dash-next-match nm${alliance ? ` alliance-${alliance}` : ""}`}>
      <div className="nm-top">
        <div className="nm-title">
          {/* "Qual 31", the name people say, not "QM" over "31". */}
          <strong className="nm-match">{label}</strong>
          {/* One filled pill says both our colour and the job ("Switch to BLUE bumpers"). */}
          {alliance ? (
            <span className={`nm-alliance nm-alliance-${alliance}`}>
              {typeof data.bumperCue === "string" && data.bumperCue
                ? data.bumperCue
                : `${alliance === "red" ? "Red" : "Blue"} alliance`}
            </span>
          ) : null}
        </div>
        <MatchClock iso={scheduled} className="dash-countdown nm-clock" />
      </div>
      {!alliance && typeof data.bumperCue === "string" && data.bumperCue ? (
        <p className="dash-bumper-cue nm-bumpers">{data.bumperCue}</p>
      ) : null}
      {partners || opponents ? (
        <div className="dash-match-sides nm-sides">
          <div className="nm-side">
            <span>With us</span>
            <div className="nm-teams">
              {partners && partners.length ? partners.map((team) => <b key={team}>{team}</b>) : <b>—</b>}
            </div>
          </div>
          <div className="nm-side nm-against">
            <span>Against</span>
            <div className="nm-teams">
              {opponents && opponents.length ? opponents.map((team) => <b key={team}>{team}</b>) : <b>—</b>}
            </div>
          </div>
        </div>
      ) : null}
      {win ? (
        <div className="nm-win" aria-label={`${win.label} chance we win`}>
          <div className="nm-win-head">
            <strong>{win.label}</strong>
            <span>
              chance we win
              {low != null && high != null
                ? // No-break around the dash: "64–" and "85%" landed on two lines.
                  ` · usually ${Math.round(low * 100)}\u2060–\u2060${Math.round(high * 100)}%`
                : ""}
            </span>
          </div>
          <div className="nm-bar" aria-hidden="true">
            <i style={{ width: `${Math.max(2, Math.min(100, win.percent))}%` }} />
          </div>
        </div>
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
      {/* No factor rows: "weighted scoring", "autonomous", "foul exposure" are the model's
          words, bare here. The briefing this card links to explains the match. */}
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
