/**
 * Filename and storage-key hygiene for the CAD vault. Storage keys are
 * org-prefixed (mirroring scout_media) so the key itself proves tenancy, and
 * the migration CHECK (storage_key LIKE org_id || '/%') enforces it in SQL too.
 */

export function safeCadFilename(value: string): string {
  const file = value
    .replace(/(?:\.\.[/\\])+/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+(?=\.[a-zA-Z0-9]+$)/, "")
    .replace(/^\.+/, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 180);
  return file || "cad-file";
}

export function cadStorageKey(orgId: string, documentId: string, version: number, filename: string): string {
  return `${orgId}/cad-vault/${documentId}/v${version}/${safeCadFilename(filename)}`;
}

export class StorageKeyOrgMismatchError extends Error {
  constructor() {
    super("Storage key does not belong to this organization.");
    this.name = "StorageKeyOrgMismatchError";
  }
}

export function assertKeyForOrg(storageKey: string, orgId: string): void {
  if (!storageKey.startsWith(`${orgId}/`)) throw new StorageKeyOrgMismatchError();
}

/** Derive a human title from an uploaded filename: strip extension, de-kebab. */
export function titleFromFilename(filename: string): string {
  const base = safeCadFilename(filename).replace(/\.[a-zA-Z0-9]+$/, "");
  const spaced = base.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return (spaced || "Untitled part").slice(0, 160);
}
