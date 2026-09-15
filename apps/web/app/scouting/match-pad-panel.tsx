"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { Button, FormRow } from "../../components/ui";
import {
  MATCH_PAD_FIELD_HEIGHT,
  MATCH_PAD_FIELD_WIDTH,
  MATCH_PAD_PHASES,
  actionLabel,
  actionsForPhase,
  eventsFromPayload,
  pathFromPayload,
  pathFromTaps,
  payloadFromPad,
  phaseLabel,
  qualsFromInputs,
  scoresWhileMoving,
  serializePad,
  type MatchPadEvent,
  type MatchPadPayload,
  type MatchPadPhase,
  type MatchPadPoint,
  type MatchPadQuals,
} from "../../lib/scouting/match-pad";

const QUAL_RATINGS = [1, 2, 3, 4, 5] as const;

export type MatchPadApplyPayload = MatchPadPayload &
  MatchPadQuals & {
    matchPadEvents: MatchPadEvent[];
  };

export type MatchPadPanelProps = {
  matchKey?: string;
  teamKey?: string;
  initialPayload?: Record<string, unknown>;
  onApply?: (payload: MatchPadApplyPayload) => void;
};

function newEventId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pad-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function qualSelectValue(value: number | undefined): string {
  return value != null ? String(value) : "";
}

function fieldPointFromClick(event: MouseEvent<HTMLButtonElement>, tapIndex: number): MatchPadPoint | null {
  const svg = event.currentTarget.querySelector("svg");
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const x = ((event.clientX - rect.left) / rect.width) * MATCH_PAD_FIELD_WIDTH;
  const y = ((event.clientY - rect.top) / rect.height) * MATCH_PAD_FIELD_HEIGHT;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    t: tapIndex,
    x: Math.min(MATCH_PAD_FIELD_WIDTH, Math.max(0, x)),
    y: Math.min(MATCH_PAD_FIELD_HEIGHT, Math.max(0, y)),
  };
}

function pathPolyline(points: readonly MatchPadPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function MatchPadPanel({ matchKey, teamKey, initialPayload, onApply }: MatchPadPanelProps) {
  const [phase, setPhase] = useState<MatchPadPhase>("auto");
  const [events, setEvents] = useState<MatchPadEvent[]>(() => eventsFromPayload(initialPayload));
  const [taps, setTaps] = useState<MatchPadPoint[]>(() => pathFromPayload(initialPayload) ?? []);
  const [note, setNote] = useState("");
  const [localMatch, setLocalMatch] = useState(matchKey ?? "");
  const [localTeam, setLocalTeam] = useState(teamKey ?? "");
  const [driverAbility, setDriverAbility] = useState(() =>
    qualSelectValue(qualsFromInputs({ driverAbility: initialPayload?.driverAbility }).driverAbility),
  );
  const [defenseEffectiveness, setDefenseEffectiveness] = useState(() =>
    qualSelectValue(
      qualsFromInputs({ defenseEffectiveness: initialPayload?.defenseEffectiveness }).defenseEffectiveness,
    ),
  );

  const parentHasIdentity = Boolean(matchKey) && Boolean(teamKey);
  const actions = useMemo(() => actionsForPhase(phase), [phase]);
  const moving = scoresWhileMoving(events);
  const quals = qualsFromInputs({ driverAbility, defenseEffectiveness });
  const path = pathFromTaps(taps);
  const canApply = events.length > 0 || path != null;

  function pushEvent(type: MatchPadEvent["type"], extra?: { note?: string }) {
    setEvents((current) => [
      ...current,
      {
        id: newEventId(),
        type,
        phase,
        at: new Date().toISOString(),
        ...(extra?.note ? { note: extra.note } : {}),
      },
    ]);
  }

  function applyPad() {
    if (!onApply || !canApply) return;
    onApply({
      ...payloadFromPad(events, path ? { path } : {}),
      ...quals,
      matchPadEvents: serializePad(events),
      ...(path ? { autoPath: path } : {}),
    });
  }

  return (
    <section className="match-pad" aria-labelledby="match-pad-heading">
      <header className="match-pad-heading">
        <div>
          <h3 id="match-pad-heading">Match pad</h3>
          <p className="app-muted">Tap what happened this phase. Save onto this match when the list is right.</p>
        </div>
        <p className="match-pad-moving" role="status">
          <span className="eyebrow">Scored while moving</span>
          <strong>{moving ? "Yes" : "No"}</strong>
        </p>
      </header>

      {parentHasIdentity ? null : (
        <div className="match-pad-identity">
          <FormRow label="Match">
            <input
              value={matchKey ?? localMatch}
              onChange={(event) => setLocalMatch(event.target.value)}
              placeholder="qm12"
              disabled={Boolean(matchKey)}
            />
          </FormRow>
          <FormRow label="Team">
            <input
              value={teamKey ?? localTeam}
              onChange={(event) => setLocalTeam(event.target.value)}
              placeholder="254"
              disabled={Boolean(teamKey)}
            />
          </FormRow>
        </div>
      )}

      <div className="match-pad-phases" role="tablist" aria-label="Match phase">
        {MATCH_PAD_PHASES.map((id) => (
          <Button
            key={id}
            type="button"
            variant={phase === id ? "primary" : "secondary"}
            className="qol-press"
            aria-pressed={phase === id}
            onClick={() => setPhase(id)}
          >
            {phaseLabel(id)}
          </Button>
        ))}
      </div>

      {phase === "auto" ? (
        <div className="match-pad-auto-path">
          <button
            type="button"
            className="match-pad-field qol-press"
            aria-label="Auto path field"
            onClick={(event) => {
              const point = fieldPointFromClick(event, taps.length);
              if (!point) return;
              setTaps((current) => [...current, point]);
            }}
          >
            <svg
              viewBox={`0 0 ${MATCH_PAD_FIELD_WIDTH} ${MATCH_PAD_FIELD_HEIGHT}`}
              role="img"
              aria-hidden
            >
              <rect
                x="0"
                y="0"
                width={MATCH_PAD_FIELD_WIDTH}
                height={MATCH_PAD_FIELD_HEIGHT}
                className="match-pad-field-floor"
              />
              <line
                x1={MATCH_PAD_FIELD_WIDTH / 2}
                y1="0"
                x2={MATCH_PAD_FIELD_WIDTH / 2}
                y2={MATCH_PAD_FIELD_HEIGHT}
                className="match-pad-field-half"
              />
              {path ? (
                <polyline points={pathPolyline(path)} fill="none" className="match-pad-field-line" />
              ) : null}
              {taps.map((point, index) => (
                <circle
                  key={`tap-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={0.8}
                  className="match-pad-field-dot"
                />
              ))}
            </svg>
          </button>
          {taps.length < 2 ? (
            <p className="match-pad-empty" role="status">
              Needs setup — no auto path yet.
            </p>
          ) : (
            <p className="app-muted">{taps.length} taps on this auto.</p>
          )}
          <Button
            type="button"
            variant="secondary"
            className="qol-press"
            disabled={taps.length === 0}
            onClick={() => setTaps((current) => current.slice(0, -1))}
          >
            Undo last path tap
          </Button>
        </div>
      ) : null}

      <div className="match-pad-actions">
        {actions.map((type) => (
          <Button
            key={type}
            type="button"
            variant="primary"
            size="lg"
            className="qol-press match-pad-action"
            onClick={() => pushEvent(type)}
          >
            {actionLabel(type)}
          </Button>
        ))}
      </div>

      <FormRow label="Note" hint="Optional. Notes stay on this list until you undo them.">
        <div className="match-pad-note-row">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What you saw"
          />
          <Button
            type="button"
            variant="secondary"
            className="qol-press"
            disabled={!note.trim()}
            onClick={() => {
              const text = note.trim();
              if (!text) return;
              pushEvent("note", { note: text });
              setNote("");
            }}
          >
            Add note
          </Button>
        </div>
      </FormRow>

      {events.length === 0 ? (
        <p className="match-pad-empty" role="status">
          Needs setup — no events yet.
        </p>
      ) : (
        <ol className="match-pad-events">
          {events.map((event) => (
            <li key={event.id}>
              <strong>{actionLabel(event.type)}</strong>
              <span>
                {phaseLabel(event.phase)}
                {event.note ? ` · ${event.note}` : ""}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="match-pad-quals">
        <FormRow
          label="Driver ability"
          hint="Optional. 1–5 only if you rated this match."
        >
          <select
            value={driverAbility}
            onChange={(event) => setDriverAbility(event.target.value)}
          >
            <option value="">Not set</option>
            {QUAL_RATINGS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow
          label="Defense effectiveness"
          hint="Optional. 1–5 only if you rated this match."
        >
          <select
            value={defenseEffectiveness}
            onChange={(event) => setDefenseEffectiveness(event.target.value)}
          >
            <option value="">Not set</option>
            {QUAL_RATINGS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </FormRow>
      </div>

      <div className="match-pad-toolbar">
        <Button
          type="button"
          variant="secondary"
          className="qol-press"
          disabled={events.length === 0}
          onClick={() => setEvents((current) => current.slice(0, -1))}
        >
          Undo last
        </Button>
        {onApply ? (
          <Button
            type="button"
            variant="primary"
            className="qol-press"
            disabled={!canApply}
            onClick={applyPad}
          >
            Save to this match
          </Button>
        ) : null}
      </div>
    </section>
  );
}
