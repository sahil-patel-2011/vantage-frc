"use client";

import { COMPOSER_OP_FIELDS, type ComposerNativeOp } from "../../lib/cad/composer-ops";
import {
  pickableEntityIds,
  splitIdList,
  toggleIdListValue,
  type ListedOnshapeEntities,
} from "../../lib/cad/list-entities";

export function CadComposerFields({
  operation,
  draft,
  disabled,
  onChange,
  entities,
  features,
}: {
  operation: ComposerNativeOp;
  draft: Record<string, string | boolean>;
  disabled: boolean;
  onChange: (key: string, value: string | boolean) => void;
  /** Live ids from list-onshape-entities. Empty / omitted → empty picker; paste still works. */
  entities?: ListedOnshapeEntities | null;
  /** Live feature-tree ids for featureIds / featureId pickers. */
  features?: ReadonlyArray<{ featureId: string }>;
}) {
  const fields = COMPOSER_OP_FIELDS[operation];
  if (!fields.length) {
    return <p className="app-muted">No parameters — this step uses the bound document as-is.</p>;
  }

  return (
    <div className="cad-operation-grid">
      {fields.map((field) => {
        const value = draft[field.key];
        if (field.kind === "checkbox") {
          return (
            <label key={field.key}>
              {field.label}
              <span>
                <input
                  type="checkbox"
                  checked={value === true}
                  disabled={disabled}
                  onChange={(event) => onChange(field.key, event.target.checked)}
                />
              </span>
            </label>
          );
        }
        if (field.kind === "select") {
          return (
            <label key={field.key}>
              {field.label}
              <select
                value={typeof value === "string" ? value : ""}
                disabled={disabled}
                onChange={(event) => onChange(field.key, event.target.value)}
              >
                <option value="">Choose…</option>
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        if (field.kind === "idList") {
          const text = typeof value === "string" ? value : "";
          const selected = new Set(splitIdList(text));
          const options = pickableEntityIds(field.key, entities, { features });
          return (
            <div key={field.key}>
              <label>
                {field.label}
                <textarea
                  rows={3}
                  value={text}
                  placeholder={field.help}
                  disabled={disabled}
                  onChange={(event) => onChange(field.key, event.target.value)}
                />
              </label>
              <ul aria-label={`${field.label} from the bound Part Studio`}>
                {options.map((id) => (
                  <li key={id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.has(id)}
                        disabled={disabled}
                        onChange={() => onChange(field.key, toggleIdListValue(text, id))}
                      />
                      {id}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        const isMm = field.kind === "mm" || field.kind === "signedMm";
        return (
          <label key={field.key}>
            {isMm ? `${field.label} (mm)` : field.label}
            <input
              type={isMm ? "number" : "text"}
              inputMode={isMm ? "decimal" : undefined}
              step={isMm ? "any" : undefined}
              min={field.kind === "mm" ? "0" : undefined}
              value={typeof value === "string" ? value : ""}
              placeholder={isMm ? "mm" : field.help}
              disabled={disabled}
              onChange={(event) => onChange(field.key, event.target.value)}
            />
          </label>
        );
      })}
    </div>
  );
}
