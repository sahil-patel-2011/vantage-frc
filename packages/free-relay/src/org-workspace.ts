/**
 * Per-team coding folders on the shared Freebuff Pi.
 *
 * One Coder UI session serves many orgs. Files never land in a shared dump —
 * each org gets `FREEBUFF_WORKSPACE_ROOT/org-<uuid>/` and nothing else.
 * Isolation of chat context is still enforced in @vantage/agent; this module
 * only keeps on-disk work separated.
 */

const ORG_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PLATFORM_FREEBUFF_RELAY_NAME = "frcvantagefreebuff relay";
export const DEFAULT_WORKSPACE_ROOT = "vantage-freebuff/orgs";

export function isOrgWorkspaceId(value: string | null | undefined): boolean {
  return typeof value === "string" && ORG_ID.test(value.trim());
}

export function orgWorkspaceFolderName(orgId: string): string {
  const id = orgId.trim().toLowerCase();
  if (!ORG_ID.test(id)) {
    throw new Error("org workspace requires a UUID — refusing a shared or named folder");
  }
  return `org-${id}`;
}

export function resolveWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.FREEBUFF_WORKSPACE_ROOT?.trim();
  if (configured) return configured.replace(/[\\/]+$/, "");
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || ".";
  return `${home.replace(/[\\/]+$/, "")}/${DEFAULT_WORKSPACE_ROOT}`;
}

export function orgWorkspacePath(orgId: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${resolveWorkspaceRoot(env)}/${orgWorkspaceFolderName(orgId)}`;
}

export function parseOrgIdHeader(value: string | null | undefined): string | null {
  const id = String(value ?? "").trim().toLowerCase();
  return ORG_ID.test(id) ? id : null;
}

export function isolationFolderNote(orgId: string, folder: string): string {
  return `Coding folder for organization ${orgId} only: ${folder}. Do not read or write any sibling org-* folder.`;
}
