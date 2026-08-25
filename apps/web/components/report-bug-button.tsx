"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import "./report-bug-button.css";

/**
 * Small "Report a bug" affordance any page (or the shell's help area) can mount.
 * It only links to /report-bug with the current route in ?from= so the report
 * form can show the reporter which page it will attach — no data is read here.
 *
 * variant="floating" pins it to the bottom corner; "inline" renders a normal
 * secondary button for help areas and footers. Both are ≥44px targets.
 */
function ReportBugLink({ variant }: { variant: "floating" | "inline" }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams?.toString();
  const from = `${pathname ?? ""}${query ? `?${query}` : ""}`;
  const href = from && from.startsWith("/") ? `/report-bug?from=${encodeURIComponent(from)}` : "/report-bug";

  return (
    <a
      className={variant === "floating" ? "report-bug-fab" : "app-button secondary report-bug-inline"}
      href={href}
      aria-label="Report a bug"
    >
      <span aria-hidden className="report-bug-fab-dot" />
      Report a bug
    </a>
  );
}

export default function ReportBugButton({
  variant = "inline",
}: {
  variant?: "floating" | "inline";
}) {
  // useSearchParams needs a Suspense boundary during static prerender.
  return (
    <Suspense fallback={null}>
      <ReportBugLink variant={variant} />
    </Suspense>
  );
}
