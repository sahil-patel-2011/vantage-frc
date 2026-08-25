"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyCounterStep,
  applyMultiCounterStep,
  accumulateTimerLaps,
  counterConfig,
  fieldPositionCellLabel,
  fieldPositionCellCount,
  fieldPositionConfig,
  formatTimerSeconds,
  isFieldPositionCellAllowed,
  multiCounterConfig,
  multiCounterTotal,
  multiCounterValueOf,
  normalizeFieldPositionCells,
  normalizeTimerLaps,
  ratingConfig,
  sliderConfig,
  snapSliderValue,
  timerAverageLapSeconds,
  timerConfig,
  toggleFieldPositionCell,
  toggleRatingValue,
  type FieldDefinition,
} from "@vantage/scouting";

/**
 * Entry renderers for the scouting input studio.
 *
 * Every control here is built for a scout whose eyes are on the match, not the
 * tablet: huge tap targets, the number that matters rendered large, and a real
 * one-level undo on the controls where a mis-tap is expensive (counters and
 * timers). Nothing here fabricates a value — an untouched field stays undefined
 * so the payload never claims an observation that was not made.
 */

type FieldProps = {
  field: FieldDefinition;
  value: unknown;
  onChange(value: unknown): void;
};

/** One-level undo: remember the value before the last tap, and nothing more. */
function useOneLevelUndo(value: unknown) {
  const [undoValue, setUndoValue] = useState<unknown>(undefined);
  const [canUndo, setCanUndo] = useState(false);
  const latest = useRef(value);
  latest.current = value;

  const remember = useCallback(() => {
    setUndoValue(latest.current);
    setCanUndo(true);
  }, []);
  const clear = useCallback(() => setCanUndo(false), []);
  return { undoValue, canUndo, remember, clear };
}

export function StudioSectionHeader({ field }: { field: FieldDefinition }) {
  // A plain heading, deliberately NOT role="separator": ARIA gives separator
  // presentational children, which would strip the Auto / Teleop / Endgame
  // heading out of the accessibility tree — the one thing it exists to announce.
  return (
    <div className="scout-studio-section">
      <h3>{field.label}</h3>
      {field.helpText ? <p className="app-muted">{field.helpText}</p> : null}
    </div>
  );
}

function StudioShell({
  label,
  hint,
  headline,
  children,
}: {
  label: string;
  hint?: string | null;
  headline?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="scout-studio-field" aria-label={label}>
      <header className="scout-studio-head">
        <span className="scout-studio-label">{label}</span>
        {headline}
      </header>
      {children}
      {hint ? <small className="app-muted">{hint}</small> : null}
    </section>
  );
}

/* ------------------------------- counter --------------------------------- */

export function CounterField({ field, value, onChange, label }: FieldProps & { label: string }) {
  const config = useMemo(() => counterConfig(field), [field]);
  const { canUndo, undoValue, remember, clear } = useOneLevelUndo(value);
  const current = typeof value === "number" ? value : 0;

  function step(delta: number) {
    remember();
    onChange(applyCounterStep(value, delta, config));
  }

  return (
    <StudioShell
      label={label}
      hint={field.helpText ?? (config.max != null ? `Max ${config.max}` : undefined)}
      headline={
        <output className="scout-studio-readout" aria-live="polite">
          {current}
        </output>
      }
    >
      <div className="scout-counter-pad">
        <button
          type="button"
          className="scout-tap minus"
          aria-label={`Subtract 1 from ${label}`}
          onClick={() => step(-1)}
        >
          −1
        </button>
        {config.steps.map((amount) => (
          <button
            key={amount}
            type="button"
            className={`scout-tap plus${amount === config.steps[0] ? " primary" : ""}`}
            aria-label={`Add ${amount} to ${label}`}
            onClick={() => step(amount)}
          >
            +{amount}
          </button>
        ))}
      </div>
      <div className="scout-studio-actions">
        <button
          type="button"
          className="text-button"
          disabled={!canUndo}
          onClick={() => {
            onChange(undoValue);
            clear();
          }}
        >
          Undo last tap
        </button>
        <button
          type="button"
          className="text-button"
          disabled={value === undefined}
          onClick={() => {
            remember();
            onChange(undefined);
          }}
        >
          Clear
        </button>
      </div>
    </StudioShell>
  );
}

/* ---------------------------- multi counter ------------------------------ */

export function MultiCounterField({ field, value, onChange, label }: FieldProps & { label: string }) {
  const config = useMemo(() => multiCounterConfig(field), [field]);
  const { canUndo, undoValue, remember, clear } = useOneLevelUndo(value);
  const counts = multiCounterValueOf(value, config);
  const touched = value !== undefined && value !== null;

  function step(counterKey: string, delta: number) {
    remember();
    onChange(applyMultiCounterStep(value, counterKey, delta, config));
  }

  if (!config.counters.length) {
    return (
      <StudioShell label={label} hint="No named counters configured on this form yet.">
        <p className="app-muted">Add counters in the form builder — nothing is recorded here.</p>
      </StudioShell>
    );
  }

  return (
    <StudioShell
      label={label}
      hint={field.helpText ?? (config.max != null ? `Max ${config.max} each` : undefined)}
      headline={
        <output className="scout-studio-readout" aria-live="polite">
          {touched ? multiCounterTotal(value, config) : 0}
        </output>
      }
    >
      <ul className="scout-multi-counter">
        {config.counters.map((counter) => (
          <li key={counter.key}>
            <div className="scout-multi-counter-label">
              <strong>{counter.label}</strong>
              <output aria-live="polite">{counts[counter.key] ?? 0}</output>
            </div>
            <div className="scout-counter-pad compact">
              <button
                type="button"
                className="scout-tap minus"
                aria-label={`Subtract 1 from ${counter.label}`}
                onClick={() => step(counter.key, -1)}
              >
                −1
              </button>
              {config.steps.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  className={`scout-tap plus${amount === config.steps[0] ? " primary" : ""}`}
                  aria-label={`Add ${amount} to ${counter.label}`}
                  onClick={() => step(counter.key, amount)}
                >
                  +{amount}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="scout-studio-actions">
        <button
          type="button"
          className="text-button"
          disabled={!canUndo}
          onClick={() => {
            onChange(undoValue);
            clear();
          }}
        >
          Undo last tap
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!touched}
          onClick={() => {
            remember();
            onChange(undefined);
          }}
        >
          Clear
        </button>
      </div>
    </StudioShell>
  );
}

/* -------------------------------- timer ---------------------------------- */

export function TimerField({ field, value, onChange, label }: FieldProps & { label: string }) {
  const config = useMemo(() => timerConfig(field), [field]);
  const { canUndo, undoValue, remember, clear } = useOneLevelUndo(value);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (startedAt == null) return;
    const timer = window.setInterval(() => setTick((count) => count + 1), 100);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const running = startedAt != null;
  // `tick` only exists to re-render the running clock.
  void tick;
  const liveSeconds = running ? (Date.now() - (startedAt ?? 0)) / 1000 : 0;
  const laps = config.mode === "lap" ? normalizeTimerLaps(value) : [];
  const stored =
    config.mode === "lap"
      ? accumulateTimerLaps(laps)
      : typeof value === "number" && Number.isFinite(value)
        ? value
        : 0;
  const displayed = stored + liveSeconds;
  const average = config.mode === "lap" ? timerAverageLapSeconds(laps) : null;

  function toggle() {
    if (!running) {
      setStartedAt(Date.now());
      return;
    }
    const elapsed = (Date.now() - (startedAt ?? Date.now())) / 1000;
    setStartedAt(null);
    remember();
    if (config.mode === "lap") {
      onChange([...laps, Math.round(elapsed * 1000) / 1000]);
    } else {
      onChange(Math.round((stored + elapsed) * 1000) / 1000);
    }
  }

  return (
    <StudioShell
      label={label}
      hint={
        field.helpText ??
        (config.mode === "lap"
          ? "Each start-stop records one lap; the total and average come from the laps."
          : "Start-stop adds to a single running total.")
      }
      headline={
        <output className="scout-studio-readout" aria-live="off">
          {formatTimerSeconds(displayed)}
        </output>
      }
    >
      <button
        type="button"
        className={`scout-timer-toggle${running ? " running" : ""}`}
        aria-pressed={running}
        onClick={toggle}
      >
        {running ? "Stop" : config.mode === "lap" && laps.length ? "Start next lap" : "Start"}
      </button>
      {config.mode === "lap" && laps.length ? (
        <p className="scout-timer-laps app-muted">
          {laps.length} lap{laps.length === 1 ? "" : "s"}
          {average != null ? ` · avg ${formatTimerSeconds(average)}` : ""} ·{" "}
          {laps.map((lap) => formatTimerSeconds(lap)).join(", ")}
        </p>
      ) : null}
      <div className="scout-studio-actions">
        <button
          type="button"
          className="text-button"
          disabled={!canUndo || running}
          onClick={() => {
            onChange(undoValue);
            clear();
          }}
        >
          {config.mode === "lap" ? "Undo last lap" : "Undo last stop"}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={value === undefined || running}
          onClick={() => {
            remember();
            onChange(undefined);
          }}
        >
          Reset
        </button>
      </div>
    </StudioShell>
  );
}

/* -------------------------------- rating --------------------------------- */

export function RatingField({ field, value, onChange, label }: FieldProps & { label: string }) {
  const config = useMemo(() => ratingConfig(field), [field]);
  const current = typeof value === "number" ? value : 0;
  const stars = Array.from({ length: config.max }, (_, index) => index + 1);

  return (
    <StudioShell
      label={label}
      hint={field.helpText ?? "Tap the same star again to clear the rating."}
      headline={
        <output className="scout-studio-readout small" aria-live="polite">
          {current ? `${current}/${config.max}` : "—"}
        </output>
      }
    >
      <div className="scout-rating-row" role="radiogroup" aria-label={label}>
        {stars.map((star) => (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={current === star}
            aria-label={`${star} of ${config.max}`}
            className={`scout-rating-star${star <= current ? " on" : ""}`}
            onClick={() => onChange(toggleRatingValue(value, star, config))}
          >
            {star <= current ? "★" : "☆"}
          </button>
        ))}
      </div>
    </StudioShell>
  );
}

/* ----------------------------- multi select ------------------------------ */

export function MultiSelectField({ field, value, onChange, label }: FieldProps & { label: string }) {
  const options = field.options ?? [];
  const picked = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  function toggle(option: string) {
    const next = picked.includes(option)
      ? picked.filter((item) => item !== option)
      : [...picked, option];
    onChange(next.length ? next : undefined);
  }

  if (!options.length) {
    return (
      <StudioShell label={label} hint="No options configured on this form yet.">
        <p className="app-muted">Add options in the form builder — nothing is recorded here.</p>
      </StudioShell>
    );
  }

  return (
    <StudioShell
      label={label}
      hint={field.helpText ?? "Pick any number — all of them are stored."}
      headline={
        <output className="scout-studio-readout small" aria-live="polite">
          {picked.length ? `${picked.length} picked` : "none"}
        </output>
      }
    >
      <div className="scout-multi-select" role="group" aria-label={label}>
        {options.map((option) => {
          const on = picked.includes(option);
          return (
            <button
              key={option}
              type="button"
              className={`scout-chip${on ? " on" : ""}`}
              aria-pressed={on}
              onClick={() => toggle(option)}
            >
              {option}
            </button>
          );
        })}
      </div>
    </StudioShell>
  );
}

/* -------------------------------- slider --------------------------------- */

export function SliderField({ field, value, onChange, label }: FieldProps & { label: string }) {
  const config = useMemo(() => sliderConfig(field), [field]);
  const touched = typeof value === "number" && Number.isFinite(value);
  const current = touched ? (value as number) : config.min;

  return (
    <StudioShell
      label={label}
      hint={field.helpText}
      headline={
        <output className="scout-studio-readout small" aria-live="polite">
          {touched ? current : "—"}
        </output>
      }
    >
      <input
        className="scout-slider"
        type="range"
        min={config.min}
        max={config.max}
        step={config.step}
        value={current}
        aria-label={label}
        aria-valuetext={touched ? String(current) : "not set"}
        onChange={(event) => onChange(snapSliderValue(event.target.valueAsNumber, config))}
      />
      <div className="scout-slider-scale app-muted">
        <span>{config.minLabel ?? config.min}</span>
        <span>{config.maxLabel ?? config.max}</span>
      </div>
      {touched ? (
        <div className="scout-studio-actions">
          <button type="button" className="text-button" onClick={() => onChange(undefined)}>
            Clear
          </button>
        </div>
      ) : (
        <small className="app-muted">Not set — drag to record a value.</small>
      )}
    </StudioShell>
  );
}

/* ----------------------------- field position ---------------------------- */

/**
 * A labeled grid over a neutral field rectangle. Deliberately NO game art and
 * no element names: the stored value is a list of cell indices, so a form
 * published this season still reads correctly after the next game reveal.
 */
export function FieldPositionField({
  field,
  value,
  onChange,
  label,
}: FieldProps & { label: string }) {
  const config = useMemo(() => fieldPositionConfig(field), [field]);
  const picked = normalizeFieldPositionCells(value, config);
  const cells = Array.from({ length: fieldPositionCellCount(config) }, (_, index) => index);

  function toggle(cell: number) {
    const next = toggleFieldPositionCell(value, cell, config);
    onChange(next.length ? next : undefined);
  }

  return (
    <StudioShell
      label={label}
      hint={
        field.helpText ??
        `Tap where it happened. ${config.gridCols} × ${config.gridRows} grid — only cell numbers are stored.`
      }
      headline={
        <output className="scout-studio-readout small" aria-live="polite">
          {picked.length
            ? picked.map((cell) => fieldPositionCellLabel(cell, config)).join(" ")
            : "none"}
        </output>
      }
    >
      {/*
        The grid scrolls sideways rather than squeezing: a 12-column grid on a
        360px phone would otherwise give ~25px cells, well under the tap target
        a scout can hit without looking down. Cells stay >=44px wide and the
        container scrolls instead.
      */}
      <div className="scout-field-grid-scroll">
        <div
          className="scout-field-grid"
          role="group"
          aria-label={`${label} field grid`}
          style={{
            gridTemplateColumns: `repeat(${config.gridCols}, minmax(44px, 1fr))`,
            gridTemplateRows: `repeat(${config.gridRows}, minmax(48px, 1fr))`,
          }}
        >
          {cells.map((cell) => {
            const allowed = isFieldPositionCellAllowed(cell, config);
            const on = picked.includes(cell);
            const cellLabel = fieldPositionCellLabel(cell, config);
            return (
              <button
                key={cell}
                type="button"
                className={`scout-field-cell${on ? " on" : ""}`}
                disabled={!allowed}
                aria-pressed={on}
                aria-label={`Cell ${cellLabel}`}
                onClick={() => toggle(cell)}
              >
                {cellLabel}
              </button>
            );
          })}
        </div>
      </div>
      {picked.length ? (
        <div className="scout-studio-actions">
          <button type="button" className="text-button" onClick={() => onChange(undefined)}>
            Clear positions
          </button>
        </div>
      ) : null}
    </StudioShell>
  );
}

/** True when `field` should render through a studio control. */
export function isStudioField(field: FieldDefinition): boolean {
  return (
    field.type === "counter" ||
    field.type === "multi_counter" ||
    field.type === "timer" ||
    field.type === "rating" ||
    field.type === "multi_select" ||
    field.type === "slider" ||
    field.type === "section_header" ||
    field.type === "field_position"
  );
}

/** Render the right studio control, or null when `field` is not a studio type. */
export function StudioField({
  field,
  value,
  onChange,
  label,
}: FieldProps & { label: string }) {
  switch (field.type) {
    case "section_header":
      return <StudioSectionHeader field={field} />;
    case "counter":
      return <CounterField field={field} value={value} onChange={onChange} label={label} />;
    case "multi_counter":
      return <MultiCounterField field={field} value={value} onChange={onChange} label={label} />;
    case "timer":
      return <TimerField field={field} value={value} onChange={onChange} label={label} />;
    case "rating":
      return <RatingField field={field} value={value} onChange={onChange} label={label} />;
    case "multi_select":
      return <MultiSelectField field={field} value={value} onChange={onChange} label={label} />;
    case "slider":
      return <SliderField field={field} value={value} onChange={onChange} label={label} />;
    case "field_position":
      return <FieldPositionField field={field} value={value} onChange={onChange} label={label} />;
    default:
      return null;
  }
}
