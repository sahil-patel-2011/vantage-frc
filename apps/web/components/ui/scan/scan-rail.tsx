import type { ReactNode } from "react";
import { scanRailState, type ScanRailState } from "../../../lib/ui/scan/tokens";

export type ScanRailStep = {
  id: string;
  label: ReactNode;
};

type ScanRailProps = {
  steps: readonly ScanRailStep[];
  current: string;
  "aria-label": string;
  className?: string;
};

function stateLabel(state: ScanRailState): string {
  switch (state) {
    case "done":
      return "Done";
    case "current":
      return "Current";
    case "upcoming":
      return "Upcoming";
    default: {
      const _never: never = state;
      return _never;
    }
  }
}

/**
 * Numbered step rail for sequential flows (onboarding, first-run setup).
 * Navy current pill, gold is reserved for setup chips — not this rail.
 * Not a copy of the installer window: it is a compact in-page list.
 */
export function ScanRail({ steps, current, "aria-label": ariaLabel, className }: ScanRailProps) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === current));
  return (
    <ol className={["scan-rail", className].filter(Boolean).join(" ")} aria-label={ariaLabel}>
      {steps.map((step, index) => {
        const state = scanRailState(index, currentIndex);
        return (
          <li
            key={step.id}
            className="scan-rail-step"
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
          >
            <span className="scan-rail-index" aria-hidden="true">
              {state === "done" ? "✓" : index + 1}
            </span>
            <span>{step.label}</span>
            <span className="sr-only">{stateLabel(state)}</span>
          </li>
        );
      })}
    </ol>
  );
}
