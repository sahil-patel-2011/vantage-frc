import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  createGitHubHttp,
  getGitHubAccessToken,
  listGitHubRepos,
  requireOrgMember,
} from "../../../../lib/github";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, session.user.id);
      const authToken = await getGitHubAccessToken(client, orgId);
      if (!authToken) {
        return {
          empty: true,
          emptyReason: "GitHub is not connected for this workspace.",
          repos: [] as unknown[],
          defaultRepoFullName: null as string | null,
        };
      }
      const repos = await listGitHubRepos(createGitHubHttp(authToken.accessToken), 60);
      return {
        empty: repos.length === 0,
        emptyReason: repos.length
          ? null
          : "No repositories visible to this GitHub account (or the token lacks repo access).",
        repos,
        defaultRepoFullName: authToken.connection.defaultRepoFullName,
      };
    });

    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list repositories" },
      { status: 400 },
    );
  }
}
