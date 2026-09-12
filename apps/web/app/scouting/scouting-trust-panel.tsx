"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, Panel, Button } from "../../components/ui";
import { degradedModeReasonLabel, degradedModeSourceLabel } from "../../lib/degraded-mode";
import ScoutingReconciliationPanel from "./scouting-reconciliation-panel";

type InfluenceRow = {
  entryId: string;
  teamKey: string;
  reason: string;
  recordedAt: string;
  matchKey?: string | null;
  pickListName?: string | null;
  teamNumber?: number | null;
  nickname?: string | null;
};

type StrategySeat = {
  userId: string;
  name: string;
  meetingOn: string;
  reason: string;
};

type TrustView = {
  eventKey: string | null;
  canManage: boolean;
  schemaBudgets: Array<{
    schemaId: string;
    year: number;
    type: "match" | "pit";
    title: string;
    version: number;
    fieldCount: number;
    recommendedMaximum: number;
    status: string;
    message: string;
    clonedFrom: string | null;
    fields: Array<{ key: string; label: string; type: string }>;
  }>;
  fieldTrust: Array<{
    fieldKey: string;
    checks: number;
    matches: number;
    conflicts: number;
    disagreementRate: number | null;
    confidenceScore: number | null;
  }>;
  policies: Array<{
    schemaId: string;
    fieldKey: string;
    preferredSource: string;
    officialKey: string | null;
    teamIndexed: boolean;
    enabled: boolean;
  }>;
  sourceHealth: Array<{
    source: string;
    status: string;
    consecutiveFailures: number;
    lastSuccessAt: string | null;
    updatedAt: string;
  }>;
  coverage: Array<{
    matchKey: string;
    matchNumber: number;
    compLevel: string;
    teamKey: string;
    assignmentCount: number;
    entryCount: number;
    state: "missing" | "assigned" | "covered" | "double_covered";
  }>;
  leaderboard: Array<{
    userId: string;
    name: string;
    entries: number;
    checks: number;
    matches: number;
    conflicts: number;
    accuracy: number | null;
  }>;
  myInfluence: InfluenceRow[];
  mySeat: StrategySeat | null;
  strategySeats: StrategySeat[];
};

const percent = (value: number | null) => (value == null ? "No checks" : `${Math.round(value * 100)}%`);

function teamLabel(row: InfluenceRow) {
  if (row.teamNumber != null) {
    return row.nickname ? `${row.teamNumber} · ${row.nickname}` : String(row.teamNumber);
  }
  return row.teamKey.replace(/^frc/i, "") || row.teamKey;
}

export default function ScoutingTrustPanel({
  orgId,
  eventKey,
}: {
  orgId: string;
  eventKey: string | null;
}) {
  const [view, setView] = useState<TrustView | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ orgId });
    if (eventKey) params.set("eventKey", eventKey);
    const response = await fetch(`/api/scouting/trust?${params}`);
    const data = (await response.json()) as TrustView & { error?: string };
    if (response.ok) {
      setView({
        ...data,
        myInfluence: data.myInfluence ?? [],
        mySeat: data.mySeat ?? null,
        strategySeats: data.strategySeats ?? [],
      });
      setMessage("");
    } else setMessage(data.error ?? "Could not load scouting trust.");
  }, [eventKey, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      const response = await fetch("/api/scouting/trust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, eventKey: view?.eventKey, ...payload }),
      });
      const data = (await response.json()) as TrustView & { error?: string };
      setBusy(false);
      if (response.ok) {
        setView({
          ...data,
          myInfluence: data.myInfluence ?? [],
          mySeat: data.mySeat ?? null,
          strategySeats: data.strategySeats ?? [],
        });
        setMessage(
          payload.action === "seat-top-accurate"
            ? "Top accurate scouts seated in the pick-desk conversation."
            : "Scouting trust plan updated.",
        );
      } else setMessage(data.error ?? "Could not update scouting trust.");
    },
    [orgId, view?.eventKey],
  );

  const gaps = useMemo(() => view?.coverage.filter((cell) => cell.state === "missing") ?? [], [view]);
  const assignedWaiting = useMemo(
    () => view?.coverage.filter((cell) => cell.state === "assigned") ?? [],
    [view],
  );
  const covered = useMemo(() => view?.coverage.filter((cell) => cell.entryCount > 0) ?? [], [view]);
  const latestMatchSchema = view?.schemaBudgets.find((schema) => schema.type === "match");

  if (!view) {
    return (
      <Panel>
        <p className="app-muted">{message || "Loading trust and coverage…"}</p>
      </Panel>
    );
  }
  if (!view.eventKey) {
    return (
      <EmptyState
        title="Set active event"
        description="Trust checks and coverage are event-specific. Choose the event in Event day first."
      />
    );
  }

  const degraded = view.sourceHealth.filter((source) => source.status !== "healthy");

  return (
    <div className="scout-trust">
      {message ? (
        <p className="form-message" role="status">
          {message}
        </p>
      ) : null}
      {degraded.length ? (
        <section className="scout-degraded" role="status">
          <strong>Reference data degraded</strong>
          <span>
            Strategy and scouting remain available from the last-good cache.{" "}
            {degraded
              .map((source) => `${degradedModeSourceLabel(source.source)}: ${degradedModeReasonLabel(source.status)}`)
              .join(" · ")}
          </span>
        </section>
      ) : null}

      <section className="scout-trust-kpis">
        <article>
          <span>Coverage gaps</span>
          <strong>{gaps.length}</strong>
          <small>no assignment or entry</small>
        </article>
        <article>
          <span>Assigned, waiting</span>
          <strong>{assignedWaiting.length}</strong>
          <small>scout has the row</small>
        </article>
        <article>
          <span>Covered rows</span>
          <strong>{covered.length}</strong>
          <small>{view.coverage.length ? percent(covered.length / view.coverage.length) : "No schedule"}</small>
        </article>
        <article>
          <span>Fields checked</span>
          <strong>{view.fieldTrust.reduce((sum, field) => sum + field.checks, 0)}</strong>
          <small>against official results</small>
        </article>
      </section>

      <section className="scout-trust-grid">
        <Panel className="scout-coverage">
          <header>
            <div>
              <span className="eyebrow">LIVE COVERAGE</span>
              <h2>Every robot, every match</h2>
            </div>
            {view.canManage ? (
              <div>
                <Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate({ action: "auto-assign", maximumConsecutiveMatches: 3 })}>
                  Balance shifts
                </Button>
                <Button variant="secondary" type="button" disabled={busy || !gaps.length} onClick={() => void mutate({ action: "nudge-gaps", message: `${gaps.length} scouting rows are uncovered at ${view.eventKey}.`, }) }>
                  Nudge coordinator
                </Button>
              </div>
            ) : null}
          </header>
          <div className="coverage-board">
            {view.coverage.slice(0, 72).map((cell) => (
              <article key={`${cell.matchKey}-${cell.teamKey}`} className={cell.state}>
                <b>
                  {cell.compLevel.toUpperCase()} {cell.matchNumber}
                </b>
                <span>{cell.teamKey.replace(/^frc/, "")}</span>
                <small>
                  {cell.state.replaceAll("_", " ")}
                  {cell.entryCount > 1 ? ` · ${cell.entryCount} scouts` : ""}
                </small>
              </article>
            ))}
          </div>
          {!view.coverage.length ? (
            <p className="app-muted">
              The synced match schedule is empty. Last-good data will appear here when official matches are available.
            </p>
          ) : null}
        </Panel>

        <aside className="scout-trust-side">
          <Panel>
            <span className="eyebrow">YOUR DATA&apos;S IMPACT</span>
            <h2>Where your scouting went</h2>
            {view.myInfluence.length ? (
              view.myInfluence.map((item) => (
                <article className="impact-row" key={`${item.entryId}-${item.recordedAt}`}>
                  <strong>
                    {item.matchKey ? `${item.matchKey} · ` : ""}
                    {teamLabel(item)}
                  </strong>
                  <p>{item.reason || "Used in the team's alliance-selection record."}</p>
                  <small className="app-muted">
                    {item.pickListName ? `${item.pickListName} · ` : ""}
                    {new Date(item.recordedAt).toLocaleString()}
                  </small>
                </article>
              ))
            ) : (
              <p className="app-muted">
                After coaches save a pick list, entries you scouted for listed teams show up here with the
                exact reason they were picked.
              </p>
            )}
            <Button as="a" variant="secondary" href={`/strategy?orgId=${encodeURIComponent(orgId)}&tab=picks`}>
              Open pick desk
            </Button>
          </Panel>

          <Panel>
            <span className="eyebrow">STRATEGY MEETING SEATS</span>
            <h2>Pick-desk conversation</h2>
            {view.mySeat ? (
              <article className="impact-row">
                <strong>You are seated · {view.mySeat.meetingOn}</strong>
                <p>{view.mySeat.reason}</p>
              </article>
            ) : (
              <p className="app-muted">
                Accuracy vs official scores earns a rotating seat so scouts see their product used at alliance selection.
              </p>
            )}
            {view.strategySeats.length ? (
              <ol className="accuracy-list">
                {view.strategySeats.slice(0, 8).map((seat) => (
                  <li key={`${seat.userId}-${seat.meetingOn}`}>
                    <b>{seat.name}</b>
                    <span>{seat.meetingOn}</span>
                    <strong>{seat.reason}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="app-muted">No seats assigned for this event yet.</p>
            )}
            {view.canManage ? (
              <Button variant="primary" type="button" disabled={busy} onClick={() => void mutate({ action: "seat-top-accurate", seatCount: 3 })}>
                Seat top accurate scouts
              </Button>
            ) : null}
          </Panel>
        </aside>
      </section>

      <ScoutingReconciliationPanel orgId={orgId} eventKey={view.eventKey} />

      <section className="scout-trust-grid lower">
        <Panel>
          <span className="eyebrow">FIELD CONFIDENCE</span>
          <h2>Slow down where the team disagrees</h2>
          <div className="field-trust-list">
            {view.fieldTrust.map((field) => (
              <article key={field.fieldKey}>
                <div>
                  <strong>{field.fieldKey}</strong>
                  <span>
                    {field.conflicts} conflicts across {field.checks} official checks
                  </span>
                </div>
                <b className={(field.disagreementRate ?? 0) >= 0.18 ? "warn" : ""}>
                  {percent(field.disagreementRate)}
                  <small>disagreement</small>
                </b>
              </article>
            ))}
            {!view.fieldTrust.length ? (
              <p className="app-muted">
                Official field checks begin automatically when official score breakdowns are published.
              </p>
            ) : null}
          </div>
        </Panel>
        <Panel>
          <span className="eyebrow">ACCURACY LEADERBOARD</span>
          <h2>Quality before volume</h2>
          <ol className="accuracy-list">
            {view.leaderboard.map((scout) => (
              <li key={scout.userId}>
                <b>{scout.name}</b>
                <span>
                  {scout.entries} entries · {scout.checks} checked
                </span>
                <strong>{percent(scout.accuracy)}</strong>
              </li>
            ))}
          </ol>
          {!view.leaderboard.length ? <p className="app-muted">No event entries yet.</p> : null}
        </Panel>
      </section>

      {latestMatchSchema && view.canManage ? (
        <Panel>
          <span className="eyebrow">PER-FIELD SOURCE POLICY</span>
          <h2>Choose what wins when sources disagree</h2>
          <div className="source-policy-grid">
            {latestMatchSchema.fields.map((field) => {
              const policy = view.policies.find(
                (item) => item.schemaId === latestMatchSchema.schemaId && item.fieldKey === field.key,
              );
              return (
                <label key={field.key}>
                  <span>
                    {field.label}
                    <small>{field.key}</small>
                  </span>
                  <select
                    defaultValue={policy?.preferredSource ?? "consensus"}
                    disabled={busy}
                    onChange={(event) =>
                      void mutate({
                        action: "set-policy",
                        schemaId: latestMatchSchema.schemaId,
                        fieldKey: field.key,
                        preferredSource: event.target.value,
                        officialKey: policy?.officialKey,
                        teamIndexed: policy?.teamIndexed ?? false,
                        enabled: true,
                      })
                    }
                  >
                    <option value="consensus">Scout consensus</option>
                    <option value="scout">Scout data</option>
                    <option value="tba">Official score</option>
                    <option value="statbotics">Season rating</option>
                  </select>
                </label>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {view.canManage ? (
        <Panel>
          <span className="eyebrow">FORM ACCURACY BUDGET</span>
          {view.schemaBudgets.map((schema) => (
            <article className="schema-budget" key={schema.schemaId}>
              <div>
                <strong>{schema.title}</strong>
                <span>
                  {schema.year} · {schema.type} · v{schema.version}
                </span>
              </div>
              <b className={schema.status}>
                {schema.fieldCount}/{schema.recommendedMaximum}
              </b>
              <p>{schema.message}</p>
            </article>
          ))}
          <div className="scout-inline-actions">
            <Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate({ action: "clone-previous", type: "match", targetYear: new Date().getFullYear() }) }>
              Clone last match form
            </Button>
            <Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate({ action: "clone-previous", type: "pit", targetYear: new Date().getFullYear() }) }>
              Clone last pit form
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
