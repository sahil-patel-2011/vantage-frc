import { parseOnshapeDocumentUrl } from "@vantage/cad/onshape-url-parse";
import { cadLinkKind } from "../cad-vault/cad-link";

/**
 * Vault documents that can feed the assembly book, and the bind that lets a
 * student pick one later without pasting the Onshape URL again.
 *
 * Fusion share links stay in the vault for Edit in Fusion. They cannot feed
 * this book — there is no assembly graph ingest for Fusion.
 */

export type VaultCadPlatform = "onshape" | "fusion" | "other";

export type VaultCadDocument = {
  id: string;
  title: string;
  externalUrl: string;
  seasonYear: number;
  platform: VaultCadPlatform;
  /** True when the stored URL names a workspace and element — enough to start. */
  bound: boolean;
};

export function canonicalOnshapeAssemblyUrl(
  documentId: string,
  workspaceId: string,
  elementId: string,
): string {
  return `https://cad.onshape.com/documents/${documentId}/w/${workspaceId}/e/${elementId}`;
}

export function onshapeUrlIsBoundAssembly(url: string): boolean {
  try {
    const parsed = parseOnshapeDocumentUrl(url);
    return Boolean(parsed.documentId && parsed.workspaceId && parsed.elementId);
  } catch {
    return false;
  }
}

export function vaultCadPlatform(url: string | null | undefined): VaultCadPlatform {
  return cadLinkKind(url);
}

export function classifyVaultDocuments(
  rows: Array<{ id: string; title: string; externalUrl: string; seasonYear: number }>,
): {
  onshape: VaultCadDocument[];
  fusionCount: number;
  fusionOnly: boolean;
} {
  const onshape: VaultCadDocument[] = [];
  let fusionCount = 0;
  for (const row of rows) {
    const platform = vaultCadPlatform(row.externalUrl);
    switch (platform) {
      case "fusion":
        fusionCount += 1;
        break;
      case "onshape":
        onshape.push({
          ...row,
          platform,
          bound: onshapeUrlIsBoundAssembly(row.externalUrl),
        });
        break;
      case "other":
        break;
      default: {
        const exhaustive: never = platform;
        void exhaustive;
        break;
      }
    }
  }
  return {
    onshape,
    fusionCount,
    fusionOnly: fusionCount > 0 && onshape.length === 0,
  };
}

export function findVaultDocumentForOnshape(
  docs: VaultCadDocument[],
  onshapeDocumentId: string,
): VaultCadDocument | undefined {
  return docs.find((doc) => {
    try {
      return parseOnshapeDocumentUrl(doc.externalUrl).documentId === onshapeDocumentId;
    } catch {
      return false;
    }
  });
}
