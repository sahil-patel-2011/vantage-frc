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
export type ProvisioningStatus = { state: "queued" | "running" | "waiting" | "failed" | "ready"; phase: ProvisioningPhase | "ready"; completedPhases: string[]; error: string | null; verifiedAt: string | null; retryAfterAt?: string | null };
export function provisioningReady(job: ProvisioningStatus): boolean {
  return job.state === "ready" && Boolean(job.verifiedAt) && PROVISIONING_PHASES.every((phase) => job.completedPhases.includes(phase.id));
}

/** Application availability is independent of external copies completing. */
export function workspaceReady(job: ProvisioningStatus): boolean {
  return job.completedPhases.includes("team") && job.completedPhases.includes("tools");
}
