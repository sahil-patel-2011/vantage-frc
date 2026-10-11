"use client";

import type { CaptureKind, FieldDefinition } from "@vantage/scouting";
import { Field } from "../../scouting/scouting-field";
import { optionLabel, quickTileKind } from "../../../lib/scouting/quick-scout";
import { HoldButton } from "./hold-button";

type TileProps = {
  field: FieldDefinition;
  value: unknown;
  orgId: string;
  invalid?: boolean;
  onChange(value: unknown): void;
  onStep(delta: number): void;
};

/** One question as the biggest control it allows. Anything that needs typing keeps the full field. */
export function QuickTile(props: TileProps) {
  const kind = quickTileKind(props.field);
  if (kind === "counter") return <CounterTile {...props} />;
  if (kind === "toggle") return <ToggleTile {...props} />;
  if (kind === "choice") return <ChoiceTile {...props} />;
  return (
    <div className={`qs-detail${props.invalid ? " is-invalid" : ""}`} data-quick-field={props.field.key}>
      <Field
        field={props.field}
        value={props.value}
        flags={[]}
        historyHint={null}
        disagreementRate={null}
        orgId={props.orgId}
        onChange={props.onChange}
      />
    </div>
  );
}

/**
 * The whole tile is the +1 button, so a scout can tap without looking. The minus sits in
 * the corner, away from the thumb. Blank shows a dash: "not counted" is not zero.
 */
function CounterTile({ field, value, invalid, onStep }: TileProps) {
  const count = typeof value === "number" && Number.isFinite(value) ? value : null;
  return (
    <div className={`qs-tile qs-counter${count !== null ? " has-value" : ""}${invalid ? " is-invalid" : ""}`} data-quick-field={field.key}>
      <button
        type="button"
        className="qs-counter-add"
        onClick={() => onStep(1)}
        aria-label={`${field.label}: ${count ?? "not counted"}. Add one`}
      >
        <span className="qs-tile-label">{field.label}</span>
        <span className="qs-counter-value" aria-hidden="true">
          {count ?? "—"}
        </span>
        <span className="qs-counter-hint" aria-hidden="true">
          Tap +1
        </span>
      </button>
      <button
        type="button"
        className="qs-counter-minus"
        onClick={() => onStep(-1)}
        disabled={count === null}
        aria-label={`${field.label}: take one away`}
      >
        −
      </button>
    </div>
  );
}

function ToggleTile({ field, value, invalid, onChange }: TileProps) {
  const on = value === true;
  return (
    <button
      type="button"
      className={`qs-tile qs-toggle${on ? " is-on" : ""}${value === false ? " is-off" : ""}${invalid ? " is-invalid" : ""}`}
      aria-pressed={on}
      data-quick-field={field.key}
      onClick={() => onChange(!on)}
    >
      <span className="qs-toggle-check" aria-hidden="true">
        {on ? "✓" : ""}
      </span>
      <span className="qs-tile-label">{field.label}</span>
      <small>{on ? "Yes" : value === false ? "No" : "Tap if it happened"}</small>
    </button>
  );
}

function ChoiceTile({ field, value, invalid, onChange }: TileProps) {
  const options = field.options ?? [];
  return (
    <fieldset className={`qs-tile qs-choice${invalid ? " is-invalid" : ""}`} data-quick-field={field.key}>
      <legend className="qs-tile-label">
        {field.label}
        {field.required ? <span className="qs-required"> · required</span> : null}
      </legend>
      <div className="qs-choice-row" style={{ ["--qs-choices" as string]: String(Math.min(options.length, 4)) }}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={value === option ? "is-on" : undefined}
            aria-pressed={value === option}
            // Tapping the chosen answer again clears it, so a mis-tap is never stuck.
            onClick={() => onChange(value === option ? undefined : option)}
          >
            {optionLabel(option)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

const ACTIONS: Array<{ kind: CaptureKind; label: string; detail: string; icon: string }> = [
  { kind: "shooting", label: "Shooting", detail: "Hold while it shoots", icon: "◎" },
  { kind: "feeding", label: "Feeding", detail: "Hold while it passes", icon: "⇢" },
  { kind: "defending", label: "Defense", detail: "Hold while it defends", icon: "⛨" },
  { kind: "disabled", label: "Stopped", detail: "Hold while it is dead", icon: "⏻" },
];

/** 2026 timed actions: how long the robot spent doing each thing, against the match clock. */
export function CapturePad({
  running,
  clockRunning,
  onStart,
  onStop,
}: {
  running: CaptureKind | null;
  clockRunning: boolean;
  onStart(kind: CaptureKind): void;
  onStop(): void;
}) {
  return (
    <section className="qs-capture" aria-label="Timed actions">
      {ACTIONS.map((action) => (
        <HoldButton
          key={action.kind}
          tone={action.kind}
          active={running === action.kind}
          disabled={!clockRunning}
          label={action.label}
          detail={clockRunning ? action.detail : "Start the clock first"}
          icon={action.icon}
          onStart={() => onStart(action.kind)}
          onStop={onStop}
        />
      ))}
    </section>
  );
}
