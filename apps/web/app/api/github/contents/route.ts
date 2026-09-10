import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  createGitHubHttp,
  fetchGitHubFileSnippet,
  fetchGitHubTree,
  getGitHubAccessToken,
  GITHUB_MAX_FILE_CHARS,
  requireOrgMember,
} from "../../../../lib/github";

/**
 * Size-capped file/tree snippets for AI context. Members may read; never returns
 * fabricated DEMO content when GitHub is disconnected or paths miss.
 */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

    const path = url.searchParams.get("path")?.trim() || "";
    const includeTree = url.searchParams.get("tree") === "1";
    const repoParam = url.searchParams.get("repo")?.trim() || "";
    const refParam = url.searchParams.get("ref")?.trim() || "";

    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, session.user.id);
      const authToken = await getGitHubAccessToken(client, orgId);
      if (!authToken) {
        return {
          empty: true,
          emptyReason: "GitHub is not connected for this team.",
          file: null,
          tree: null,
        };
      }
      const fullName = repoParam || authToken.connection.defaultRepoFullName || "";
      if (!fullName) {
        return {
          empty: true,
          emptyReason: "No default robot-code repository selected. Set one in Team settings.",
          file: null,
          tree: null,
        };
      }
      const ref = refParam || authToken.connection.defaultRepoDefaultBranch || "main";
      const http = createGitHubHttp(authToken.accessToken);

      let file = null as Awaited<ReturnType<typeof fetchGitHubFileSnippet>> | null;
      if (path) {
        file = await fetchGitHubFileSnippet(http, fullName, path, ref, GITHUB_MAX_FILE_CHARS);
      }

      let tree = null as Awaited<ReturnType<typeof fetchGitHubTree>> | null;
      if (includeTree) {
        tree = await fetchGitHubTree(http, fullName, ref);
      }

      if (!file && !tree) {
        return {
          empty: true,
          emptyReason: "Provide path=… and/or tree=1 to fetch context snippets.",
          file: null,
          tree: null,
          repoFullName: fullName,
          ref,
        };
      }

      return {
        empty: false,
        emptyReason: null,
        repoFullName: fullName,
        ref,
        file,
        tree,
        caps: { maxFileChars: GITHUB_MAX_FILE_CHARS },
      };
    });

    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch GitHub contents" },
      { status: 400 },
    );
  }
}
