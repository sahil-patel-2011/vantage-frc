import type { ReactNode } from "react";

export type SetupStep = { label: ReactNode; href?: string; done?: boolean };

const CheckGlyph = () => (
  <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ width: 14, height: 14, flex: "none" }}>
    <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Scannable, linkable setup checklist. Promotes the ad-hoc per-module `<ol>` (award-tracker's
 * strategy-setup-steps) into a shared piece. Pass to Shell `setup` / EmptyState children.
 */
export function SetupChecklist({ steps, className }: { steps: SetupStep[]; className?: string }) {
  return (
    <ol
      className={["dash-setup-steps", className].filter(Boolean).join(" ")}
      style={{ display: "grid", gap: 8, margin: "10px 0 0", padding: 0, listStylePosition: "inside" }}
    >
      {steps.map((step, i) => {
        const content = (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span
              aria-hidden="true"
              style={{
                display: "grid",
                placeItems: "center",
                width: 20,
                height: 20,
                flex: "none",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                color: step.done ? "#166534" : "var(--soft-accent, #1457d9)",
                background: step.done
                  ? "color-mix(in srgb, #dcfce7 70%, transparent)"
                  : "var(--soft-accent-soft, #e4ecfc)",
              }}
            >
              {step.done ? <CheckGlyph /> : i + 1}
            </span>
            <span style={step.done ? { color: "var(--soft-muted, #5a6578)" } : undefined}>{step.label}</span>
          </span>
        );
        return (
          <li key={i} style={{ listStyle: "none" }}>
            {step.href && !step.done ? (
              <a href={step.href} style={{ textDecoration: "none", color: "inherit" }}>
                {content}
              </a>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ol>
  );
}
