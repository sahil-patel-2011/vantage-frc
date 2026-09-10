import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  buildGitHubAuthorizeUrl,
  createGitHubHttp,
  createGitHubOAuthState,
  fetchGitHubRepoMeta,
  fetchGitHubUser,
  getGitHubOAuthConfig,
  githubSetupStatus,
  decryptGitHubTokens,
  encryptGitHubTokens,
  isGitHubCredentialRejected,
  loadGitHubConnection,
  loadGitHubConnectionState,
  markGitHubCredentialRejected,
  requireOrgAdmin,
  requireOrgMember,
  upsertGitHubConnection,
} from "../../../lib/github";

async function current() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return session;
}

/**
 * Status codes a caller can act on.
 *
 * An expired session used to come back as 400, so the client's load-failure
 * classifier offered a Retry that could never work instead of a sign-in link.
 * A rejected GitHub credential used to come back as 400 too, indistinguishable
 * from a typo in a repo name.
 */
const fail = (error: unknown, status = 400) => {
  const message = error instanceof Error ? error.message : "GitHub request failed";
  if (/authentication required/i.test(message)) {
    return Response.json({ error: message }, { status: 401 });
  }
  if (/owners and admins/i.test(message) || /access denied/i.test(message)) {
    return Response.json({ error: message }, { status: 403 });
  }
  if (isGitHubCredentialRejected(error)) {
    return Response.json({ error: message, credentialRejected: true }, { status: 502 });
  }
  return Response.json({ error: message }, { status });
};

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
    const { connection, state } = await withRls({ userId: session.user.id, orgId }, async (client) => {
      await requireOrgMember(client, orgId, session.user.id);
      return {
        connection: await loadGitHubConnection(client, orgId),
        state: await loadGitHubConnectionState(client, orgId),
      };
    });
    // A row in `error` status is a link whose token GitHub refused. Reporting
    // it as "no GitHub account linked" is how someone ends up creating a second
    // OAuth App instead of re-authorising the one they have.
    const credentialRejected = state?.status === "error";
    return Response.json({
      ...setup,
      connection: publicConnection(connection),
      credentialRejected,
      rejectedLogin: credentialRejected ? (state?.githubLogin ?? null) : null,
      authorizeAvailable: setup.configured,
      empty: !connection,
      emptyReason: connection
        ? null
        : credentialRejected
          ? `GitHub refused the stored credential for @${state?.githubLogin ?? "this account"}. The token was revoked, expired, or lost its scopes — reconnect to issue a new one.`
          : setup.configured
            ? "No GitHub account linked for this workspace yet. Owners/admins can Connect GitHub (OAuth) or save a PAT."
            : setup.message,
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

    // Disconnect is handled before the OAuth-config gate on purpose: someone
    // whose deployment has rotated GITHUB_OAUTH_CLIENT_ID away is exactly the
    // person who still needs to revoke the token Vantage is holding.
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

    if (action === "authorize-url") {
      const config = getGitHubOAuthConfig();
      if (!config) {
        const setup = githubSetupStatus();
        // `message` names the variables, where to set them, and the exact
        // Authorization callback URL. `error` used to be the whole answer and
        // said only "GitHub OAuth is not configured", which tells the reader
        // nothing they did not already know from the disabled button.
        return Response.json({ error: setup.message, ...setup }, { status: 503 });
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
        let meta;
        try {
          meta = await fetchGitHubRepoMeta(createGitHubHttp(tokens.accessToken), repoFullName);
        } catch (error) {
          // Record the rejection here too. Choosing a repo is usually the first
          // thing done after connecting, so it is often where a dead token is
          // first discovered — and leaving the row as `connected` after that
          // means the next reader is told the link is fine.
          if (isGitHubCredentialRejected(error)) await markGitHubCredentialRejected(client, orgId);
          throw error;
        }
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

    // Spend one cheap call against the stored credential so a card can stop
    // saying Connected over a token GitHub no longer honours. Nothing else in
    // the product ever checked, which is why a revoked PAT stayed "LINKED"
    // until someone opened a feature that needed it and got "Bad credentials".
    if (action === "verify") {
      const result = await withRls({ userId: session.user.id, orgId }, async (client) => {
        await requireOrgAdmin(client, orgId, session.user.id);
        const connection = await loadGitHubConnection(client, orgId);
        if (!connection) return { linked: false as const };
        const tokens = await decryptGitHubTokens(connection.encryptedCredentials);
        try {
          const user = await fetchGitHubUser(createGitHubHttp(tokens.accessToken));
          await client.query(
            `UPDATE github_connections
             SET status='connected', github_login=$2, last_tested_at=now(), updated_at=now()
             WHERE org_id=$1::uuid AND disabled_at IS NULL`,
            [orgId, user.login],
          );
          return { linked: true as const, ok: true as const, login: user.login };
        } catch (error) {
          if (!isGitHubCredentialRejected(error)) throw error;
          await markGitHubCredentialRejected(client, orgId);
          return { linked: true as const, ok: false as const, message: error.message };
        }
      });

      if (!result.linked) {
        return Response.json(
          { ok: false, linked: false, error: "No GitHub connection to verify for this workspace." },
          { status: 404 },
        );
      }
      if (!result.ok) {
        return Response.json({ ok: false, linked: true, credentialRejected: true, error: result.message }, { status: 502 });
      }
      return Response.json({ ok: true, linked: true, login: result.login });
    }

    throw new Error("Invalid GitHub action");
  } catch (error) {
    return fail(error);
  }
}
