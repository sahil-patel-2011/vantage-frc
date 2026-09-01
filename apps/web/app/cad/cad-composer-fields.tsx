"use client";

import { COMPOSER_OP_FIELDS, type ComposerNativeOp } from "../../lib/cad/composer-ops";

export function CadComposerFields({
  operation,
  draft,
  disabled,
  onChange,
}: {
  operation: ComposerNativeOp;
  draft: Record<string, string | boolean>;
  disabled: boolean;
  onChange: (key: string, value: string | boolean) => void;
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
