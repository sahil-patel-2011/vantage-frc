"use client";

import { Button } from "../../../components/ui";
import {
  ANSWER_KIND_OPTIONS,
  addOption,
  moveOption,
  parseOptions,
  removeOption,
  serializeOptions,
  updateOptionAt,
  type AnswerKind,
} from "../../../lib/scouting/form-builder";

export function OptionEditor({
  optionsText,
  disabled,
  kind,
  onChange,
}: {
  optionsText: string;
  disabled: boolean;
  kind: AnswerKind;
  onChange: (optionsText: string) => void;
}) {
  const options = parseOptions(optionsText);
  const rows = options.length ? options : ["", ""];

  function commit(next: string[]) {
    onChange(serializeOptions(next));
  }

  return (
    <div className="sfb-option-editor">
      <div className="sfb-option-editor-head">
        <span>Options</span>
        <small className="app-muted">
          {ANSWER_KIND_OPTIONS.find((o) => o.kind === kind)?.hint ?? "Edit choices"}
        </small>
      </div>
      <ul className="sfb-option-list">
        {rows.map((option, index) => (
          <li key={`opt-${index}`}>
            <input
              value={option}
              disabled={disabled}
              placeholder={`Option ${index + 1}`}
              aria-label={`Option ${index + 1}`}
              onChange={(event) => {
                const base = options.length ? options : ["", ""];
                commit(updateOptionAt(base, index, event.target.value));
              }}
            />
            <div className="sfb-option-actions">
              <button
                type="button"
                disabled={disabled || index === 0}
                aria-label={`Move option ${index + 1} up`}
                onClick={() => commit(moveOption(rows, index, index - 1))}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={disabled || index === rows.length - 1}
                aria-label={`Move option ${index + 1} down`}
                onClick={() => commit(moveOption(rows, index, index + 1))}
              >
                ↓
              </button>
              <button
                type="button"
                disabled={disabled || rows.length <= 2}
                aria-label={`Remove option ${index + 1}`}
                onClick={() => commit(removeOption(rows, index))}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="secondary" type="button" disabled={disabled} onClick={() => commit(addOption(options.length ? options : ["", ""], ""))}>
        Add option
      </Button>
    </div>
  );
}
