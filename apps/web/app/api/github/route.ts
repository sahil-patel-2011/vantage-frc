import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  buildGitHubAuthorizeUrl,
  createGitHubHttp,
  createGitHubOAuthState,
  fetchGitHubRepoMeta,
  getGitHubOAuthConfig,
  githubSetupStatus,
  decryptGitHubTokens,
  encryptGitHubTokens,
  loadGitHubConnection,
  requireOrgAdmin,
  requireOrgMember,
  upsertGitHubConnection,
} from "../../../lib/github";

async function current() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

const fail = (error: unknown, status = 400) =>
  Response.json(
    { error: error instanceof Error ? error.message : "GitHub request failed" },
    { status },
  );

function publicConnection(row: Awaited<ReturnType<typeof loadGitHubConnection>>) {
  if (!row) return null;
  return {
    id: row.id,
    authMethod: row.authMethod,
    label: row.label,
    status: row.status,
    githubLogin: row.githubLogin,
    defaultRepoFullName: row.defaultRepoFullName,
    defaultRepoDefaultBranch: row.defaultRepoDefaultBranch,
    scopes: row.scopes,
    lastTestedAt: row.lastTestedAt,
  };
}

export async function GET(request: Request) {
  try {
    const session = await current();
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
    const setup = githubSetupStatus();
    const connection = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, session.user.id);
      return loadGitHubConnection(client, orgId);
    });
    return Response.json({
      ...setup,
      connection: publicConnection(connection),
      authorizeAvailable: setup.configured,
      empty: !connection,
      emptyReason: connection
        ? null
        : "No GitHub account linked for this workspace yet. Owners/admins can connect OAuth or save a PAT.",
    });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await current();
    const body = (await request.json()) as {
      orgId?: string;
      action?: string;
      pat?: string;
      repoFullName?: string;
      label?: string;
    };
    const orgId = String(body.orgId ?? "");
    if (!orgId) throw new Error("orgId is required");
    const action = String(body.action ?? "");

    if (action === "authorize-url") {
      const config = getGitHubOAuthConfig();
      if (!config) {
        return Response.json({ error: "GitHub OAuth is not configured", ...githubSetupStatus() }, { status: 503 });
      }
      await withRls({ userId: session.user.id, orgId }, async (client) => {
        await requireOrgAdmin(client, orgId, session.user.id);
      });
      const state = createGitHubOAuthState({ orgId, userId: session.user.id });
      return Response.json({ url: buildGitHubAuthorizeUrl(config, state), expiresIn: 900 });
    }

    if (action === "connect-pat") {
      const pat = String(body.pat ?? "").trim();
      if (!pat) throw new Error("pat is required");
      if (pat.length < 20 || pat.length > 255) throw new Error("PAT length looks invalid");
      const id = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await requireOrgAdmin(client, orgId, session.user.id);
        return upsertGitHubConnection(client, {
          orgId,
          userId: session.user.id,
          authMethod: "pat",
          tokens: { accessToken: pat, tokenType: "bearer" },
          scopes: ["pat"],
          label: body.label?.trim() || "GitHub PAT",
        });
      });
      return Response.json({ success: true, connectionId: id }, { status: 201 });
    }

    if (action === "set-default-repo") {
      const repoFullName = String(body.repoFullName ?? "").trim();
      if (!repoFullName.includes("/")) throw new Error("repoFullName must be owner/repo");
      const updated = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await requireOrgAdmin(client, orgId, session.user.id);
        const connection = await loadGitHubConnection(client, orgId);
        if (!connection) throw new Error("Connect GitHub before choosing a default repository");
        const tokens = await decryptGitHubTokens(connection.encryptedCredentials);
        const meta = await fetchGitHubRepoMeta(createGitHubHttp(tokens.accessToken), repoFullName);
        await client.query(
          `UPDATE github_connections
           SET default_repo_full_name=$2, default_repo_default_branch=$3, updated_at=now(), last_tested_at=now()
           WHERE org_id=$1::uuid AND disabled_at IS NULL`,
          [orgId, meta.fullName, meta.defaultBranch],
        );
        return { fullName: meta.fullName, defaultBranch: meta.defaultBranch };
      });
      return Response.json({ success: true, defaultRepo: updated });
    }

    if (action === "disconnect") {
      await withRls({ userId: session.user.id, orgId }, async (client) => {
        await requireOrgAdmin(client, orgId, session.user.id);
        const wiped = await encryptGitHubTokens({ accessToken: "revoked" });
        await client.query(
          `UPDATE github_connections
           SET status='disconnected', disabled_at=now(), encrypted_credentials=$2,
               default_repo_full_name=NULL, default_repo_default_branch=NULL, updated_at=now()
           WHERE org_id=$1::uuid`,
          [orgId, wiped],
        );
      });
      return Response.json({ success: true });
    }

    throw new Error("Invalid GitHub action");
  } catch (error) {
    return fail(error);
  }
}
