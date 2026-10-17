"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { defaultMatchup, type PlayoffAlliance, type PlayoffAlliancesView } from "../../lib/match-sim/alliances";

const strip = (teamKey: string) => teamKey.replace(/^frc/i, "");

/**
 * "Alliance 1 vs Alliance 8" from the team's alliance selection board. During selection there
 * is no playoff schedule to pick from, so the board is where the alliances are; once TBA posts the
 * playoff matches they are in "Pick a match" above as well. With no board yet it says where the
 * alliances come from instead of an empty box.
 */
export function PlayoffAlliancePicker({
  orgId,
  teamNumber,
  busy,
  onPredict,
}: {
  orgId: string | null;
  teamNumber: number | null;
  busy: boolean;
  onPredict: (red: PlayoffAlliance, blue: PlayoffAlliance) => void;
}) {
  const [view, setView] = useState<PlayoffAlliancesView | null>(null);
  const [failed, setFailed] = useState(false);
  const [red, setRed] = useState<number | null>(null);
  const [blue, setBlue] = useState<number | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/match-sim?view=alliances&orgId=${encodeURIComponent(orgId)}`);
        if (!response.ok) throw new Error(String(response.status));
        const next = (await response.json()) as PlayoffAlliancesView;
        if (cancelled) return;
        setView(next);
        if (next.status === "ready") {
          const pair = defaultMatchup(next.alliances, teamNumber ? `frc${teamNumber}` : null);
          setRed(pair?.[0] ?? null);
          setBlue(pair?.[1] ?? null);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, teamNumber]);

  // Home's "Playoff alliances" link lands here; the section draws after the page, so the
  // browser's own jump to #playoff-alliances finds nothing.
  useEffect(() => {
    if (view && typeof window !== "undefined" && window.location.hash === "#playoff-alliances") {
      document.getElementById("playoff-alliances")?.scrollIntoView({ block: "start" });
    }
  }, [view]);

  // Nothing to say until we know; a failed read leaves the rest of the page as it was.
  if (!orgId || failed || !view) return null;

  const boardHref = `/competition?tab=alliance-selection-desk&orgId=${encodeURIComponent(orgId)}`;
  if (view.status !== "ready") {
    return (
      <section className="msim-alliances" aria-label="Playoff alliances" id="playoff-alliances">
        <h2>Playoff alliances</h2>
        <p className="msim-upcoming-note">
          At alliance selection, fill in the alliance board and each alliance shows up here to predict.{" "}
          <a href={boardHref}>Open alliance selection</a>
        </p>
      </section>
    );
  }

  const ours = teamNumber ? `frc${teamNumber}` : null;
  const name = (alliance: PlayoffAlliance) =>
    `Alliance ${alliance.seed}${ours && alliance.teamKeys.includes(ours) ? " (us)" : ""} · ${alliance.teamKeys.map(strip).join(" ")}`;
  const redAlliance = view.alliances.find((alliance) => alliance.seed === red) ?? null;
  const blueAlliance = view.alliances.find((alliance) => alliance.seed === blue) ?? null;
  const same = red != null && red === blue;

  return (
    <section className="msim-alliances" aria-label="Playoff alliances" id="playoff-alliances">
      <h2>Playoff alliances</h2>
      <p className="msim-upcoming-note">From your alliance board &ldquo;{view.boardName}&rdquo;.</p>
      <div className="msim-alliances-row">
        <label>
          <span className="msim-upcoming-red">Red</span>
          <select value={red ?? ""} onChange={(event) => setRed(Number(event.target.value))}>
            {view.alliances.map((alliance) => (
              <option key={alliance.seed} value={alliance.seed}>
                {name(alliance)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="msim-upcoming-blue">Blue</span>
          <select value={blue ?? ""} onChange={(event) => setBlue(Number(event.target.value))} aria-invalid={same || undefined}>
            {view.alliances.map((alliance) => (
              <option key={alliance.seed} value={alliance.seed}>
                {name(alliance)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {same ? <p className="msim-alliances-error">Pick two different alliances.</p> : null}
      <div>
        <Button
          variant="secondary"
          type="button"
          disabled={busy || same || !redAlliance || !blueAlliance}
          onClick={() => {
            if (redAlliance && blueAlliance && !same) onPredict(redAlliance, blueAlliance);
          }}
        >
          {redAlliance && blueAlliance && !same ? `Predict Alliance ${redAlliance.seed} vs ${blueAlliance.seed}` : "Predict"}
        </Button>
      </div>
    </section>
  );
}
