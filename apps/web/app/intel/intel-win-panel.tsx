"use client";

import { useMemo, useState } from "react";
import { predictUnscoredMatch } from "@vantage/prediction-strategy";
import { Button, FormRow, Panel } from "../../components/ui";
import { eventStdFor, type EventRatingRow } from "../../lib/intel/lovat-lookup";

function parseTeamKeys(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.toLowerCase().startsWith("frc") ? part.toLowerCase() : `frc${part}`));
}

function meanFor(teamKey: string, fieldRatings: EventRatingRow[]): number | null {
  const row = fieldRatings.find((item) => item.teamKey === teamKey);
  const value = row?.epaTotal;
  return value != null && Number.isFinite(value) ? value : null;
}

function pctLabel(value: number | null): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

export function IntelWinPanel({
  teamKey,
  fieldRatings,
}: {
  teamKey: string;
  fieldRatings: EventRatingRow[];
}) {
  const [redRaw, setRedRaw] = useState(teamKey.replace(/^frc/i, ""));
  const [blueRaw, setBlueRaw] = useState("");
  const [flipped, setFlipped] = useState(false);
  const fieldStd = eventStdFor("totalPoints", fieldRatings);

  const prediction = useMemo(() => {
    const redKeys = parseTeamKeys(redRaw);
    const blueKeys = parseTeamKeys(blueRaw);
    if (!redKeys.length || !blueKeys.length) return null;
    const left = (flipped ? blueKeys : redKeys).map((key) => ({ teamKey: key, mean: meanFor(key, fieldRatings) }));
    const right = (flipped ? redKeys : blueKeys).map((key) => ({ teamKey: key, mean: meanFor(key, fieldRatings) }));
    return predictUnscoredMatch({ red: left, blue: right, fieldStd });
  }, [blueRaw, fieldRatings, fieldStd, flipped, redRaw]);

  const redPct = prediction?.redWinPct ?? null;
  const bluePct = prediction?.blueWinPct ?? null;

  return (
    <Panel className="intel-win" style={{ minHeight: "auto" }}>
      <h3 style={{ marginTop: 0 }}>Match predictor</h3>
      <p className="app-muted">
        Predicted scores are the sum of team means. Win % is the left tail of red minus blue — skipped when a robot
        has no rating.
      </p>
      <div className="intel-win-inputs">
        <FormRow label="Red" hint="Team numbers, comma-separated.">
          <input value={redRaw} onChange={(event) => setRedRaw(event.target.value)} aria-label="Red alliance teams" />
        </FormRow>
        <FormRow label="Blue" hint="Team numbers, comma-separated.">
          <input value={blueRaw} onChange={(event) => setBlueRaw(event.target.value)} aria-label="Blue alliance teams" />
        </FormRow>
      </div>
      <Button variant="secondary" type="button" onClick={() => setFlipped((value) => !value)}>
        Flip red and blue
      </Button>
      {!fieldRatings.length ? (
        <p className="app-muted">Needs setup — no event ratings on file yet.</p>
      ) : prediction ? (
        <div className="intel-win-result">
          <div className="intel-win-alliances">
            <div className="intel-win-side is-red">
              <span>Red predicted</span>
              <strong>{prediction.redPredicted.toFixed(1)}</strong>
              <em>{redPct == null ? "Win % —" : `Win ${pctLabel(redPct)}`}</em>
            </div>
            <div className="intel-win-side is-blue">
              <span>Blue predicted</span>
              <strong>{prediction.bluePredicted.toFixed(1)}</strong>
              <em>{bluePct == null ? "Win % —" : `Win ${pctLabel(bluePct)}`}</em>
            </div>
          </div>
          {redPct != null && bluePct != null ? (
            <div
              className="intel-win-bar"
              role="img"
              aria-label={`Red ${Math.round(redPct * 100)} percent, Blue ${Math.round(bluePct * 100)} percent`}
            >
              <i style={{ width: `${Math.round(redPct * 100)}%` }} />
            </div>
          ) : (
            <p className="app-muted">Predicted scores only — this event has no spread yet.</p>
          )}
        </div>
      ) : (
        <p className="app-muted">Add both alliances. A missing rating skips the match instead of filling 0.</p>
      )}
    </Panel>
  );
}
