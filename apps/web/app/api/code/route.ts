import { auth } from "@vantage/core";
import { buildDiffProposal, reviewFrcCode } from "@vantage/agent";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  createGitHubHttp,
  fetchGitHubFileSnippet,
  getGitHubAccessToken,
  loadEditorContextItems,
  requireOrgMember,
} from "../../../lib/github";

async function current() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

const fail = (error: unknown) =>
  Response.json(
    { error: error instanceof Error ? error.message : "Code assistant request failed" },
    { status: 400 },
  );

/**
 * Deterministic FRC code review + proposal-only diffs.
 * Does not deploy code or call live LLM providers.
 * Optionally hydrates content from VS Code context or org GitHub (never invents DEMO code).
 */
export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as {
      action?: "review" | "propose";
      orgId?: string;
      path?: string;
      content?: string;
      summary?: string;
      unifiedDiff?: string;
      editorContextId?: string;
      githubPath?: string;
      githubRepo?: string;
      githubRef?: string;
    };
    let path = String(body.path ?? "Robot.java").slice(0, 260);
    let content = String(body.content ?? "");
    const provenance: Array<{ type: string; label: string }> = [];

    if (!content.trim() && body.orgId && (body.editorContextId || body.githubPath)) {
      const hydrated = await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
        await requireOrgMember(client, body.orgId!, session.user.id);
        if (body.editorContextId) {
          const items = await loadEditorContextItems(client, body.orgId!, session.user.id, body.editorContextId);
          const first = items[0];
          if (first) {
            const match = first.id.match(/^vscode:[^:]+:(.+)$/);
            return {
              path: match?.[1] ?? path,
              content: first.content,
              provenance: [{ type: "vscode_selection", label: first.label }],
            };
          }
        }
        if (body.githubPath) {
          const authToken = await getGitHubAccessToken(client, body.orgId!);
          if (!authToken) {
            return { path, content: "", provenance: [] as Array<{ type: string; label: string }>, empty: "GitHub not connected" };
          }
          const fullName = body.githubRepo || authToken.connection.defaultRepoFullName;
          if (!fullName) {
            return { path, content: "", provenance: [], empty: "No default GitHub repo" };
          }
          const ref = body.githubRef || authToken.connection.defaultRepoDefaultBranch || "main";
          const snippet = await fetchGitHubFileSnippet(
            createGitHubHttp(authToken.accessToken),
            fullName,
            body.githubPath,
            ref,
          );
          return {
            path: snippet.path,
            content: snippet.content,
            provenance: [{ type: "github_file", label: `GitHub ${fullName}:${snippet.path}` }],
          };
        }
        return { path, content: "", provenance: [] as Array<{ type: string; label: string }> };
      });
      path = hydrated.path.slice(0, 260);
      content = hydrated.content;
      provenance.push(...hydrated.provenance);
      if (!content.trim()) {
        throw new Error(
          ("empty" in hydrated && hydrated.empty) ||
            "No editor/GitHub content available — paste code or connect GitHub / share from VS Code",
        );
      }
    }

    if (!content.trim()) throw new Error("content is required");
    if (content.length > 200_000) throw new Error("content exceeds the 200KB analysis limit");

    const review = reviewFrcCode({ path, content });
    if (body.action === "propose") {
      const proposal = buildDiffProposal({
        path,
        summary: String(body.summary ?? "Proposed safe change"),
        unifiedDiff: String(body.unifiedDiff ?? ""),
        review,
      });
      return Response.json({ review, proposal, provenance }, { status: 201 });
    }

    return Response.json({ review, provenance }, { status: 201 });
  } catch (error) {
    return fail(error);
  }
}
