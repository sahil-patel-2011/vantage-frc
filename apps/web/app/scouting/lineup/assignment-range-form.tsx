"use client";

import { useMemo, useState } from "react";
import { Button, Panel } from "../../../components/ui";
import { describeMatchKey } from "../../../lib/webhooks/tba-messages";
import { expandAssignmentRange, uniqueMatchKeys } from "../../../lib/scouting/assignment-range";
import type { AssignmentReceipt } from "../../../lib/scouting/assignment-receipt";

type ScoutOption = { userId: string; name: string; isMe: boolean };

export function AssignmentRangeForm({
  matchKeys,
  scouts,
  qualsOnly,
  busy,
  onAssign,
}: {
  matchKeys: Array<{ matchKey: string; teamKey: string }>;
  scouts: ScoutOption[];
  qualsOnly: boolean;
  busy?: boolean;
  onAssign: (payload: {
    action: "assign-range";
    firstMatchKey: string;
    lastMatchKey: string;
    teamKey: string;
    userId: string;
  }) => Promise<AssignmentReceipt | null>;
}) {
  const keys = useMemo(() => uniqueMatchKeys(matchKeys), [matchKeys]);
  const [firstMatchKey, setFirst] = useState(keys[0] ?? "");
  const [lastMatchKey, setLast] = useState(keys[keys.length - 1] ?? "");
  const [teamKey, setTeamKey] = useState("");
  const [userId, setUserId] = useState(scouts.find((scout) => scout.isMe)?.userId ?? scouts[0]?.userId ?? "");

  const preview = expandAssignmentRange({
    firstMatchKey,
    lastMatchKey,
    teamKey,
    matchKeys: keys,
    qualsOnly,
    schedule: matchKeys,
  });

  return (
    <Panel className="lineup-range motion-card" style={{ minHeight: "auto" }}>
      <header>
        <h3>Assign a match range</h3>
        <p className="app-muted">
          Give one scout every match a robot plays between two matches, for example a scout who follows one team all
          morning.
        </p>
      </header>
      <fieldset disabled={busy} className="lineup-range-grid">
        <legend className="sr-only">Match range details</legend>
        <label>
          First match
          <select value={firstMatchKey} onChange={(event) => setFirst(event.target.value)}>
            {keys.map((key) => (
              <option key={key} value={key}>
                {describeMatchKey(key)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Last match
          <select value={lastMatchKey} onChange={(event) => setLast(event.target.value)}>
            {keys.map((key) => (
              <option key={key} value={key}>
                {describeMatchKey(key)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Robot
          <input value={teamKey} inputMode="numeric" placeholder="Team number, like 6925" onChange={(event) => setTeamKey(event.target.value)} />
        </label>
        <label>
          Scout
          <select value={userId} onChange={(event) => setUserId(event.target.value)}>
            {scouts.map((scout) => (
              <option key={scout.userId} value={scout.userId}>
                {scout.isMe ? `${scout.name} (me)` : scout.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      <p className="app-muted">
        {preview.ok
          ? `${preview.slots.length} ${preview.slots.length === 1 ? "match" : "matches"} for this robot in this range`
          : preview.error}
      </p>
      <Button
        variant="secondary"
        type="button"
        disabled={busy || !preview.ok || !scouts.some(scout => scout.userId === userId)}
        onClick={() =>
          void onAssign({
            action: "assign-range",
            firstMatchKey,
            lastMatchKey,
            teamKey,
            userId,
          })
        }
      >
        {busy ? "Please wait…" : "Assign this range"}
      </Button>
      {!scouts.length ? <p className="app-muted">Add an eligible scout to your team before assigning matches.</p> : !scouts.some(scout => scout.userId === userId) ? <p role="status">This scout is no longer available. Choose a current team member.</p> : null}
    </Panel>
  );
}
