"use client";

import { useState } from "react";
import { Button } from "./ui";
import { withOrgHref } from "../lib/nav/product-nav";

type CopyShareLinkProps = {
  orgId?: string | null;
  /** Path + search to share. Defaults to the current window location. */
  pathWithSearch?: string;
  className?: string;
  label?: string;
};

/**
 * Copies a team-scoped deep link for the current hub surface.
 * Uses withOrgHref so shared URLs keep the active team.
 */
export function CopyShareLink({
  orgId,
  pathWithSearch,
  className,
  label = "Copy share link",
}: CopyShareLinkProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    if (typeof window === "undefined") return;
    const raw =
      pathWithSearch ??
      `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const href = withOrgHref(raw, orgId ?? null);
    const url = `${window.location.origin}${href}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("failed");
      window.setTimeout(() => setStatus("idle"), 2500);
    }
  }

  return (
    <Button
      type="button"
      variant="secondary"
      className={className}
      onClick={() => void copy()}
      aria-live="polite"
      title="Copy a link to this page for your team"
    >
      {status === "copied" ? "Link copied" : status === "failed" ? "Copy failed" : label}
    </Button>
  );
}
