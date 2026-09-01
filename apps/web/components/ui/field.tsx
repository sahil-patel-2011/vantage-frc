"use client";

import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import styles from "./ui.module.css";

type Option = { value: string; label: ReactNode; disabled?: boolean };

type FieldIds = {
  controlId: string;
  helpId?: string;
  errorId?: string;
  describedBy?: string;
};

/** Stable id triple for a control + its help/error text, so aria-describedby always points at real nodes. */
function useFieldIds(id: string | undefined, help: ReactNode, error: ReactNode): FieldIds {
  const autoId = useId();
  const controlId = id ?? autoId;
  const hasHelp = help != null && help !== "";
  const hasError = error != null && error !== "";
  const helpId = hasHelp ? `${controlId}-help` : undefined;
  const errorId = hasError ? `${controlId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  return { controlId, helpId, errorId, describedBy };
}

/** Loading glyph — decorative; the real state is the control's disabled + aria-busy. */
function LoadingGlyph() {
  return <span className={styles.fieldLoadingGlyph} aria-hidden="true" />;
}

/** Help text tied to a control via aria-describedby. Renders nothing when empty. */
export function FieldHelp({ id, children }: { id?: string; children?: ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <p id={id} className={styles.fieldHelp}>
      {children}
    </p>
  );
}

/** Error text tied to a control via aria-describedby. `role="alert"` so a validation error on submit is announced. */
export function FieldError({ id, children }: { id?: string; children?: ReactNode }) {
  if (children == null || children === "") return null;
  return (
    <p id={id} role="alert" className={styles.fieldError}>
      {children}
    </p>
  );
}

type FieldChromeProps = {
  label: ReactNode;
  required?: boolean;
  wide?: boolean;
  className?: string;
  loading?: boolean;
  help?: ReactNode;
  error?: ReactNode;
  helpId?: string;
  errorId?: string;
  controlId: string;
  children: ReactNode;
};

/** Shared label + control + help/error shell every input/select/textarea/file field wraps (radio uses its own fieldset/legend). */
function FieldChrome({
  label,
  required,
  wide,
  className,
  loading,
  help,
  error,
  helpId,
  errorId,
  controlId,
  children,
}: FieldChromeProps) {
  return (
    <div
      className={[styles.field, wide ? styles.fieldWide : undefined, className].filter(Boolean).join(" ")}
      aria-busy={loading || undefined}
    >
      <label htmlFor={controlId} className={styles.fieldLabel}>
        <span>{label}</span>
        {required ? (
          <span className={styles.fieldRequired} aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
        {loading ? <LoadingGlyph /> : null}
      </label>
      {children}
      <FieldHelp id={helpId}>{help}</FieldHelp>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

type BaseFieldProps = {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  wide?: boolean;
  className?: string;
  loading?: boolean;
  id?: string;
};

export type TextFieldProps = BaseFieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, "id">;

/** Single-line text input (`type="text" | "email" | "number" | ...`). 44px control, label-associated, aria-invalid + describedby wired to help/error. */
export function TextField({
  label,
  help,
  error,
  required,
  wide,
  className,
  loading,
  id,
  disabled,
  ...rest
}: TextFieldProps) {
  const { controlId, helpId, errorId, describedBy } = useFieldIds(id, help, error);
  const invalid = Boolean(error);
  return (
    <FieldChrome
      label={label}
      required={required}
      wide={wide}
      className={className}
      loading={loading}
      help={help}
      error={error}
      helpId={helpId}
      errorId={errorId}
      controlId={controlId}
    >
      <input
        id={controlId}
        className={[styles.fieldControl, invalid ? styles.fieldControlInvalid : undefined].filter(Boolean).join(" ")}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        required={required}
        {...rest}
      />
    </FieldChrome>
  );
}

export type TextareaFieldProps = BaseFieldProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">;

/** Multi-line text input. Same aria wiring as TextField; grows via CSS `resize: vertical`. */
export function TextareaField({
  label,
  help,
  error,
  required,
  wide,
  className,
  loading,
  id,
  disabled,
  rows = 4,
  ...rest
}: TextareaFieldProps) {
  const { controlId, helpId, errorId, describedBy } = useFieldIds(id, help, error);
  const invalid = Boolean(error);
  return (
    <FieldChrome
      label={label}
      required={required}
      wide={wide}
      className={className}
      loading={loading}
      help={help}
      error={error}
      helpId={helpId}
      errorId={errorId}
      controlId={controlId}
    >
      <textarea
        id={controlId}
        className={[styles.fieldControl, styles.fieldTextarea, invalid ? styles.fieldControlInvalid : undefined]
          .filter(Boolean)
          .join(" ")}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        required={required}
        rows={rows}
        {...rest}
      />
    </FieldChrome>
  );
}

export type SelectFieldProps = BaseFieldProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "id"> & {
    options?: Option[];
    /** Rendered as a disabled, non-selectable first option when no value should be pre-chosen. */
    placeholder?: string;
  };

/** Native `<select>`. Pass `options` for the common case, or `children` for grouped/custom `<option>` markup. */
export function SelectField({
  label,
  help,
  error,
  required,
  wide,
  className,
  loading,
  id,
  disabled,
  options,
  placeholder,
  children,
  ...rest
}: SelectFieldProps) {
  const { controlId, helpId, errorId, describedBy } = useFieldIds(id, help, error);
  const invalid = Boolean(error);
  return (
    <FieldChrome
      label={label}
      required={required}
      wide={wide}
      className={className}
      loading={loading}
      help={help}
      error={error}
      helpId={helpId}
      errorId={errorId}
      controlId={controlId}
    >
      <select
        id={controlId}
        className={[styles.fieldControl, invalid ? styles.fieldControlInvalid : undefined].filter(Boolean).join(" ")}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        required={required}
        {...rest}
      >
        {placeholder ? (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        ) : null}
        {options
          ? options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
    </FieldChrome>
  );
}

export type CheckboxFieldProps = BaseFieldProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> & {
    /** Defaults to the label — pass to keep the visible copy shorter than the accessible name. */
    description?: ReactNode;
  };

/** Single checkbox. The whole row (label + box) is the 44px hit target, not just the 20px box. */
export function CheckboxField({
  label,
  description,
  help,
  error,
  className,
  loading,
  id,
  disabled,
  required,
  ...rest
}: CheckboxFieldProps) {
  const { controlId, helpId, errorId, describedBy } = useFieldIds(id, help, error);
  const invalid = Boolean(error);
  return (
    <div className={[styles.checkboxField, className].filter(Boolean).join(" ")} aria-busy={loading || undefined}>
      <label htmlFor={controlId} className={styles.checkboxRow}>
        <input
          id={controlId}
          type="checkbox"
          className={styles.checkboxBox}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled || loading}
          required={required}
          {...rest}
        />
        <span>
          {description ?? label}
          {loading ? <LoadingGlyph /> : null}
        </span>
      </label>
      <FieldHelp id={helpId}>{help}</FieldHelp>
      <FieldError id={errorId}>{error}</FieldError>
    </div>
  );
}

export type RadioGroupProps = {
  legend: ReactNode;
  name: string;
  value: string | null;
  onChange: (value: string) => void;
  options: Option[];
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  wide?: boolean;
};

/** Radio group — `<fieldset>`/`<legend>` so the group name is announced once, not repeated per option. */
export function RadioGroup({
  legend,
  name,
  value,
  onChange,
  options,
  help,
  error,
  required,
  disabled,
  loading,
  className,
  wide,
}: RadioGroupProps) {
  const { controlId, helpId, errorId, describedBy } = useFieldIds(undefined, help, error);
  const invalid = Boolean(error);
  return (
    <fieldset
      className={[styles.radioGroup, wide ? styles.fieldWide : undefined, className].filter(Boolean).join(" ")}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
    >
      <legend className={styles.fieldLabel}>
        <span>{legend}</span>
        {required ? (
          <span className={styles.fieldRequired} aria-hidden="true">
            {" "}
            *
          </span>
        ) : null}
        {loading ? <LoadingGlyph /> : null}
      </legend>
      <div className={styles.radioOptions}>
        {options.map((opt) => {
          const optionId = `${controlId}-${opt.value}`;
          return (
            <label key={opt.value} htmlFor={optionId} className={styles.radioOption}>
              <input
                id={optionId}
                type="radio"
                name={name}
                value={opt.value}
                checked={value === opt.value}
                disabled={disabled || loading || opt.disabled}
                onChange={() => onChange(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
      <FieldHelp id={helpId}>{help}</FieldHelp>
      <FieldError id={errorId}>{error}</FieldError>
    </fieldset>
  );
}

export type FileFieldProps = BaseFieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type">;

/** File input. Kept as the native control (styled) rather than a custom drop-zone, so OS file pickers and
 * keyboard/AT behavior are never reimplemented. */
export function FileField({
  label,
  help,
  error,
  required,
  wide,
  className,
  loading,
  id,
  disabled,
  ...rest
}: FileFieldProps) {
  const { controlId, helpId, errorId, describedBy } = useFieldIds(id, help, error);
  const invalid = Boolean(error);
  return (
    <FieldChrome
      label={label}
      required={required}
      wide={wide}
      className={className}
      loading={loading}
      help={help}
      error={error}
      helpId={helpId}
      errorId={errorId}
      controlId={controlId}
    >
      <input
        id={controlId}
        type="file"
        className={[styles.fileControl, invalid ? styles.fieldControlInvalid : undefined].filter(Boolean).join(" ")}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        aria-busy={loading || undefined}
        disabled={disabled || loading}
        required={required}
        {...rest}
      />
    </FieldChrome>
  );
}
