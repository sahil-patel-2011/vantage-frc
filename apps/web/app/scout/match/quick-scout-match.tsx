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
import { answersToSave, hasObservation } from "../../../lib/scouting/entry-answers";
import { firstInvalidField, invalidFieldKeys } from "../../../lib/scouting/invalid-fields";
import {
  clearScoutDraft,
  formatDraftSavedAgo,
  readScoutClock,
  rememberActiveScoutDraft,
  scoutDraftStorageKey,
  writeScoutClock,
  writeScoutDraft,
} from "../../../lib/scouting/draft-autosave";
import { liveClockReadout, rebuiltShiftAt, timingForSeason } from "../../../lib/scouting/match-clock";
import type { RobotFormChoice } from "../../../lib/scouting/robot-form";
import { useOnline } from "../../../lib/offline/use-online";
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
import type { Bootstrap } from "../../scouting/scouting-model";
import { CapturePad, QuickTile } from "./quick-scout-tiles";
import { QuickScoutReview } from "./quick-scout-review";

export type QuickSaved = { matchKey: string; teamKey: string; clientId: string };

export const EDITING_NOTE = "You scouted this robot already. Saving replaces your earlier report.";
export const NOTHING_RECORDED_NOTE =
  "Nothing recorded yet. Count or answer at least one thing, or tap “Saw none · 0” for counts you watched. To skip this robot, tap its number at the top.";

/** The notes a robot opens with: already filed, the form changed, answers restored. */
function openingNotes(form: Extract<RobotFormChoice, { kind: "ready" }>): string | null {
  const notes = [
    form.editing ? EDITING_NOTE : null,
    form.note,
    form.from === "draft" && !form.note && !form.editing && form.draftSavedAt
      ? `Your answers are back. ${formatDraftSavedAgo(form.draftSavedAt)}.`
      : null,
  ].filter(Boolean);
  return notes.length ? notes.join(" ") : null;
}

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
  form,
  matchKey,
  teamKey,
  ownTeamKey = null,
  fullFormHref,
  onSaved,
  onChangeRobot,
}: {
  orgId: string;
  data: Bootstrap;
  /** The form this robot opens on and its starting answers (lib/scouting/robot-form.ts). */
  form: Extract<RobotFormChoice, { kind: "ready" }>;
  matchKey: string;
  teamKey: string;
  /** Our own robot, which the drive team already knows. */
  ownTeamKey?: string | null;
  fullFormHref: string;
  onSaved(saved: QuickSaved): void;
  onChangeRobot(): void;
}) {
  const schema: ScoutSchema = form.schema;
  const online = useOnline();
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
  // it), else blank with the seat filled in from the schedule. A draft started on an older
  // version of the form opens on that version (lib/scouting/robot-form.ts).
  const [initial] = useState(() => ({
    payload: form.payload ?? scheduleAnswers(fields, {}, station),
    confidence: form.confidence,
    clientId: form.clientId ?? stableClientId(),
    editing: form.editing,
  }));
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
  /** The question a failed save took the scout to; scrolled into view once its stage renders. */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(() => openingNotes(form));
  const savingRef = useRef(false);

  const visible = useMemo(() => visibleFields(fields, payload), [fields, payload]);
  const stages = useMemo(() => stagesWithFields(visible), [visible]);

  // After a failed save switches stage, bring the first question to fix into view.
  useEffect(() => {
    if (!focusKey) return;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-quick-field="${CSS.escape(focusKey)}"]`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      target?.querySelector<HTMLElement>("button:not([disabled]),input:not([disabled]),select:not([disabled])")?.focus({ preventScroll: true });
      setFocusKey(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey, stage]);
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
    // A blank report counts this robot as scouted on the lead's board with nothing in it.
    if (!hasObservation(answers)) {
      setIssues([]);
      setMessage(NOTHING_RECORDED_NOTE);
      return;
    }
    const problems = validatePayload(schema.definition, answers);
    setIssues(problems);
    if (problems.length) {
      setMessage(`Not saved yet. ${problems.slice(0, 2).join(". ")}.`);
      // Take the scout to the first question that needs them, on whatever stage it lives,
      // instead of leaving a list of problems at the top of the review.
      const first = firstInvalidField(fields, problems);
      const home = first ? stages.find((candidate) => candidate !== "review" && fieldsForQuickStage(visible, candidate).some((field) => field.key === first.key)) : undefined;
      if (first && home) {
        setStage(home);
        setFocusKey(first.key);
      }
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
  const invalidKeys = invalidFieldKeys(fields, issues);
  // A red count on each stage that still has a question to fix.
  const invalidByStage = new Map<QuickStage, number>();
  if (invalidKeys.size) {
    for (const candidate of stages) {
      if (candidate === "review") continue;
      const count = fieldsForQuickStage(visible, candidate).filter((field) => invalidKeys.has(field.key)).length;
      if (count) invalidByStage.set(candidate, count);
    }
  }
  const readout = elapsed === null ? null : liveClockReadout(elapsed, timing, clockRunning ? shift : null);

  return (
    <div className={`qs-match is-${stage}${station ? ` is-${station.alliance}` : ""}`}>
      <header className="qs-bar">
        <button type="button" className="qs-bar-robot" onClick={onChangeRobot} aria-label="Change robot">
          <strong>{context?.teamNumber ?? teamKey.replace(/^frc/, "")}</strong>
          {/* Match and seat on their own lines, so a long shift label never cuts off "Red 1". */}
          <span>{context?.matchLabel ?? "Change robot"}</span>
          {context?.stationLabel ? <span className="qs-bar-seat">{context.stationLabel}</span> : null}
        </button>
        <div className="qs-clock" aria-live="off">
          {readout === null ? (
            <span className="qs-clock-idle">Clock not started</span>
          ) : (
            <>
              <strong>{readout.big}</strong>
              <span>{readout.label}</span>
              {readout.left ? <small>{readout.left}</small> : null}
            </>
          )}
        </div>
        <button type="button" className="qs-undo" onClick={undo} disabled={!canUndo} aria-label="Undo last tap">
          <span aria-hidden="true">↶</span> Undo
        </button>
      </header>

      {online ? null : (
        <p className="qs-signal" role="status">
          No signal · keep scouting. This match saves on this phone and sends when the signal is back.
        </p>
      )}
      {ownTeamKey && teamKey === ownTeamKey ? (
        <p className="qs-message" role="note">
          This is your own team’s robot. Your drive team already knows how it played, so scout it only if your lead asked you to.
        </p>
      ) : null}

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
            {invalidByStage.get(candidate) ? (
              <span className="qs-stage-issues" aria-label={`(${invalidByStage.get(candidate)} to fix)`}>
                {invalidByStage.get(candidate)}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {message ? (
        <p className="qs-message" role="status">
          {message}
        </p>
      ) : null}

      <section className="qs-stage" aria-label={QUICK_STAGE_LABELS[stage]}>
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
              {/* A second Undo where the thumb is; the one in the header is a reach on a tall phone. */}
              <div className="qs-live-foot-row">
                <button type="button" className="qs-undo" onClick={undo} disabled={!canUndo} aria-label="Undo last tap">
                  <span aria-hidden="true">↶</span> Undo
                </button>
                <button type="button" className="qs-secondary" onClick={() => setStage("review")}>
                  Match over · last questions
                </button>
              </div>
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
      </section>
    </div>
  );
}
