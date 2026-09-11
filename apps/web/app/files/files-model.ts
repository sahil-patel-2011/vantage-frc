import type {
  DriveFile,
  DriveFolder,
  DriveScope,
  DriveSharedWithMe,
  DriveVirtualFolder,
} from "../../lib/drive/types";

export type Rail = "my" | "team" | "shared" | "recent" | "trash";

export type Listing =
  | { status: "loading" }
  | { status: "error"; message: string; detail: string }
  | { status: "setup_required"; reason: string }
  | {
      status: "ready";
      orgId: string;
      orgName: string;
      scope: DriveScope;
      folderId: string | null;
      breadcrumbs: Array<{ id: string | null; name: string }>;
      folders: DriveFolder[];
      files: DriveFile[];
      virtualFolders: DriveVirtualFolder[];
      usage: { dbBytes: number; nodeBytes: number; objectBytes: number; fileCount: number };
      viewer: { userId: string; email: string; role: string };
    }
  | { status: "shared"; orgId: string; orgName: string; shares: DriveSharedWithMe[] }
  | { status: "list"; orgId: string; orgName: string; files: DriveFile[]; rail: Rail };

export const RAILS: Array<{ id: Rail; label: string; hint: string }> = [
  { id: "my", label: "My files", hint: "Yours alone. Nobody else on the team can open these." },
  { id: "team", label: "Team files", hint: "Everyone on the team can open these." },
  { id: "shared", label: "Shared with me", hint: "Files other people sent to your email address." },
  { id: "recent", label: "Recent", hint: "The newest files you can see." },
  { id: "trash", label: "Bin", hint: "Deleted files, still restorable." },
];

export type ShareDialogState = {
  target: { kind: "file" | "folder"; id: string; name: string };
} | null;

export function railScope(rail: Rail): DriveScope {
  return rail === "my" ? "personal" : "team";
}

export function fileIcon(file: { contentClass: string; contentType: string }): string {
  if (file.contentClass === "video") return "▶";
  if (file.contentClass === "photo") return "▣";
  if (file.contentClass === "cad") return "◈";
  if (file.contentClass === "archive") return "▥";
  if (file.contentType === "application/pdf") return "▤";
  return "▢";
}

export function storageLabel(file: DriveFile): string {
  if (file.storageLocation === "node") return "On your storage node";
  if (file.storageLocation === "object") return "In hosted storage";
  return "In Vantage";
}

export function formatWhen(value: string | null): string {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return value;
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
