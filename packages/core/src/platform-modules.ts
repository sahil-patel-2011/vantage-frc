/**
 * Bounded contexts for this monorepo. Keep features here — do not split into
 * microservices. One Vercel app (`apps/web`) + RLS is the tenancy model.
 * Agents should edit the listed package instead of inventing a new service.
 */
export const PLATFORM_MODULES = [
  { id: "identity", package: "@vantage/core", owns: "auth, onboarding, tenancy helpers" },
  { id: "data", package: "@vantage/db", owns: "schema, migrations, withRls" },
  { id: "billing", package: "@vantage/billing", owns: "credits, BYOK envelopes, Stripe catalog" },
  { id: "agent", package: "@vantage/agent", owns: "chat, autonomous loop, Bugbot routing, memory retrieve" },
  { id: "cad", package: "@vantage/cad", owns: "Onshape/Fusion connectors, Claude CAD agent" },
  { id: "scouting", package: "@vantage/scouting", owns: "forms, QR, offline merge" },
  { id: "strategy", package: "@vantage/prediction-strategy", owns: "match prediction, private edge" },
  { id: "web", package: "@vantage/web", owns: "all session-protected product UI and API routes" },
  { id: "desktop", package: "@vantage/desktop", owns: "Windows Electron shell around the hosted app" },
] as const;

export type PlatformModuleId = (typeof PLATFORM_MODULES)[number]["id"];

export function moduleForPackage(name: string) {
  return PLATFORM_MODULES.find((entry) => entry.package === name) ?? null;
}
