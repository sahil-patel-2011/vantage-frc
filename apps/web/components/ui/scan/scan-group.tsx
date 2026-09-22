import type { ReactNode } from "react";
import type { ScanBand } from "../../../lib/ui/scan/tokens";

type ScanGroupProps = {
  /** Visible uppercase kicker. Prefer this over `band` when the label is known. */
  label?: string;
  /** Uses `--scan-group-a/b/c` from the route overlay when `label` is omitted. */
  band?: ScanBand;
  children: ReactNode;
  className?: string;
};

/**
 * Grouped block with an uppercase kicker so a page scans as
 * THIS MATCH / SCOUTING / RELATED instead of a wall of equal cards.
 */
export function ScanGroup({ label, band, children, className }: ScanGroupProps) {
  return (
    <section
      className={["scan-group", className].filter(Boolean).join(" ")}
      data-band={band}
      data-label={label}
    >
      {children}
    </section>
  );
}

export function ScanKicker({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={["scan-kicker", className].filter(Boolean).join(" ")}>{children}</p>;
}

export function ScanWorkbench({
  hub,
  children,
  className,
}: {
  hub?: string;
  children: ReactNode;
  className?: string;
}) {
  const hubClass = hub ? `scan-hub--${hub}` : undefined;
  return (
    <div className={["scan-workbench", hubClass, className].filter(Boolean).join(" ")}>{children}</div>
  );
}
