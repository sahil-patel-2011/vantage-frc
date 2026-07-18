"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import "./team-access-requests.css";

type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  lastSentAt: string;
};

type AccessRequest = {
  id: string;
  userId: string;
  name: string;
  email: string;
  requestedTeamRole: string | null;
  primaryFocus: "competition" | "build" | "business" | "leadership";
  status: "pending" | "approved" | "declined" | "withdrawn";
  membershipRole: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

type GitHubConnection = {
  id: string;
  authMethod: string;
  label: string;
  status: string;
  githubLogin: string | null;
  defaultRepoFullName: string | null;
  defaultRepoDefaultBranch: string | null;
  scopes: string[];
  lastTestedAt: string | null;
};

type GitHubRepo = {
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
};

export default function TeamAdminClient({ orgId }: { orgId: string }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("scout");
  const [message, setMessage] = useState("");
  const [providers, setProviders] = useState<
    Array<{
      id: string;
      label: string;
      kind: string;
      localRelay: boolean;
      enabled: boolean;
      baseUrl?: string | null;
      lastTestedAt?: string | null;
      disabledAt?: string | null;
    }>
  >([]);
  const [provider, setProvider] = useState({
    kind: "openai-compatible",
    label: "",
    baseUrl: "",
    apiKey: "",
    localRelay: false,
    model: "",
  });
  const [githubSetupRequired, setGithubSetupRequired] = useState(true);
  const [githubConnection, setGithubConnection] = useState<GitHubConnection | null>(null);
  const [githubEmptyReason, setGithubEmptyReason] = useState("");
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubPat, setGithubPat] = useState("");
  const [githubBusy, setGithubBusy] = useState(false);
  const [defaultRepo, setDefaultRepo] = useState("");

  async function load() {
    const response = await fetch(`/api/organizations/invites?orgId=${orgId}`);
    const data = await response.json();
    setInvites(data.invites ?? []);
    if (!response.ok) setMessage(data.error);
    const accessResponse = await fetch(`/api/organizations/access-requests?orgId=${orgId}`);
    const accessData = await accessResponse.json();
    setAccessRequests(accessData.requests ?? []);
    if (!accessResponse.ok) setMessage(accessData.error);
    const providerResponse = await fetch(`/api/organizations/providers?orgId=${orgId}`);
    const providerData = await providerResponse.json();
    setProviders(providerData.providers ?? []);

    const githubResponse = await fetch(`/api/github?orgId=${encodeURIComponent(orgId)}`);
    const githubData = await githubResponse.json();
    if (githubResponse.ok) {
      setGithubSetupRequired(Boolean(githubData.setupRequired));
      setGithubConnection(githubData.connection ?? null);
      setGithubEmptyReason(githubData.emptyReason ?? "");
      setDefaultRepo(githubData.connection?.defaultRepoFullName ?? "");
      if (githubData.connection) {
        const reposResponse = await fetch(`/api/github/repos?orgId=${encodeURIComponent(orgId)}`);
        const reposData = await reposResponse.json();
        if (reposResponse.ok) setGithubRepos(reposData.repos ?? []);
      } else {
        setGithubRepos([]);
      }
    }
  }
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected") setMessage("GitHub connected for this workspace.");
    if (params.get("github") === "denied") setMessage("GitHub authorization was denied.");
    if (params.get("github") === "error") setMessage(params.get("error") || "GitHub OAuth failed.");
    void load();
  }, [orgId]);
  async function invite(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/organizations/invites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, email, role }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Invitation sent." : data.error);
    if (response.ok) { setEmail(""); await load(); }
  }
  async function act(inviteId: string, action: "resend" | "revoke") {
    const response = await fetch("/api/organizations/invites", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, inviteId, action }),
    });
    const data = await response.json();
    setMessage(response.ok ? `Invite ${action === "resend" ? "resent" : "revoked"}.` : data.error);
    if (response.ok) await load();
  }
  async function reviewAccess(requestId: string, decision: "approved" | "declined", role: "scout" | "viewer" = "viewer") {
    const response = await fetch("/api/organizations/access-requests", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, requestId, decision, role }),
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? decision === "approved"
          ? "Access approved. Existing onboarding sessions were ended and a secure sign-in link was emailed."
          : "Access request declined."
        : data.error,
    );
    if (response.ok) await load();
  }
  async function saveProvider(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/organizations/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...provider, modelMappings: { default: provider.model } }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Custom provider encrypted and saved." : data.error);
    if (response.ok) {
      setProvider({ ...provider, apiKey: "" });
      await load();
    }
  }
  async function providerAction(id: string, action: "test" | "disable") {
    if (action === "disable" && !confirm("Disable this custom provider? Chat/CAD routes using it will stop.")) return;
    const response = await fetch("/api/organizations/providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, id, action }),
    });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error);
      return;
    }
    if (action === "test" && data.relayRequired) {
      setMessage("Local relay providers must be tested from the paired desktop relay.");
    } else {
      setMessage(action === "test" ? "Provider health check passed." : "Provider disabled.");
    }
    await load();
  }

  async function connectGitHubOAuth() {
    setGithubBusy(true);
    try {
      const response = await fetch("/api/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "authorize-url" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Could not start GitHub OAuth");
        return;
      }
      window.location.href = data.url;
    } finally {
      setGithubBusy(false);
    }
  }

  async function saveGitHubPat(event: React.FormEvent) {
    event.preventDefault();
    setGithubBusy(true);
    try {
      const response = await fetch("/api/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "connect-pat", pat: githubPat }),
      });
      const data = await response.json();
      setMessage(response.ok ? "GitHub PAT encrypted and saved for this workspace." : data.error);
      if (response.ok) {
        setGithubPat("");
        await load();
      }
    } finally {
      setGithubBusy(false);
    }
  }

  async function setGitHubDefaultRepo(event: React.FormEvent) {
    event.preventDefault();
    if (!defaultRepo.trim()) return;
    setGithubBusy(true);
    try {
      const response = await fetch("/api/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "set-default-repo", repoFullName: defaultRepo.trim() }),
      });
      const data = await response.json();
      setMessage(response.ok ? `Default robot-code repo set to ${data.defaultRepo?.fullName}.` : data.error);
      if (response.ok) await load();
    } finally {
      setGithubBusy(false);
    }
  }

  async function disconnectGitHub() {
    if (!confirm("Disconnect GitHub for this workspace? AI chat will stop using repo file context.")) return;
    setGithubBusy(true);
    try {
      const response = await fetch("/api/github", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "disconnect" }),
      });
      const data = await response.json();
      setMessage(response.ok ? "GitHub disconnected." : data.error);
      if (response.ok) await load();
    } finally {
      setGithubBusy(false);
    }
  }

  return (
    <main className="module-page team-admin-page">
      <PageHeader
        breadcrumbs="Team / Admin"
        title="Team admin"
        description="Invite exact emails, manage roles, configure GitHub robot-code context, and BYO model providers (API keys)."
      />
      <TeamOpsNav orgId={orgId} active="admin" />

      <nav className="settings-hub" aria-label="Workspace settings">
        <a href={`/team/security?orgId=${orgId}`}>
          <strong>Security &amp; delegation</strong>
          <span>Auth policy and API-key powers</span>
        </a>
        <a href={`#custom-providers`}>
          <strong>API keys</strong>
          <span>BYOK / local model providers</span>
        </a>
        <a href={`/team/budgets?orgId=${orgId}`}>
          <strong>API budgets</strong>
          <span>Spend and token hard limits</span>
        </a>
        <a href={`/team/budgets?orgId=${orgId}#prompt-caching`}>
          <strong>Prompt caching</strong>
          <span>Reuse stable AI context blocks</span>
        </a>
        <a href={`/team/ai-memory?orgId=${orgId}`}>
          <strong>AI memory</strong>
          <span>Team memory governance</span>
        </a>
        <a href={`/team/data?orgId=${orgId}`}>
          <strong>Live data</strong>
          <span>TBA connectors</span>
        </a>
        <a href={`#github-connection`}>
          <strong>GitHub</strong>
          <span>Robot-code context for AI</span>
        </a>
        <a href={`/account?tab=notifications`}>
          <strong>Notification prefs</strong>
          <span>In-app and email opt-ins</span>
        </a>
      </nav>

      <nav className="intel-actions settings-secondary-links" aria-label="More team admin links">
        <a href={`/business?orgId=${orgId}`}>Business</a>
        <a href={`/costs?orgId=${orgId}`}>Season costs</a>
        <a href={`/team/grants?orgId=${orgId}`}>Grants</a>
        <a href={`/team/awards?orgId=${orgId}`}>Awards</a>
        <a href={`/chat?orgId=${orgId}`}>Assistant</a>
        <a href={`/team/usage?orgId=${orgId}`}>AI usage</a>
        <a href={`/team/ai-runs?orgId=${orgId}`}>AI runs</a>
        <a href={`/team/knowledge?orgId=${orgId}`}>Knowledge</a>
        <a href={`/exports?orgId=${orgId}`}>Export</a>
        <a href={`/showcase?orgId=${orgId}`}>Showcase</a>
        <a href="/security">Personal security</a>
      </nav>
      <section className="team-access-inbox" aria-labelledby="team-access-title">
        <header>
          <div>
            <span className="eyebrow">VERIFIED ACCESS REQUESTS</span>
            <h2 id="team-access-title">Approve who enters this workspace.</h2>
            <p>Team numbers route requests here; they never grant membership. Approval ends the applicant&apos;s onboarding sessions and emails a fresh sign-in link.</p>
          </div>
          <strong>{accessRequests.filter((request) => request.status === "pending").length}</strong>
        </header>
        <div className="team-access-list">
          {accessRequests.filter((request) => request.status === "pending").map((request) => (
            <article key={request.id}>
              <div className="team-access-person">
                <span>{request.name?.slice(0, 1).toUpperCase() || "?"}</span>
                <div>
                  <strong>{request.name || "Unnamed applicant"}</strong>
                  <small>{request.email}</small>
                </div>
              </div>
              <dl>
                <div><dt>TEAM ROLE</dt><dd>{request.requestedTeamRole ?? "Not specified"}</dd></div>
                <div><dt>PRIMARY FOCUS</dt><dd>{request.primaryFocus}</dd></div>
                <div><dt>REQUESTED</dt><dd>{new Date(request.createdAt).toLocaleDateString()}</dd></div>
              </dl>
              <div className="team-access-actions">
                <button type="button" className="approve" onClick={() => void reviewAccess(request.id, "approved", "scout")}>Allow as scout</button>
                <button type="button" onClick={() => void reviewAccess(request.id, "approved", "viewer")}>Allow view-only</button>
                <button type="button" className="decline" onClick={() => void reviewAccess(request.id, "declined")}>Decline</button>
              </div>
            </article>
          ))}
          {!accessRequests.some((request) => request.status === "pending") ? (
            <div className="team-access-empty"><b>✓</b><div><strong>No access requests waiting</strong><span>New verified requests will appear here for an owner or administrator.</span></div></div>
          ) : null}
        </div>
        {message ? <p className="team-access-message" role="status">{message}</p> : null}
      </section>
      <section className="admin-grid">
        <form className="intel-panel" onSubmit={invite}>
          <span className="eyebrow">INVITE A SPECIFIC EMAIL</span>
          <p>Team numbers never grant access. The recipient must verify this exact address.</p>
          <label>Email<input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Role<select value={role} onChange={(e) => setRole(e.target.value)}><option value="admin">Admin</option><option value="scout">Scout</option><option value="viewer">Viewer</option></select></label>
          <button className="primary-action">Send invitation</button>
        </form>
        <Panel className="invite-list">
          <span className="eyebrow">Invitation ledger</span>
          {!invites.length ? (
            <EmptyState soft title="No invitations yet" description="Send an invite on the left to start the ledger." />
          ) : (
            invites.map((inviteRow) => (
              <article key={inviteRow.id}>
                <div>
                  <strong>{inviteRow.email}</strong>
                  <small>
                    {inviteRow.role} · {inviteRow.status}
                  </small>
                </div>
                <time>
                  {inviteRow.acceptedAt
                    ? `Accepted ${new Date(inviteRow.acceptedAt).toLocaleDateString()}`
                    : `Expires ${new Date(inviteRow.expiresAt).toLocaleString()}`}
                </time>
                {inviteRow.status === "pending" ? (
                  <div>
                    <button type="button" onClick={() => void act(inviteRow.id, "resend")}>
                      Resend
                    </button>
                    <button type="button" onClick={() => void act(inviteRow.id, "revoke")}>
                      Revoke
                    </button>
                  </div>
                ) : null}
              </article>
            ))
          )}
        </Panel>
      </section>
      <section className="compare-panel" id="github-connection">
        <span className="eyebrow">GITHUB ROBOT-CODE CONTEXT</span>
        <div className="admin-grid">
          <section className="intel-panel">
            <p>
              Link one GitHub account to this workspace so AI chat/code assist can pull size-capped file snippets from your
              robot-code repo. Tokens are encrypted at rest. Vantage never pushes and never requests the <code>workflow</code>{" "}
              scope.
            </p>
            {githubSetupRequired && (
              <p className="app-muted">
                OAuth setup required — set <code>GITHUB_OAUTH_CLIENT_ID</code> and <code>GITHUB_OAUTH_CLIENT_SECRET</code> on
                the server. You can still connect with a personal access token below.
              </p>
            )}
            {!githubConnection && (
              <p className="app-muted">{githubEmptyReason || "No GitHub connection for this workspace yet."}</p>
            )}
            {githubConnection && (
              <article className="admin-org">
                <b>LINKED</b>
                <div>
                  <strong>@{githubConnection.githubLogin ?? "github"}</strong>
                  <small>
                    {githubConnection.authMethod} · {githubConnection.status}
                    {githubConnection.defaultRepoFullName
                      ? ` · default ${githubConnection.defaultRepoFullName}@${githubConnection.defaultRepoDefaultBranch ?? "main"}`
                      : " · no default repo"}
                  </small>
                </div>
              </article>
            )}
            <div className="intel-actions">
              <button
                type="button"
                className="primary-action"
                disabled={githubBusy || githubSetupRequired}
                onClick={() => void connectGitHubOAuth()}
              >
                {githubSetupRequired ? "Connect GitHub (setup required)" : "Connect GitHub"}
              </button>
              {githubConnection && (
                <button type="button" disabled={githubBusy} onClick={() => void disconnectGitHub()}>
                  Disconnect
                </button>
              )}
            </div>
          </section>
          <section className="intel-panel">
            <form onSubmit={saveGitHubPat}>
              <span className="eyebrow">OR SAVE A PAT</span>
              <p className="app-muted">Fine-grained or classic PAT with Contents: Read. Encrypted like other BYOK secrets.</p>
              <label>
                Personal access token
                <input
                  type="password"
                  autoComplete="off"
                  value={githubPat}
                  onChange={(e) => setGithubPat(e.target.value)}
                  placeholder="ghp_… or github_pat_…"
                  required
                />
              </label>
              <button className="primary-action" disabled={githubBusy}>
                Encrypt and save PAT
              </button>
            </form>
            {githubConnection && (
              <form onSubmit={setGitHubDefaultRepo} style={{ marginTop: "1.25rem" }}>
                <span className="eyebrow">DEFAULT ROBOT-CODE REPO</span>
                <label>
                  Repository
                  <select value={defaultRepo} onChange={(e) => setDefaultRepo(e.target.value)} required>
                    <option value="">Select a repository…</option>
                    {githubRepos.map((repo) => (
                      <option key={repo.fullName} value={repo.fullName}>
                        {repo.fullName}
                        {repo.private ? " (private)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {!githubRepos.length && (
                  <p className="app-muted">No repositories returned for this account yet.</p>
                )}
                <button className="primary-action" disabled={githubBusy || !defaultRepo}>
                  Set default repo
                </button>
              </form>
            )}
          </section>
        </div>
      </section>
      <section className="compare-panel" id="custom-providers">
        <span className="eyebrow">Custom / local model provider (API keys)</span>
        <div className="admin-grid">
          <form className="intel-panel" onSubmit={saveProvider}>
            <p>
              Configure an OpenAI-compatible HTTPS endpoint or a local desktop relay. Keys are encrypted at rest and never
              returned. Free workspaces use BYOK/local here; managed routing stays on platform models when entitled.
            </p>
            <label>
              Label
              <input required value={provider.label} onChange={(e) => setProvider({ ...provider, label: e.target.value })} />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={provider.localRelay}
                onChange={(e) => setProvider({ ...provider, localRelay: e.target.checked })}
              />{" "}
              Local/LAN through desktop relay
            </label>
            {!provider.localRelay && (
              <label>
                HTTPS OpenAI-compatible base URL
                <input
                  required
                  type="url"
                  placeholder="https://api.example.com/v1"
                  value={provider.baseUrl}
                  onChange={(e) => setProvider({ ...provider, baseUrl: e.target.value })}
                />
              </label>
            )}
            <label>
              Provider model mapping
              <input
                required
                placeholder="gpt-4.1-mini"
                value={provider.model}
                onChange={(e) => setProvider({ ...provider, model: e.target.value })}
              />
            </label>
            <label>
              API key (optional)
              <input
                type="password"
                autoComplete="off"
                value={provider.apiKey}
                onChange={(e) => setProvider({ ...provider, apiKey: e.target.value })}
              />
            </label>
            <button className="primary-action">Encrypt and save provider</button>
          </form>
          <section className="intel-panel">
            <span className="eyebrow">SAVED PROVIDERS</span>
            {!providers.length && <p className="app-muted">No custom providers yet. Add one to use BYOK/local chat routing.</p>}
            {providers.map((item) => (
              <article className="admin-org" key={item.id}>
                <b>{item.localRelay ? "RELAY" : "API"}</b>
                <div>
                  <strong>{item.label}</strong>
                  <small>
                    {item.kind} · {item.enabled ? "enabled" : "disabled"}
                    {item.baseUrl ? ` · ${item.baseUrl}` : ""}
                    {item.lastTestedAt ? ` · tested ${new Date(item.lastTestedAt).toLocaleString()}` : " · not tested"}
                  </small>
                  {item.enabled && (
                    <div>
                      <button type="button" onClick={() => void providerAction(item.id, "test")}>
                        Test
                      </button>
                      <button type="button" onClick={() => void providerAction(item.id, "disable")}>
                        Disable
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </section>
        </div>
      </section>
    </main>
  );
}
