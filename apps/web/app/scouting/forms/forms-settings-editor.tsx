"use client";

import {
  FIELD_POSITION_MAX_GRID,
  FIELD_POSITION_MIN_GRID,
  RATING_MAX_STARS,
  RATING_MIN_STARS,
} from "@vantage/scouting";
import { FormRow } from "../../../components/ui";
import { parseSubCounters, type DraftFieldSettings, type DraftQuestion } from "../../../lib/scouting/form-builder";

/**
 * Config editor for the studio answer types.
 *
 * Everything here writes into the draft's `settings`, which `definitionFromDraft`
 * serializes into the published `config` — the exact bag the entry renderers and
 * the server-side validator both read. One source of truth for "what is in range".
 */
export function StudioSettingsEditor({
  question,
  disabled,
  onChange,
}: {
  question: DraftQuestion;
  disabled: boolean;
  onChange(settings: DraftFieldSettings): void;
}) {
  const settings = question.settings ?? {};
  const patch = (next: DraftFieldSettings) => onChange({ ...settings, ...next });
  const numberOr = (raw: string, fallback: number) => {
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };

  if (question.kind === "counter" || question.kind === "multi_counter") {
    const subCounters = parseSubCounters(settings.subCountersText);
    return (
      <div className="sfb-settings">
        {question.kind === "multi_counter" ? (
          <FormRow
            label="Named counters"
            hint={
              subCounters.length
                ? `${subCounters.length} counter${subCounters.length === 1 ? "" : "s"}: ${subCounters
                    .map((counter) => counter.label)
                    .join(" · ")}`
                : "Add at least one — comma separated (e.g. High, Mid, Low)"
            }
          >
            <input
              value={settings.subCountersText ?? ""}
              disabled={disabled}
              placeholder="High, Mid, Low"
              aria-label="Named counters"
              onChange={(event) => patch({ subCountersText: event.target.value })}
            />
          </FormRow>
        ) : null}
        <FormRow label="Bulk step buttons" hint="Comma separated; the first one is the big primary tap">
          <input
            value={settings.counterStepsText ?? ""}
            disabled={disabled}
            placeholder="1, 5, 10"
            aria-label="Counter step buttons"
            onChange={(event) => patch({ counterStepsText: event.target.value })}
          />
        </FormRow>
        <FormRow label="Max" hint="Blank for no cap — the server rejects anything above it">
          <input
            type="number"
            value={settings.maxText ?? ""}
            disabled={disabled}
            placeholder="No cap"
            aria-label="Counter maximum"
            onChange={(event) => patch({ maxText: event.target.value })}
          />
        </FormRow>
        <label className="sfb-check">
          <input
            type="checkbox"
            checked={Boolean(settings.allowNegative)}
            disabled={disabled}
            onChange={(event) => patch({ allowNegative: event.target.checked })}
          />
          <span>
            <strong>Allow negative counts</strong>
            <small className="app-muted">Off by default — a tally cannot go below zero</small>
          </span>
        </label>
      </div>
    );
  }

  if (question.kind === "timer") {
    return (
      <div className="sfb-settings">
        <FormRow
          label="Stopwatch mode"
          hint={
            settings.timerMode === "total"
              ? "Start-stop adds to one running total"
              : "Each start-stop records a lap; the total and average come from the laps"
          }
        >
          <select
            value={settings.timerMode ?? "lap"}
            disabled={disabled}
            aria-label="Stopwatch mode"
            onChange={(event) => patch({ timerMode: event.target.value === "total" ? "total" : "lap" })}
          >
            <option value="lap">Laps — one per start-stop</option>
            <option value="total">Total — one running clock</option>
          </select>
        </FormRow>
      </div>
    );
  }

  if (question.kind === "rating") {
    return (
      <div className="sfb-settings">
        <FormRow label="Stars" hint={`Between ${RATING_MIN_STARS} and ${RATING_MAX_STARS}`}>
          <input
            type="number"
            min={RATING_MIN_STARS}
            max={RATING_MAX_STARS}
            value={settings.ratingMax ?? 5}
            disabled={disabled}
            aria-label="Rating stars"
            onChange={(event) => patch({ ratingMax: numberOr(event.target.value, 5) })}
          />
        </FormRow>
      </div>
    );
  }

  if (question.kind === "slider") {
    return (
      <div className="sfb-settings">
        <FormRow label="Min">
          <input
            type="number"
            value={settings.sliderMin ?? 0}
            disabled={disabled}
            aria-label="Slider minimum"
            onChange={(event) => patch({ sliderMin: numberOr(event.target.value, 0) })}
          />
        </FormRow>
        <FormRow label="Max">
          <input
            type="number"
            value={settings.sliderMax ?? 10}
            disabled={disabled}
            aria-label="Slider maximum"
            onChange={(event) => patch({ sliderMax: numberOr(event.target.value, 10) })}
          />
        </FormRow>
        <FormRow label="Step" hint="Must be positive and no wider than the range">
          <input
            type="number"
            value={settings.sliderStep ?? 1}
            disabled={disabled}
            aria-label="Slider step"
            onChange={(event) => patch({ sliderStep: numberOr(event.target.value, 1) })}
          />
        </FormRow>
        <FormRow label="Low end label" hint="Optional — shown under the left end">
          <input
            value={settings.sliderMinLabel ?? ""}
            disabled={disabled}
            placeholder="e.g. Never"
            aria-label="Slider low label"
            onChange={(event) => patch({ sliderMinLabel: event.target.value })}
          />
        </FormRow>
        <FormRow label="High end label" hint="Optional — shown under the right end">
          <input
            value={settings.sliderMaxLabel ?? ""}
            disabled={disabled}
            placeholder="e.g. Every cycle"
            aria-label="Slider high label"
            onChange={(event) => patch({ sliderMaxLabel: event.target.value })}
          />
        </FormRow>
      </div>
    );
  }

  if (question.kind === "field_position") {
    return (
      <div className="sfb-settings">
        <FormRow
          label="Grid columns"
          hint={`${FIELD_POSITION_MIN_GRID}–${FIELD_POSITION_MAX_GRID}. Only cell numbers are stored — no game art, so the form survives the next reveal.`}
        >
          <input
            type="number"
            min={FIELD_POSITION_MIN_GRID}
            max={FIELD_POSITION_MAX_GRID}
            value={settings.gridCols ?? 6}
            disabled={disabled}
            aria-label="Field grid columns"
            onChange={(event) => patch({ gridCols: numberOr(event.target.value, 6) })}
          />
        </FormRow>
        <FormRow label="Grid rows" hint={`${FIELD_POSITION_MIN_GRID}–${FIELD_POSITION_MAX_GRID}`}>
          <input
            type="number"
            min={FIELD_POSITION_MIN_GRID}
            max={FIELD_POSITION_MAX_GRID}
            value={settings.gridRows ?? 3}
            disabled={disabled}
            aria-label="Field grid rows"
            onChange={(event) => patch({ gridRows: numberOr(event.target.value, 3) })}
          />
        </FormRow>
      </div>
    );
  }

  return null;
}
