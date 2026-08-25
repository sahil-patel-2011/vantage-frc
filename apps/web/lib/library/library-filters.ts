/**
 * Pure browse helpers: type classification (CAD / document / image / link /
 * archive / code / other) and the search + filter pipeline for the shelf UI.
 */

import type { LibraryResource, LibraryResourceKind, LibraryResourceType } from "./types";

const CAD_EXTENSIONS = new Set([
  "step", "stp", "iges", "igs", "dxf", "dwg", "f3d", "f3z",
  "sldprt", "sldasm", "slddrw", "ipt", "iam", "idw",
  "x_t", "x_b", "stl", "3mf", "obj", "par", "psm", "catpart", "catproduct",
]);

const DOCUMENT_EXTENSIONS = new Set([
  "pdf", "doc", "docx", "odt", "rtf", "txt", "md", "ppt", "pptx", "odp",
  "xls", "xlsx", "ods", "csv",
]);

const ARCHIVE_EXTENSIONS = new Set(["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"]);

const CODE_EXTENSIONS = new Set([
  "java", "py", "js", "jsx", "ts", "tsx", "c", "h", "cpp", "hpp", "cs", "kt", "rs",
  "go", "rb", "sh", "bat", "ps1", "json", "yaml", "yml", "toml", "xml", "html", "css",
  "sql", "ino", "gradle",
]);

export function fileExtension(fileName: string | null): string | null {
  if (!fileName) return null;
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * Classify a resource for browse filters. Extension wins for files (CAD
 * formats rarely carry a useful MIME type); content-type is the fallback.
 */
export function classifyResourceType(
  kind: LibraryResourceKind,
  contentType: string | null,
  fileName: string | null,
): LibraryResourceType {
  if (kind === "link") return "link";
  const ext = fileExtension(fileName);
  if (ext) {
    if (CAD_EXTENSIONS.has(ext)) return "cad";
    if (DOCUMENT_EXTENSIONS.has(ext)) return "document";
    if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
    if (CODE_EXTENSIONS.has(ext)) return "code";
  }
  const type = contentType?.toLowerCase() ?? "";
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf" || type.startsWith("text/")) return "document";
  if (type.includes("zip") || type.includes("compressed") || type.includes("tar")) return "archive";
  return "other";
}

export const TYPE_LABELS: Record<LibraryResourceType, string> = {
  cad: "CAD",
  document: "Documents",
  image: "Images",
  archive: "Archives",
  code: "Code",
  link: "Links",
  other: "Other",
};

export type LibraryFilter = {
  /** Search across title, file name, tags, and notes. Empty = no search. */
  query: string;
  type: LibraryResourceType | "all";
  /** Folder scope: a folder id, null for the root, or "all". */
  folderId: string | null | "all";
};

function matchesQuery(resource: LibraryResource, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    resource.title,
    resource.fileName ?? "",
    resource.notes ?? "",
    resource.url ?? "",
    ...resource.tags,
  ]
    .join(" ")
    .toLowerCase();
  return q
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * Search + filter pipeline. A non-empty query searches across ALL folders
 * (finding a file must not depend on knowing where it lives); an empty query
 * browses the current folder only.
 */
export function filterResources(
  resources: LibraryResource[],
  filter: LibraryFilter,
): LibraryResource[] {
  const searching = filter.query.trim().length > 0;
  return resources.filter((resource) => {
    if (filter.type !== "all" && resource.type !== filter.type) return false;
    if (!searching && filter.folderId !== "all" && resource.folderId !== filter.folderId) {
      return false;
    }
    return matchesQuery(resource, filter.query);
  });
}

/** Real per-folder resource counts (never fabricated). */
export function folderResourceCounts(resources: LibraryResource[]): Map<string | null, number> {
  const counts = new Map<string | null, number>();
  for (const resource of resources) {
    counts.set(resource.folderId, (counts.get(resource.folderId) ?? 0) + 1);
  }
  return counts;
}
