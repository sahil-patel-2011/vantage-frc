/**
 * Pure helpers for the Report-a-bug flow.
 *
 * Everything the client submits is shown to the reporter first — this module is
 * the single place that decides what "client info" even means (viewport + user
 * agent, nothing else), so no silent collection can creep in behind the form.
 */

export const BUG_SEVERITIES = ["annoyance", "blocking", "data-loss"] as const;
export type BugSeverity = (typeof BUG_SEVERITIES)[number];

export const BUG_SEVERITY_LABELS: Record<BugSeverity, string> = {
  annoyance: "Annoying, but I can work around it",
  blocking: "Blocking — I can't finish what I was doing",
  "data-loss": "Data loss — something I entered disappeared",
};

export const BUG_DESCRIPTION_MAX = 5000;
export const BUG_ROUTE_MAX = 300;
export const BUG_APP_AREA_MAX = 120;
export const BUG_USER_AGENT_MAX = 400;

/** Exactly the fields the form previews — nothing else is ever sent. */
export type BugClientInfo = {
  viewportWidth?: number;
  viewportHeight?: number;
  userAgent?: string;
};

export function isBugSeverity(value: unknown): value is BugSeverity {
  return typeof value === "string" && (BUG_SEVERITIES as readonly string[]).includes(value);
}

/**
 * Normalize an in-app route for storage: same-origin path + query only, no
 * hash, no absolute URLs (a full URL from another origin is dropped entirely).
 */
export function normalizeBugRoute(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  const withoutHash = raw.split("#")[0] ?? "";
  if (!withoutHash) return null;
  return withoutHash.slice(0, BUG_ROUTE_MAX);
}

/** Derive a coarse app area ("competition", "team", …) from a route for triage. */
export function bugAppAreaFromRoute(route: string | null): string | null {
  if (!route) return null;
  const segment = route.split("?")[0]?.split("/").filter(Boolean)[0] ?? "";
  if (!segment) return null;
  return segment.slice(0, BUG_APP_AREA_MAX);
}

/**
 * Keep only the disclosed client-info fields, clamped to sane bounds.
 * Anything unexpected is discarded, never stored.
 */
export function sanitizeBugClientInfo(value: unknown): BugClientInfo {
  const info: BugClientInfo = {};
  if (!value || typeof value !== "object") return info;
  const source = value as Record<string, unknown>;

  const width = Number(source.viewportWidth);
  if (Number.isFinite(width) && width > 0) {
    info.viewportWidth = Math.min(20000, Math.round(width));
  }
  const height = Number(source.viewportHeight);
  if (Number.isFinite(height) && height > 0) {
    info.viewportHeight = Math.min(20000, Math.round(height));
  }
  if (typeof source.userAgent === "string" && source.userAgent.trim()) {
    info.userAgent = source.userAgent.trim().slice(0, BUG_USER_AGENT_MAX);
  }
  return info;
}

export type NormalizedBugReport = {
  description: string;
  severity: BugSeverity | null;
  route: string | null;
  appArea: string | null;
  clientInfo: BugClientInfo;
};

export type BugReportResult =
  | { ok: true; report: NormalizedBugReport }
  | { ok: false; error: string };

/** Validate + normalize a submission. The description is the only required field. */
export function normalizeBugReport(input: {
  description?: unknown;
  severity?: unknown;
  route?: unknown;
  clientInfo?: unknown;
}): BugReportResult {
  const description = typeof input.description === "string" ? input.description.trim() : "";
  if (!description) {
    return { ok: false, error: "Tell us what happened — the description is the whole report." };
  }
  if (description.length > BUG_DESCRIPTION_MAX) {
    return { ok: false, error: `Keep the description under ${BUG_DESCRIPTION_MAX} characters.` };
  }
  if (input.severity !== undefined && input.severity !== null && !isBugSeverity(input.severity)) {
    return { ok: false, error: "Unknown severity." };
  }
  const route = normalizeBugRoute(typeof input.route === "string" ? input.route : null);
  return {
    ok: true,
    report: {
      description,
      severity: isBugSeverity(input.severity) ? input.severity : null,
      route,
      appArea: bugAppAreaFromRoute(route),
      clientInfo: sanitizeBugClientInfo(input.clientInfo),
    },
  };
}
