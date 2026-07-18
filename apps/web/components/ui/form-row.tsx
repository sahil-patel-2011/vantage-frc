import type { CSSProperties, ReactNode } from "react";

type FormRowProps = {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  /** Span the full form grid width. */
  wide?: boolean;
  className?: string;
  style?: CSSProperties;
};

/** Labeled field cell used inside Soft-UI create/edit forms. */
export function FormRow({ label, children, hint, wide = false, className, style }: FormRowProps) {
  return (
    <label
      className={["soft-form-row", wide ? "wide" : "", className].filter(Boolean).join(" ")}
      style={style}
    >
      <span className="app-muted">{label}</span>
      {children}
      {hint ? <small className="app-muted">{hint}</small> : null}
    </label>
  );
}

type FormGridProps = {
  children: ReactNode;
  min?: number;
  className?: string;
  style?: CSSProperties;
};

/** Auto-fit grid that hosts FormRow cells. */
export function FormGrid({ children, min = 140, className, style }: FormGridProps) {
  return (
    <div
      className={["soft-form-grid", className].filter(Boolean).join(" ")}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, ...style }}
    >
      {children}
    </div>
  );
}
