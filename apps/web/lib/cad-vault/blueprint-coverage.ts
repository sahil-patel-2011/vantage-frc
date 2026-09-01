/**
 * Blueprint CAD coverage: a subsystem has CAD when it has a https cad_url
 * OR a non-archived cad_documents row linked via subsystem_id.
 *
 * No Onshape/Fusion live call is required — a vault row (uploaded file or
 * metadata shell) is enough. This module never invents geometry or STLs.
 */

export type CadCoverageInput = {
  cadUrl?: string | null;
  vaultDocumentCount?: number;
};

export type BlueprintCadSubsystem = {
  id: string;
  cadUrl?: string | null;
};

export type VaultCoverageRow = {
  subsystemId: string | null;
  status?: string;
};

function trimmedCadUrl(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** True when the subsystem has a CAD URL or at least one vault document. */
export function hasCadCoverage(input: CadCoverageInput): boolean {
  if (trimmedCadUrl(input.cadUrl)) return true;
  return (input.vaultDocumentCount ?? 0) > 0;
}

/** Subsystem IDs that have a non-archived cad_documents row. */
export function vaultedSubsystemIds(documents: readonly VaultCoverageRow[]): Set<string> {
  const ids = new Set<string>();
  for (const document of documents) {
    if (!document.subsystemId) continue;
    if (document.status === "archived") continue;
    ids.add(document.subsystemId);
  }
  return ids;
}

export function countMissingCad(
  subsystems: ReadonlyArray<CadCoverageInput & { id?: string }>,
  vaultedIds?: ReadonlySet<string>,
): number {
  return subsystems.filter((subsystem) => {
    const vaultCount =
      subsystem.vaultDocumentCount ??
      (subsystem.id && vaultedIds?.has(subsystem.id) ? 1 : 0);
    return !hasCadCoverage({ cadUrl: subsystem.cadUrl, vaultDocumentCount: vaultCount });
  }).length;
}

/**
 * Blueprint missingCad: subsystems with neither a CAD URL nor a vault row.
 * Archived vault rows do not count; unassigned documents do not cover anyone.
 */
export function blueprintMissingCad(
  subsystems: readonly BlueprintCadSubsystem[],
  documents: readonly VaultCoverageRow[],
): number {
  return countMissingCad(subsystems, vaultedSubsystemIds(documents));
}
