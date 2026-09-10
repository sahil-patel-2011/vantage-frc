"use client";

import { predictionWinDisplay } from "../../../lib/strategy/prediction-display";
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
    pRed: typeof data.pRed === "number" ? data.pRed : Number(data.pRed),
    pBlue: typeof data.pBlue === "number" ? data.pBlue : Number(data.pBlue),
    alliance,
    modelVersion: typeof data.modelVersion === "string" ? data.modelVersion : null,
  });
  const low = typeof data.confidenceLow === "number" ? data.confidenceLow : Number(data.confidenceLow);
  const high = typeof data.confidenceHigh === "number" ? data.confidenceHigh : Number(data.confidenceHigh);
  const factors = (data.keyFactors as Array<{ name?: string; impact?: string }> | undefined)?.slice(0, 3) ?? [];

  return (
    <div className={`dash-next-match${alliance ? ` alliance-${alliance}` : ""}`}>
      <div>
        <span>{String(data.compLevel ?? "Match")}</span>
        <strong>{String(data.matchNumber ?? "—")}</strong>
      </div>
      <div className="dash-countdown">
        <span>Starts in</span>
        <strong>
          <LiveCountdown iso={scheduled} />
        </strong>
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
          {Number.isFinite(low) && Number.isFinite(high)
            ? ` · typical range ${Math.round(low * 100)}–${Math.round(high * 100)}%`
            : ""}
        </p>
      ) : (
        <p className="app-muted">No stored prediction for this match yet. Open Strategy after TBA sync.</p>
      )}
      {typeof data.redPredicted === "number" &&
      typeof data.bluePredicted === "number" &&
      Number.isFinite(data.redPredicted) &&
      Number.isFinite(data.bluePredicted) ? (
        <p className="app-muted">
          About {Math.round(Number(data.redPredicted))}–{Math.round(Number(data.bluePredicted))} points
          {typeof data.errorBand === "number" && Number.isFinite(data.errorBand)
            ? ` · typical error ±${Math.round(Number(data.errorBand))}`
            : ""}
        </p>
      ) : null}
      {typeof data.briefing === "string" && data.briefing ? (
        <p className="dash-bumper-cue">{data.briefing}</p>
      ) : null}
      {factors.length ? (
        <ul className="dash-checklist">
          {factors.map((factor, index) => (
            <li key={`${factor.name}-${index}`}>
              <span>{factor.name ?? "Why"}</span>
              <b>{factor.impact ?? ""}</b>
            </li>
          ))}
        </ul>
      ) : null}
      <footer>
        <div>
          <span>Red</span>
          <b>{allianceTeams(data.redAlliance)}</b>
        </div>
        <div>
          <span>Blue</span>
          <b>{allianceTeams(data.blueAlliance)}</b>
        </div>
      </footer>
    </div>
  );
}
