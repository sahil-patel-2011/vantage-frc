export const PROVISIONING_PHASES = [
  { id: "team", label: "Creating your team" },
  { id: "tools", label: "Setting up scouting and team tools" },
  { id: "workspace", label: "Preparing your workspace" },
  { id: "sheets", label: "Creating your Google Sheets" },
  { id: "recovery", label: "Verifying your recovery copy" },
  { id: "verify", label: "Checking everything" },
] as const;
export const PROVISIONING_FACTS = [
  "Scouting reports can be collected offline and uploaded when you reconnect.",
  "Pick-list rankings can explain the observations behind each score.",
  "Your Codex connection belongs to you and uses your own paired computer.",
  "Purchasing, inventory, and repairs can share the same parts records.",
] as const;
export type ProvisioningPhase = typeof PROVISIONING_PHASES[number]["id"];
export const WORKSPACE_WORKBOOK_NAMES = ["Start Here", "Competition", "Team", "Build", "Business"] as const;
export type WorkspaceWorkbookName = typeof WORKSPACE_WORKBOOK_NAMES[number];
export type ProvisioningStatus = {
  state: "queued" | "running" | "waiting" | "failed" | "ready";
  phase: ProvisioningPhase | "ready";
  completedPhases: string[];
  error: string | null;
  verifiedAt: string | null;
  retryAfterAt?: string | null;
  /**
   * "not_connected": this server has no operator Google connection, so the Google steps were
   * skipped instead of failed. Stored as `resources.google`; the job waits (state `waiting`, no
   * automatic retry) and the team works without the copies.
   */
  googleWorkspace?: "not_connected" | null;
};
export function provisioningReady(job: ProvisioningStatus): boolean {
  return job.state === "ready" && Boolean(job.verifiedAt) && PROVISIONING_PHASES.every((phase) => job.completedPhases.includes(phase.id));
}

/** Application availability is independent of external copies completing. */
export function workspaceReady(job: ProvisioningStatus): boolean {
  return job.completedPhases.includes("team") && job.completedPhases.includes("tools");
}

/** What a setup step returns when the server has no Google connection: the run stops, calmly. */
export const GOOGLE_NOT_CONNECTED = "google_not_connected" as const;

/** The steps that need the operator's Google connection (folder, Sheets, recovery copy, check). */
export const GOOGLE_PROVISIONING_PHASES: readonly ProvisioningPhase[] = ["workspace", "sheets", "recovery", "verify"];

/** A server without Google is a supported setup: the step is optional, never "failed". */
export const GOOGLE_NOT_CONNECTED_COPY = {
  label: "Google Sheets copies",
  status: "Optional · connect Google later",
  detail: "Your team works without them. Copies are made once Vantage's Google connection is set up.",
} as const;

export function googleWorkspaceDeferred(job: Pick<ProvisioningStatus, "googleWorkspace">): boolean {
  return job.googleWorkspace === "not_connected";
}

/** The /team-setup heading. A skipped optional step never reads as "needs attention". */
export function provisioningHeadline(job: ProvisioningStatus): string {
  if (googleWorkspaceDeferred(job)) return workspaceReady(job) ? "Your team is ready" : "Setting up your team";
  if (job.state === "failed") return "Your setup needs attention";
  if (job.state === "waiting") return "Your setup is waiting";
  return "Setting up your team";
}
