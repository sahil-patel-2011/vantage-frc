import {
  BUGBOT_SCAN_CHUNK_FILES,
  formatBugbotScanBundle,
  isBugbotScanPath,
  planBugbotScan,
  type BugbotScanPlan,
  type BugbotSkipReason,
} from "@vantage/agent/bugbot";
import { asCommitSha } from "../bugbot/grounding";
import { GITHUB_API_BASE } from "./oauth";

export const GITHUB_MAX_FILE_CHARS = 48_000;
export const GITHUB_MAX_TREE_ENTRIES = 200;
/** Scan planning classifies the WHOLE tree so the skip report is honest. */
export const GITHUB_MAX_SCAN_TREE_ENTRIES = 5_000;
/** Per-file chars pulled into one scan chunk. */
export const GITHUB_SCAN_FILE_CHARS = 12_000;
export const GITHUB_MAX_CONTEXT_CHARS = 48_000;

export type GitHubRepoSummary = {
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  htmlUrl: string;
  language: string | null;
  updatedAt: string | null;
};

export type GitHubTreeEntry = {
  path: string;
  type: "blob" | "tree" | "commit" | string;
  size?: number;
};

export type GitHubFileSnippet = {
  path: string;
  fullName: string;
  ref: string;
  content: string;
  truncated: boolean;
  size: number;
  htmlUrl: string | null;
};

type GitHubHttp = (path: string, init?: RequestInit) => Promise<Response>;

export function createGitHubHttp(accessToken: string, apiBase = GITHUB_API_BASE): GitHubHttp {
  return (path, init = {}) =>
    fetch(`${apiBase}${path.startsWith("/") ? path : `/${path}`}`, {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "x-github-api-version": "2022-11-28",
        "user-agent": "Vantage-FRC-ContextBridge",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
}

export async function fetchGitHubUser(http: GitHubHttp) {
  const response = await http("/user");
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.message ?? "Failed to load GitHub user"));
  return {
    login: String(data.login ?? ""),
    id: data.id != null ? String(data.id) : "",
    name: data.name ? String(data.name) : null,
  };
}

export async function listGitHubRepos(http: GitHubHttp, limit = 50): Promise<GitHubRepoSummary[]> {
  const perPage = Math.min(100, Math.max(1, limit));
  const response = await http(
    `/user/repos?per_page=${perPage}&sort=updated&affiliation=owner,collaborator,organization_member`,
  );
  const data = (await response.json()) as Array<Record<string, unknown>> | { message?: string };
  if (!response.ok) {
    throw new Error(String((data as { message?: string }).message ?? "Failed to list GitHub repositories"));
  }
  return (data as Array<Record<string, unknown>>).slice(0, limit).map((item) => ({
    fullName: String(item.full_name ?? ""),
    name: String(item.name ?? ""),
    private: Boolean(item.private),
    defaultBranch: String(item.default_branch ?? "main"),
    description: item.description ? String(item.description) : null,
    htmlUrl: String(item.html_url ?? ""),
    language: item.language ? String(item.language) : null,
    updatedAt: item.updated_at ? String(item.updated_at) : null,
  }));
}

export type GitHubMilestoneCalendarItem = {
  id: string;
  title: string;
  dueOn: string;
  htmlUrl: string;
};

/** Keep milestones that have a real GitHub due date — never invent one. */
export function parseGitHubMilestoneCalendarItems(payload: unknown): GitHubMilestoneCalendarItem[] {
  if (!Array.isArray(payload)) return [];
  const items: GitHubMilestoneCalendarItem[] = [];
  for (const raw of payload) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const dueOn = typeof row.due_on === "string" ? row.due_on.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueOn)) continue;
    const title = String(row.title ?? "").trim();
    const htmlUrl = String(row.html_url ?? "").trim();
    if (!title || !htmlUrl.startsWith("https://")) continue;
    const number = typeof row.number === "number" ? row.number : items.length;
    items.push({
      id: `ms-${number}`,
      title,
      dueOn,
      htmlUrl,
    });
  }
  return items;
}

export async function fetchGitHubMilestoneCalendarItems(
  http: GitHubHttp,
  fullName: string,
): Promise<GitHubMilestoneCalendarItem[]> {
  const { owner, repo } = parseOwnerRepo(fullName);
  const response = await http(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/milestones?state=open&per_page=25&sort=due_date&direction=asc`,
  );
  const data = (await response.json()) as unknown;
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data
        ? String((data as { message?: string }).message)
        : "Failed to load GitHub milestones";
    throw new Error(message);
  }
  return parseGitHubMilestoneCalendarItems(data);
}

function parseOwnerRepo(fullName: string): { owner: string; repo: string } {
  const [owner, repo] = fullName.split("/");
  if (!owner?.trim() || !repo?.trim() || fullName.includes("..")) {
    throw new Error("Invalid repository full name (expected owner/repo)");
  }
  return { owner: owner.trim(), repo: repo.trim() };
}

export async function fetchGitHubRepoMeta(http: GitHubHttp, fullName: string) {
  const { owner, repo } = parseOwnerRepo(fullName);
  const response = await http(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.message ?? "Repository not found or inaccessible"));
  return {
    fullName: String(data.full_name ?? fullName),
    defaultBranch: String(data.default_branch ?? "main"),
    private: Boolean(data.private),
    htmlUrl: String(data.html_url ?? ""),
  };
}

/**
 * Resolve a branch/tag/sha ref to the exact commit sha it points at right now.
 * Null when unresolvable (missing ref, revoked token, network) — callers fall
 * back to the symbolic ref rather than failing the whole request.
 */
export async function resolveGitHubCommitSha(
  http: GitHubHttp,
  fullName: string,
  ref: string,
): Promise<string | null> {
  const { owner, repo } = parseOwnerRepo(fullName);
  try {
    const response = await http(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(ref)}`,
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { sha?: unknown };
    return asCommitSha(typeof data.sha === "string" ? data.sha : null);
  } catch {
    return null;
  }
}

export async function fetchGitHubTree(
  http: GitHubHttp,
  fullName: string,
  ref: string,
  options?: { recursive?: boolean; maxEntries?: number; keep?: (entry: GitHubTreeEntry) => boolean },
): Promise<{ truncated: boolean; entries: GitHubTreeEntry[]; ref: string }> {
  const { owner, repo } = parseOwnerRepo(fullName);
  const maxEntries = options?.maxEntries ?? GITHUB_MAX_TREE_ENTRIES;
  const recursive = options?.recursive !== false;
  const response = await http(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=${recursive ? "1" : "0"}`,
  );
  const data = (await response.json()) as {
    message?: string;
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string; size?: number }>;
  };
  if (!response.ok) throw new Error(String(data.message ?? "Failed to load repository tree"));
  // Filter BEFORE the cap: on a real WPILib repo the first 200 entries are gradle
  // and vendordeps, so capping first would hide src/main/java entirely.
  const all = (data.tree ?? [])
    .filter((item) => item.path && item.type)
    .map((item) => ({
      path: String(item.path),
      type: String(item.type),
      size: typeof item.size === "number" ? item.size : undefined,
    }));
  const kept = options?.keep ? all.filter(options.keep) : all;
  return {
    truncated: Boolean(data.truncated) || kept.length > maxEntries,
    entries: kept.slice(0, maxEntries),
    ref,
  };
}

export async function fetchGitHubFileSnippet(
  http: GitHubHttp,
  fullName: string,
  path: string,
  ref: string,
  maxChars = GITHUB_MAX_FILE_CHARS,
): Promise<GitHubFileSnippet> {
  const { owner, repo } = parseOwnerRepo(fullName);
  const cleanPath = path.replace(/^\/+/, "");
  if (!cleanPath || cleanPath.includes("..")) throw new Error("Invalid file path");
  const response = await http(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${cleanPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=${encodeURIComponent(ref)}`,
  );
  const data = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.message ?? "Failed to load file"));
  if (data.type !== "file") throw new Error("Path is not a file");
  if (data.encoding === "base64" && typeof data.content === "string") {
    const raw = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
    const truncated = raw.length > maxChars;
    return {
      path: cleanPath,
      fullName,
      ref,
      content: truncated ? raw.slice(0, maxChars) : raw,
      truncated,
      size: typeof data.size === "number" ? data.size : raw.length,
      htmlUrl: data.html_url ? String(data.html_url) : null,
    };
  }
  throw new Error("Unsupported GitHub content encoding (binary or non-base64 files are skipped)");
}

export function formatGitHubFileContext(snippet: GitHubFileSnippet): string {
  const header = [
    `[GitHub file] ${snippet.fullName}@${snippet.ref}:${snippet.path}`,
    snippet.truncated ? `(truncated to ${snippet.content.length} chars; original size ${snippet.size})` : null,
    snippet.htmlUrl ? `url: ${snippet.htmlUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${header}\n\`\`\`\n${snippet.content}\n\`\`\``;
}

export function formatGitHubTreeContext(input: {
  fullName: string;
  ref: string;
  entries: GitHubTreeEntry[];
  truncated: boolean;
}): string {
  const lines = input.entries.map((e) => `${e.type === "tree" ? "dir " : "file"} ${e.path}`);
  return [
    `[GitHub tree] ${input.fullName}@${input.ref}`,
    input.truncated ? "(tree listing truncated)" : null,
    lines.join("\n") || "(empty tree)",
  ]
    .filter(Boolean)
    .join("\n");
}

export type GitHubScanBundle = {
  path: string;
  content: string;
  filesScanned: number;
  truncated: boolean;
  files: string[];
  fileContents: Array<{ path: string; content: string }>;
  /** Files the plan chose that could not be read (binary / encoding / gone). */
  unreadable: Array<{ path: string; reason: BugbotSkipReason }>;
  fullName: string;
  ref: string;
  treeTruncated: boolean;
  emptyReason: string | null;
};

/**
 * Plan a repo scan without spending a metered call: what will be reviewed, what is
 * skipped and why, how many chunks it takes, and therefore what it costs.
 */
export async function planGitHubBugbotScan(
  http: GitHubHttp,
  fullName: string,
  ref: string,
  options?: { chunkFiles?: number; maxChunks?: number; includeTests?: boolean },
): Promise<BugbotScanPlan> {
  const tree = await fetchGitHubTree(http, fullName, ref, { maxEntries: GITHUB_MAX_SCAN_TREE_ENTRIES });
  return planBugbotScan(tree.entries, {
    chunkFiles: options?.chunkFiles,
    maxChunks: options?.maxChunks,
    treeTruncated: tree.truncated,
    includeTests: options?.includeTests,
  });
}

/**
 * Load a size-capped robot-code bundle for Bugbot. Skips unreadable blobs.
 * Never invents DEMO source when the tree is empty or disconnected.
 *
 * `files` scans exactly that list (one chunk of a planned scan); every path is
 * re-checked against the scan classifier so a caller cannot smuggle in a lockfile.
 */
export async function fetchGitHubScanBundle(
  http: GitHubHttp,
  fullName: string,
  ref: string,
  options?: { files?: string[]; includeTests?: boolean },
): Promise<GitHubScanBundle> {
  let paths: string[];
  let treeTruncated = false;
  if (options?.files?.length) {
    paths = options.files
      .filter((path) => isBugbotScanPath(path, { includeTests: options.includeTests }))
      .slice(0, BUGBOT_SCAN_CHUNK_FILES);
  } else {
    const plan = await planGitHubBugbotScan(http, fullName, ref, {
      maxChunks: 1,
      includeTests: options?.includeTests,
    });
    paths = plan.chunks[0] ?? [];
    treeTruncated = plan.treeTruncated;
  }
  const files: Array<{ path: string; content: string }> = [];
  const unreadable: Array<{ path: string; reason: BugbotSkipReason }> = [];
  for (const path of paths) {
    try {
      const snippet = await fetchGitHubFileSnippet(http, fullName, path, ref, GITHUB_SCAN_FILE_CHARS);
      if (snippet.content.trim()) files.push({ path: snippet.path, content: snippet.content });
      else unreadable.push({ path, reason: "not_robot_code" });
    } catch {
      // Binary / missing / encoding skip — never fabricate the file, always report it.
      unreadable.push({ path, reason: "not_robot_code" });
    }
  }
  const bundle = formatBugbotScanBundle(files);
  return {
    ...bundle,
    files: files.map((file) => file.path),
    fileContents: files,
    unreadable,
    fullName,
    ref,
    treeTruncated,
    emptyReason: bundle.filesScanned
      ? null
      : paths.length
        ? "Robot-code files in this repo could not be read (binary or encoding)."
        : "No robot-code files (.java, .cpp, .py, …) in the connected repo tree.",
  };
}

const OVERVIEW_FETCH_PATHS = [
  "README.md",
  "README",
  ".wpilib/wpilib_preferences.json",
  "build.gradle",
] as const;

/**
 * Read a few well-known files so Bugbot can say what the repo is.
 * Missing files stay missing — never a DEMO README.
 */
export async function fetchGitHubRepoOverviewFiles(
  http: GitHubHttp,
  fullName: string,
  ref: string,
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  for (const path of OVERVIEW_FETCH_PATHS) {
    try {
      const snippet = await fetchGitHubFileSnippet(http, fullName, path, ref, 4_000);
      if (snippet.content.trim()) files.push({ path: snippet.path, content: snippet.content });
    } catch {
      /* 404 / binary — skip */
    }
  }
  return files;
}
