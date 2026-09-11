/**
 * Student-facing Fusion setup copy. Safe for Client Components.
 * Never names OAuth, env vars, CLI commands, or Vercel.
 */

export const FUSION_MISSING_CONFIG_MESSAGE =
  "Ask a mentor to finish Fusion setup for this team. You can still paste a Fusion share link to edit it.";

export const FUSION_READY_MESSAGE =
  "Paste a Fusion share link to edit it, or pair this computer for Autodesk jobs.";

export const FUSION_STUDENT_PERMISSIONS =
  "Fusion stays on this computer. Pair it from CAD Connections.";

export type FusionHostedSetup = {
  configured: boolean;
  setupRequired: boolean;
  status: "setup_required" | "ready";
  message: string;
};

export function fusionHostedReady(): FusionHostedSetup {
  return {
    configured: true,
    setupRequired: false,
    status: "ready",
    message: FUSION_READY_MESSAGE,
  };
}

export function fusionHostedBlocked(): FusionHostedSetup {
  return {
    configured: false,
    setupRequired: true,
    status: "setup_required",
    message: FUSION_MISSING_CONFIG_MESSAGE,
  };
}
