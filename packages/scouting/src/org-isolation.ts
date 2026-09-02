/**
 * Pure org-isolation guards for custom forms, scout media (images/audio), and voice notes.
 * Server RLS is the backstop; these helpers keep client outbox sync and storage keys
 * from writing Org A's content under Org B's orgId.
 */

export class OrgIsolationError extends Error {
  constructor(
    readonly status: 403,
    message: string,
  ) {
    super(message);
    this.name = "OrgIsolationError";
  }
}

/** Mirrors membership-gate denial used by withScoutingRequest. */
export function isWrongOrgDenied(membershipRowCount: number): boolean {
  return membershipRowCount === 0;
}

/**
 * When the caller supplies an explicit orgId, zero membership rows must be a hard 403 —
 * never a soft empty/setup response that could hide a cross-tenant probe.
 */
export function assertExplicitOrgAccess(
  requestedOrg: string | null | undefined,
  membershipRowCount: number,
): void {
  if (requestedOrg && isWrongOrgDenied(membershipRowCount)) {
    throw new OrgIsolationError(403, "Organization access denied");
  }
}

export function storageKeyBelongsToOrg(storageKey: string, orgId: string): boolean {
  if (!orgId || !storageKey) return false;
  return storageKey === orgId || storageKey.startsWith(`${orgId}/`);
}

export function assertStorageKeyForOrg(storageKey: string, orgId: string): void {
  if (!storageKeyBelongsToOrg(storageKey, orgId)) {
    throw new OrgIsolationError(403, "Media storage key does not belong to this organization");
  }
}

/** Build the tenant-prefixed key used by LocalMediaStorage / scout_media constraint. */
export function orgScopedStorageKey(orgId: string, clientId: string): string {
  if (!orgId.trim()) throw new OrgIsolationError(403, "orgId is required for media storage");
  if (!clientId.trim()) throw new Error("clientId is required for media storage");
  return `${orgId}/local/${clientId}`;
}

export function orgIdFromUploadUrl(uploadUrl: string): string | null {
  try {
    const url = new URL(uploadUrl, "https://vantage.local");
    const value = url.searchParams.get("orgId");
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export type ScoutMediaVariant = "full" | "thumb";

/**
 * Org-stamped media URL for the full photo or its thumbnail. The orgId lives in
 * the query string on purpose: the server route re-checks membership for that
 * org and the service worker caches per URL, so a thumb fetched under Org A
 * can never be served to a session scoped to Org B.
 */
export function scoutMediaVariantUrl(
  orgId: string,
  clientId: string,
  variant: ScoutMediaVariant = "full",
): string {
  if (!orgId.trim()) throw new OrgIsolationError(403, "orgId is required for media URLs");
  if (!clientId.trim()) throw new Error("clientId is required for media URLs");
  const base = `/api/scouting/media/${encodeURIComponent(clientId)}?orgId=${encodeURIComponent(orgId)}`;
  return variant === "thumb" ? `${base}&variant=thumb` : base;
}

/** A media URL (full or thumb variant) must carry the org the session is scoped to. */
export function assertMediaUrlForOrg(mediaUrl: string, orgId: string): void {
  const urlOrg = orgIdFromUploadUrl(mediaUrl);
  if (!urlOrg || !orgId || urlOrg !== orgId) {
    throw new OrgIsolationError(403, "Media URL does not belong to this organization");
  }
}

export function resourceBelongsToOrg(
  resourceOrgId: string | null | undefined,
  requestOrgId: string,
): boolean {
  return Boolean(resourceOrgId && requestOrgId && resourceOrgId === requestOrgId);
}

export function assertResourceInOrg(
  resourceOrgId: string | null | undefined,
  requestOrgId: string,
  label = "Resource",
): void {
  if (!resourceBelongsToOrg(resourceOrgId, requestOrgId)) {
    throw new OrgIsolationError(403, `${label} not found in this organization`);
  }
}

/** Custom form schemas are org-owned — never return a foreign schema by id alone. */
export function filterSchemasForOrg<T extends { orgId: string }>(
  schemas: T[],
  orgId: string,
): T[] {
  return schemas.filter((schema) => schema.orgId === orgId);
}

/** Images / audio / voice-note media rows must match the request org. */
export function filterMediaForOrg<T extends { orgId: string }>(media: T[], orgId: string): T[] {
  return media.filter((row) => row.orgId === orgId);
}

/**
 * Voice notes (source=voice entries or audio media with transcript) stay in their org.
 * Rows without orgId are treated as unscoped and excluded (cannot leak into another tenant).
 */
export function filterVoiceNotesForOrg<
  T extends { orgId?: string | null; source?: string; kind?: string; transcript?: string | null },
>(rows: T[], orgId: string): T[] {
  return rows.filter((row) => {
    if (row.orgId == null || row.orgId !== orgId) return false;
    const isVoiceEntry = row.source === "voice";
    const isVoiceMedia = row.kind === "audio" || Boolean(row.transcript);
    return isVoiceEntry || isVoiceMedia;
  });
}

export function partitionByOrgId<T extends { orgId?: string | null }>(
  items: T[],
  orgId: string,
): { allowed: T[]; blocked: T[] } {
  const allowed: T[] = [];
  const blocked: T[] = [];
  for (const item of items) {
    if (item.orgId === orgId) allowed.push(item);
    else blocked.push(item);
  }
  return { allowed, blocked };
}

/** Detects whether syncing an outbox item under requestOrgId would cross tenants. */
export function wouldCrossOrgLeak(
  itemOrgId: string | null | undefined,
  requestOrgId: string,
): boolean {
  if (!requestOrgId) return true;
  if (itemOrgId == null || itemOrgId === "") return true;
  return itemOrgId !== requestOrgId;
}
