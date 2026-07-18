import type { PoolClient } from "@neondatabase/serverless";
import type { ContextItem } from "@vantage/agent";
import {
  createGitHubHttp,
  fetchGitHubFileSnippet,
  fetchGitHubTree,
  formatGitHubFileContext,
  formatGitHubTreeContext,
  GITHUB_MAX_CONTEXT_CHARS,
  GITHUB_MAX_FILE_CHARS,
} from "./api";
import { getGitHubAccessToken } from "./tokens";

export type GitHubContextRequest = {
  /** owner/repo — defaults to org connection default repo */
  repoFullName?: string;
  ref?: string;
  /** File paths to fetch (size-capped). Prefer few focused files. */
  paths?: string[];
  /** When true, include a truncated tree listing for the ref. */
  includeTree?: boolean;
};

export type EditorContextPayload = {
  intent?: string;
  relativePath?: string | null;
  languageId?: string | null;
  selection?: { startLine?: number | null; endLine?: number | null; text?: string | null } | null;
  fileContent?: string | null;
  diagnostics?: Array<{ severity?: string; message?: string; line?: number }>;
  prompt?: string | null;
};

export type BridgeContextItem = ContextItem & {
  classification: "github_file" | "vscode_selection" | "artifact";
  sourceUrl?: string;
  label: string;
};

/**
 * Load size-capped GitHub snippets for AI context. Returns empty when not connected
 * or when paths/tree yield nothing — never invents DEMO code.
 */
export async function loadGitHubContextItems(
  client: PoolClient,
  orgId: string,
  request: GitHubContextRequest = {},
): Promise<BridgeContextItem[]> {
  const auth = await getGitHubAccessToken(client, orgId);
  if (!auth) return [];

  const fullName = (request.repoFullName ?? auth.connection.defaultRepoFullName ?? "").trim();
  if (!fullName) return [];

  const ref = (request.ref ?? auth.connection.defaultRepoDefaultBranch ?? "main").trim() || "main";
  const http = createGitHubHttp(auth.accessToken);
  const items: BridgeContextItem[] = [];
  let usedChars = 0;

  const paths = (request.paths ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 8);
  for (const path of paths) {
    if (usedChars >= GITHUB_MAX_CONTEXT_CHARS) break;
    try {
      const remaining = GITHUB_MAX_CONTEXT_CHARS - usedChars;
      const snippet = await fetchGitHubFileSnippet(
        http,
        fullName,
        path,
        ref,
        Math.min(GITHUB_MAX_FILE_CHARS, remaining),
      );
      const content = formatGitHubFileContext(snippet);
      usedChars += content.length;
      items.push({
        type: "github_file",
        id: `github:${fullName}:${ref}:${path}`,
        content,
        importance: 900,
        classification: "github_file",
        sourceUrl: snippet.htmlUrl ?? undefined,
        label: `GitHub ${fullName}:${path}`,
      });
    } catch {
      // Skip inaccessible / binary / missing paths — do not fabricate content.
    }
  }

  if (request.includeTree && usedChars < GITHUB_MAX_CONTEXT_CHARS) {
    try {
      const tree = await fetchGitHubTree(http, fullName, ref);
      const content = formatGitHubTreeContext({
        fullName,
        ref: tree.ref,
        entries: tree.entries,
        truncated: tree.truncated,
      }).slice(0, GITHUB_MAX_CONTEXT_CHARS - usedChars);
      if (content.trim()) {
        items.push({
          type: "github_file",
          id: `github-tree:${fullName}:${ref}`,
          content,
          importance: 700,
          classification: "github_file",
          label: `GitHub tree ${fullName}@${ref}`,
        });
      }
    } catch {
      // Tree optional.
    }
  }

  return items;
}

export async function loadEditorContextItems(
  client: PoolClient,
  orgId: string,
  userId: string,
  contextId: string,
): Promise<BridgeContextItem[]> {
  if (!contextId.trim()) return [];
  try {
    const result = await client.query<{
      id: string;
      relative_path: string | null;
      payload: EditorContextPayload;
    }>(
      `SELECT id, relative_path, payload
       FROM editor_context_submissions
       WHERE id=$1::uuid AND org_id=$2::uuid AND user_id=$3::uuid
       LIMIT 1`,
      [contextId, orgId, userId],
    );
    const row = result.rows[0];
    if (!row?.payload) return [];

    const payload = row.payload;
    const path = payload.relativePath ?? row.relative_path ?? "editor";
    const selection = payload.selection?.text?.trim()
      ? payload.selection.text.slice(0, GITHUB_MAX_FILE_CHARS)
      : "";
    const file = typeof payload.fileContent === "string" ? payload.fileContent.slice(0, GITHUB_MAX_FILE_CHARS) : "";
    const body = selection || file;
    if (!body.trim()) return [];

    const lines =
      payload.selection?.startLine != null && payload.selection?.endLine != null
        ? ` lines ${payload.selection.startLine}-${payload.selection.endLine}`
        : "";
    const diag =
      Array.isArray(payload.diagnostics) && payload.diagnostics.length
        ? `\nDiagnostics:\n${payload.diagnostics
            .slice(0, 20)
            .map((d) => `- ${d.severity ?? "info"} L${d.line ?? "?"}: ${d.message ?? ""}`)
            .join("\n")}`
        : "";

    const content = [
      `[VS Code ${payload.intent ?? "selection"}] ${path}${lines}`,
      payload.languageId ? `language: ${payload.languageId}` : null,
      "```",
      body,
      "```",
      diag || null,
    ]
      .filter(Boolean)
      .join("\n");

    return [
      {
        type: "vscode_selection",
        id: `vscode:${row.id}:${path}`,
        content: content.slice(0, GITHUB_MAX_CONTEXT_CHARS),
        importance: 950,
        classification: "vscode_selection",
        label: selection
          ? `VS Code selection ${path}${lines}`
          : `VS Code file ${path}`,
      },
    ];
  } catch {
    // Table missing or RLS denied — skip.
    return [];
  }
}
