"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CaptureKind, ScoutSchema, SyncEntry } from "@vantage/scouting";
import {
  activeCaptureBout,
  matchCapture,
  recordScoutAction,
  undoableScoutAction,
  undoScoutAction,
  validatePayload,
} from "@vantage/scouting";
import { isScoutIdentityField } from "@vantage/scouting/identity";
import { visibleFields, withInferredPhaseRules } from "../../../lib/scouting/context-visible";
import { answersToSave } from "../../../lib/scouting/entry-answers";
import {
  clearScoutDraft,
  readScoutClock,
  readScoutDraft,
  rememberActiveScoutDraft,
  scoutDraftStorageKey,
  writeScoutClock,
  writeScoutDraft,
} from "../../../lib/scouting/draft-autosave";
import { clockLabel, phaseRemainingSeconds, rebuiltShiftAt, timingForSeason } from "../../../lib/scouting/match-clock";
import {
  QUICK_STAGE_LABELS,
  STATION_FIELD_KEY,
  fieldsForQuickStage,
  stationAnswer,
  matchLengthMs,
  pushUndo,
  scheduleAnswers,
  stageForClock,
  stagesWithFields,
  stepCounter,
  stopCaptureAction,
  toggleCaptureAction,
  voidCaptureAction,
  type QuickStage,
  type QuickUndo,
} from "../../../lib/scouting/quick-scout";
import { robotStation, scoutContext } from "../../../lib/scouting/scout-context";
import { queueEntry, stableClientId } from "../../../lib/scout-offline";
import { myReports, type Bootstrap } from "../../scouting/scouting-model";
import { CapturePad, QuickTile } from "./quick-scout-tiles";
import { QuickScoutReview } from "./quick-scout-review";

export type QuickSaved = { matchKey: string; teamKey: string; clientId: string };

function seasonOf(data: Bootstrap, schema: ScoutSchema): number | null {
  const fromEvent = Number(/^(\d{4})/.exec(data.eventKey ?? "")?.[1]);
  return Number.isFinite(fromEvent) && fromEvent > 2000 ? fromEvent : schema.year ?? null;
}

const identity = () => ({ id: crypto.randomUUID(), at: new Date().toISOString() });

/**
 * One robot, start to save. The screen shows only the stage the match is in; the clock
 * the scout starts with the field moves it along, and the stage pills move it by hand.
 */
export function QuickScoutMatch({
  orgId,
  data,
  schema,
  matchKey,
  teamKey,
  fullFormHref,
  onSaved,
  onChangeRobot,
}: {
  orgId: string;
  data: Bootstrap;
  schema: ScoutSchema;
  matchKey: string;
  teamKey: string;
  fullFormHref: string;
  onSaved(saved: QuickSaved): void;
  onChangeRobot(): void;
}) {
  const match = (data.matches ?? []).find((candidate) => candidate.matchKey === matchKey);
  const station = robotStation(match, teamKey);
  const context = scoutContext({ matches: data.matches ?? [], matchKey, teamKey });
  const season = seasonOf(data, schema);
  const timing = useMemo(() => timingForSeason(season), [season]);
  const timesActions = season === 2026;
  const draftKey = scoutDraftStorageKey({
    userId: data.scoutIdentity?.userId,
    orgId,
    eventKey: data.eventKey ?? "",
    entryType: "match",
    matchKey,
    teamKey,
  });

  const fields = useMemo(
    () => withInferredPhaseRules(schema.definition.fields.filter((field) => !isScoutIdentityField(field))),
    [schema],
  );

  // Where the answers start: this phone's draft, else your own saved report (Save replaces
  // it), else blank with the seat filled in from the schedule.
  const [initial] = useState(() => {
    const draft = readScoutDraft(draftKey);
    if (draft && (!draft.schemaId || draft.schemaId === schema.id)) {
      return { payload: draft.payload, confidence: draft.confidence, clientId: draft.clientId ?? stableClientId(), editing: false, restored: true };
    }
    const earlier = myReports(data).find(
      (entry) => entry.type === "match" && entry.matchKey === matchKey && entry.teamKey === teamKey,
    );
    if (earlier?.payload && (!earlier.schemaId || earlier.schemaId === schema.id)) {
      return {
        payload: earlier.payload,
        confidence: (["high", "normal", "low"].includes(earlier.confidence) ? earlier.confidence : "normal") as "high" | "normal" | "low",
        clientId: earlier.clientId ?? stableClientId(),
        editing: true,
        restored: false,
      };
    }
    return { payload: scheduleAnswers(fields, {}, station), confidence: "normal" as const, clientId: stableClientId(), editing: false, restored: false };
  });
  const [payload, setPayload] = useState<Record<string, unknown>>(initial.payload);
  const [confidence, setConfidence] = useState<"high" | "normal" | "low">(initial.confidence);
  const [dirty, setDirty] = useState(false);
  const [undoStack, setUndoStack] = useState<QuickUndo[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(() => readScoutClock(draftKey));
  const [now, setNow] = useState(() => Date.now());
  const elapsed = startedAt === null ? null : Math.max(0, now - startedAt);
  const clockStage = stageForClock(elapsed, timing);
  const [stage, setStage] = useState<QuickStage>(() => (startedAt === null ? (initial.editing ? "review" : "pre") : clockStage));
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(initial.editing ? "You scouted this robot already. Saving replaces your earlier report." : null);
  const savingRef = useRef(false);

  const visible = useMemo(() => visibleFields(fields, payload), [fields, payload]);
  const stages = useMemo(() => stagesWithFields(visible), [visible]);
  const running = activeCaptureBout(matchCapture(payload));
  const matchEnd = matchLengthMs(timing);
  const clockRunning = elapsed !== null && elapsed < matchEnd;

  // The clock ticks only while the match runs.
  useEffect(() => {
    if (startedAt === null) return;
    if (Date.now() - startedAt >= matchEnd) {
      setNow(Date.now());
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [startedAt, matchEnd]);

  // Follow the field: when the clock crosses into a new stage, show it. A stage picked by
  // hand stays until the next boundary.
  const lastClockStage = useRef(clockStage);
  useEffect(() => {
    if (lastClockStage.current === clockStage) return;
    lastClockStage.current = clockStage;
    if (startedAt === null) return;
    setStage(clockStage);
    if (clockStage === "review") setPayload((current) => stopCaptureAction(current, matchEnd));
  }, [clockStage, startedAt, matchEnd]);

  // Keep the draft on this phone after every change, so a closed tab or a dead battery
  // loses nothing. The full Scout form opens the same draft.
  useEffect(() => {
    if (!dirty || !draftKey) return;
    const savedAt = writeScoutDraft(draftKey, {
      payload,
      confidence,
      matchKey,
      teamKey,
      clientId: initial.clientId,
      schemaId: schema.id,
      schema,
      source: "manual",
    });
    if (savedAt && data.scoutIdentity?.userId && data.eventKey) {
      rememberActiveScoutDraft(
        { userId: data.scoutIdentity.userId, orgId, eventKey: data.eventKey },
        { key: draftKey, type: "match", matchKey, teamKey },
      );
    }
  }, [dirty, draftKey, payload, confidence, matchKey, teamKey, initial.clientId, schema, data.scoutIdentity?.userId, data.eventKey, orgId]);

  // Every tap is computed from the latest answers, so fast taps never overwrite each other,
  // and a tap that changes nothing (minus on a blank count) leaves nothing to undo.
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const change = useCallback((key: string, compute: (current: unknown) => unknown) => {
    const before = payloadRef.current[key];
    const value = compute(before);
    const blank = value === undefined || value === null || value === "";
    if (JSON.stringify(blank ? undefined : value) === JSON.stringify(before ?? undefined)) return;
    const stamp = identity();
    setPayload((current) => {
      const next = { ...current };
      if (blank) delete next[key];
      else next[key] = value;
      const recorded = recordScoutAction(current, next, stamp);
      payloadRef.current = recorded;
      return recorded;
    });
    setUndoStack((stack) => pushUndo(stack, { kind: "answer" }));
    setIssues([]);
    setDirty(true);
  }, []);
  const answer = useCallback((key: string, value: unknown) => change(key, () => value), [change]);

  function step(key: string, delta: number) {
    const field = fields.find((candidate) => candidate.key === key);
    if (field) change(key, (current) => stepCounter(field, current, delta));
  }

  function startClock() {
    const at = Date.now();
    setStartedAt(at);
    setNow(at);
    writeScoutClock(draftKey, at);
    lastClockStage.current = "auto";
    setStage("auto");
    setDirty(true);
  }

  function restartClock() {
    setStartedAt(null);
    writeScoutClock(draftKey, null);
    lastClockStage.current = "pre";
    setStage("pre");
  }

  function action(kind: CaptureKind) {
    if (startedAt === null || elapsed === null) return;
    const id = crypto.randomUUID();
    try {
      const result = toggleCaptureAction(payloadRef.current, { kind, id, elapsedMs: Date.now() - startedAt, clockStartedAt: startedAt });
      payloadRef.current = result.payload;
      setPayload(result.payload);
      const started = result.started;
      if (started) setUndoStack((stack) => pushUndo(stack, { kind: "action", id: started }));
      setDirty(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That action could not be recorded.");
    }
  }

  function stopAction() {
    if (startedAt === null) return;
    const next = stopCaptureAction(payloadRef.current, Date.now() - startedAt);
    payloadRef.current = next;
    setPayload(next);
    setDirty(true);
  }

  const canUndo = undoStack.length > 0 || Boolean(undoableScoutAction(payload));
  function undo() {
    const last = undoStack[undoStack.length - 1];
    setUndoStack((stack) => stack.slice(0, -1));
    if (last?.kind === "action") setPayload((current) => voidCaptureAction(current, last.id));
    else {
      const stamp = identity();
      setPayload((current) => undoScoutAction(current, stamp));
    }
    setIssues([]);
    setDirty(true);
  }

  async function save() {
    if (savingRef.current || !data.eventKey) return;
    const closed = elapsed === null ? payload : stopCaptureAction(payload, elapsed);
    const answers = answersToSave(schema.definition.fields, closed);
    const problems = validatePayload(schema.definition, answers);
    setIssues(problems);
    if (problems.length) {
      setMessage(`Not saved yet. ${problems.slice(0, 2).join(". ")}.`);
      return;
    }
    const entry: SyncEntry = {
      clientId: initial.clientId,
      orgId,
      type: "match",
      eventKey: data.eventKey,
      matchKey,
      teamKey,
      schemaId: schema.id,
      payload: answers,
      confidence,
      source: "manual",
      updatedAt: new Date().toISOString(),
    };
    savingRef.current = true;
    setSaving(true);
    try {
      await queueEntry(entry);
    } catch (error) {
      setMessage(error instanceof Error ? `Not saved yet. ${error.message}` : "Not saved yet. This device could not store it; keep this screen open and try again.");
      savingRef.current = false;
      setSaving(false);
      return;
    }
    clearScoutDraft(draftKey);
    savingRef.current = false;
    setSaving(false);
    onSaved({ matchKey, teamKey, clientId: initial.clientId });
  }

  const shift = timesActions ? rebuiltShiftAt(elapsed, station?.alliance ?? null, matchCapture(payload)?.firstInactiveAlliance ?? "unknown") : null;
  const live = stage === "auto" || stage === "teleop" || stage === "endgame";
  // The seat the schedule already filled is in the header ("Red 2"); asking again is noise.
  const stageFields = stage === "review" ? [] : fieldsForQuickStage(visible, stage).filter(
    (field) => !(field.key === STATION_FIELD_KEY && station && payload[field.key] === stationAnswer(field, station)),
  );
  const invalidKeys = new Set(
    fields.filter((field) => issues.some((issue) => issue.startsWith(field.label))).map((field) => field.key),
  );

  return (
    <div className={`qs-match is-${stage}${station ? ` is-${station.alliance}` : ""}`}>
      <header className="qs-bar">
        <button type="button" className="qs-bar-robot" onClick={onChangeRobot} aria-label="Change robot">
          <strong>{context?.teamNumber ?? teamKey.replace(/^frc/, "")}</strong>
          <span>{[context?.matchLabel, context?.stationLabel].filter(Boolean).join(" · ") || "Change robot"}</span>
        </button>
        <div className="qs-clock" aria-live="off">
          {elapsed === null ? (
            <span className="qs-clock-idle">Clock not started</span>
          ) : (
            <>
              <strong>{clockRunning ? `${phaseRemainingSeconds(elapsed, timing)}s` : "Done"}</strong>
              <span>{shift && clockRunning ? `${shift.label}${shift.hub !== "unknown" ? ` · hub ${shift.hub}` : ""}` : clockLabel(Math.min(elapsed, matchEnd))}</span>
            </>
          )}
        </div>
        <button type="button" className="qs-undo" onClick={undo} disabled={!canUndo} aria-label="Undo last tap">
          <span aria-hidden="true">↶</span> Undo
        </button>
      </header>

      <nav className="qs-stages" aria-label="Match stage">
        {stages.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={candidate === stage ? "is-on" : undefined}
            aria-current={candidate === stage ? "step" : undefined}
            onClick={() => setStage(candidate)}
          >
            {QUICK_STAGE_LABELS[candidate]}
            {candidate === clockStage && clockRunning ? <span className="qs-live-dot" aria-label="(now)" /> : null}
          </button>
        ))}
      </nav>

      {message ? (
        <p className="qs-message" role="status">
          {message}
        </p>
      ) : null}

      <main className="qs-stage" aria-label={QUICK_STAGE_LABELS[stage]}>
        {stage === "pre" ? (
          <div className="qs-pre">
            <div className="qs-start-card">
              <p>Tap when the match starts. The screen follows the field from there.</p>
              <button type="button" className="qs-start" onClick={startClock}>
                <span aria-hidden="true">▶</span> Start match
              </button>
              <button type="button" className="qs-link" onClick={() => setStage(stages.find((candidate) => candidate !== "pre") ?? "review")}>
                Scout without the clock
              </button>
            </div>
            {stageFields.length ? (
              <div className="qs-grid">
                {stageFields.map((field) => (
                  <QuickTile
                    key={field.key}
                    field={field}
                    value={payload[field.key]}
                    orgId={orgId}
                    invalid={invalidKeys.has(field.key)}
                    onChange={(value) => answer(field.key, value)}
                    onStep={(delta) => step(field.key, delta)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {live ? (
          <>
            {timesActions ? (
              <CapturePad running={running?.kind ?? null} clockRunning={clockRunning} onStart={action} onStop={stopAction} />
            ) : null}
            {stageFields.length ? (
              <div className="qs-grid">
                {stageFields.map((field) => (
                  <QuickTile
                    key={field.key}
                    field={field}
                    value={payload[field.key]}
                    orgId={orgId}
                    invalid={invalidKeys.has(field.key)}
                    onChange={(value) => answer(field.key, value)}
                    onStep={(delta) => step(field.key, delta)}
                  />
                ))}
              </div>
            ) : (
              <p className="qs-empty">Nothing to count in {QUICK_STAGE_LABELS[stage].toLowerCase()} on your team’s form.</p>
            )}
            <div className="qs-live-foot">
              {elapsed !== null && clockRunning && !(matchCapture(payload)?.bouts.length) ? (
                <button type="button" className="qs-link" onClick={restartClock}>
                  Started too early? Restart the clock
                </button>
              ) : null}
              <button type="button" className="qs-secondary" onClick={() => setStage("review")}>
                Match over · answer the last questions
              </button>
            </div>
          </>
        ) : null}

        {stage === "review" ? (
          <QuickScoutReview
            orgId={orgId}
            fields={visible}
            payload={payload}
            confidence={confidence}
            issues={issues}
            saving={saving}
            capture={matchCapture(payload)}
            fullFormHref={fullFormHref}
            onAnswer={answer}
            onStep={step}
            onConfidence={(value) => {
              setConfidence(value);
              setDirty(true);
            }}
            onJump={(next) => setStage(next)}
            onSave={() => void save()}
          />
        ) : null}
      </main>
    </div>
  );
}
