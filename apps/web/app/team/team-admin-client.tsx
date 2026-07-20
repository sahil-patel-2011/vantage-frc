"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import {
  GITHUB_RELATED_INCLUDE,
  classifyGitHubShell,
  formatGitHubRepoMetric,
  githubNextActions,
  githubRelatedLinks,
  githubSetupSteps,
  githubShellCopy,
  shouldShowGitHubSummaryTiles,
  type GitHubNextAction,
} from "../../lib/github/github-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import {
  TEAM_ADMIN_RELATED_INCLUDE,
  classifyTeamAdminShell,
  formatTeamAdminMetric,
  teamAdminNextActions,
  teamAdminRelatedLinks,
  teamAdminSetupSteps,
  teamAdminShellCopy,
  shouldShowTeamAdminSummaryTiles,
  type TeamAdminNextAction,
} from "../../lib/team/team-admin-related";
import { TeamProfilePanel } from "./team-profile-panel";
import "./github-connection.css";
import "./team-access-requests.css";
import "./team-admin.css";

type Invite = {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  acceptedAt: string | null;
  lastSentAt: string;
};

type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
  joinedAt: string;
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

function GitHubNextActionsPanel({ actions }: { actions: GitHubNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel github-next-actions" aria-label="GitHub next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Pair VS Code, Code Coach, and Account Connections — never DEMO repos.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function MembershipNextActionsPanel({ actions }: { actions: TeamAdminNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel team-admin-next-actions" aria-label="Membership next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Account, Discord, and Connections — never DEMO members.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function TeamAdminClient({ orgId }: { orgId: string }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [membershipFetchFailed, setMembershipFetchFailed] = useState(false);
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
  const [githubOAuthSetupRequired, setGithubOAuthSetupRequired] = useState(false);
  const [githubConnection, setGithubConnection] = useState<GitHubConnection | null>(null);
  const [githubEmptyReason, setGithubEmptyReason] = useState("");
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubPat, setGithubPat] = useState("");
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubLoading, setGithubLoading] = useState(true);
  const [githubFetchFailed, setGithubFetchFailed] = useState(false);
  const [githubReposLoaded, setGithubReposLoaded] = useState(false);
  const [defaultRepo, setDefaultRepo] = useState("");

  async function load() {
    setGithubLoading(true);
    setGithubFetchFailed(false);
    setMembershipLoading(true);
    setMembershipFetchFailed(false);

    const response = await fetch(`/api/organizations/invites?orgId=${orgId}`);
    const data = await response.json();
    setInvites(data.invites ?? []);
    if (!response.ok) setMessage(data.error);

    const membersResponse = await fetch(`/api/organizations/members?orgId=${encodeURIComponent(orgId)}`);
    const membersData = await membersResponse.json();
    if (membersResponse.ok) {
      setMembers(Array.isArray(membersData.members) ? membersData.members : []);
      setMembersLoaded(true);
      setMembershipFetchFailed(false);
    } else {
      setMembers([]);
      setMembersLoaded(true);
      setMembershipFetchFailed(true);
      setMessage(membersData.error ?? "Could not load members");
    }

    const accessResponse = await fetch(`/api/organizations/access-requests?orgId=${orgId}`);
    const accessData = await accessResponse.json();
    setAccessRequests(accessData.requests ?? []);
    if (!accessResponse.ok) setMessage(accessData.error);

    setMembershipLoading(false);

    const providerResponse = await fetch(`/api/organizations/providers?orgId=${orgId}`);
    const providerData = await providerResponse.json();
    setProviders(providerData.providers ?? []);

    const githubResponse = await fetch(`/api/github?orgId=${encodeURIComponent(orgId)}`);
    const githubData = await githubResponse.json();
    if (githubResponse.ok) {
      // OAuth App missing ≠ feature blocked — PAT always works.
      setGithubOAuthSetupRequired(
        Boolean(githubData.oauthSetupRequired ?? (githubData.setupRequired && !githubData.patAvailable)),
      );
      setGithubConnection(githubData.connection ?? null);
      setGithubEmptyReason(githubData.emptyReason ?? "");
      setDefaultRepo(githubData.connection?.defaultRepoFullName ?? "");
      if (githubData.connection) {
        const reposResponse = await fetch(`/api/github/repos?orgId=${encodeURIComponent(orgId)}`);
        const reposData = await reposResponse.json();
        if (reposResponse.ok) {
          setGithubRepos(Array.isArray(reposData.repos) ? reposData.repos : []);
          setGithubReposLoaded(true);
        } else {
          setGithubRepos([]);
          setGithubReposLoaded(true);
        }
      } else {
        setGithubRepos([]);
        setGithubReposLoaded(true);
      }
      setGithubFetchFailed(false);
    } else {
      setGithubFetchFailed(true);
      setGithubConnection(null);
      setGithubRepos([]);
      setGithubReposLoaded(false);
      setMessage(githubData.error ?? "Could not load GitHub context");
    }
    setGithubLoading(false);
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

  const githubConnected = Boolean(githubConnection);
  const githubShell = classifyGitHubShell({
    loading: githubLoading,
    fetchFailed: githubFetchFailed,
    hasOrgs: true,
    orgId,
    connected: githubConnected,
  });
  const githubCopy = githubShellCopy(githubShell);
  const githubActions = githubNextActions({
    orgId,
    shell: githubShell,
    connected: githubConnected,
    hasDefaultRepo: Boolean(githubConnection?.defaultRepoFullName),
    oauthSetupRequired: githubOAuthSetupRequired,
    repoCount: githubRepos.length,
  });
  const githubRelated = githubRelatedLinks(orgId, {
    include: [...GITHUB_RELATED_INCLUDE],
  });
  const githubSteps = githubShell === "setup" ? githubSetupSteps(orgId) : [];
  const showGithubTiles = shouldShowGitHubSummaryTiles({
    connected: githubConnected,
    repoCount: githubRepos.length,
  });

  const pendingInvites = invites.filter((invite) => invite.status === "pending").length;
  const pendingAccess = accessRequests.filter((request) => request.status === "pending").length;
  const membershipShell = classifyTeamAdminShell({
    loading: membershipLoading,
    fetchFailed: membershipFetchFailed,
    hasOrgs: true,
    orgId,
    memberCount: members.length,
  });
  const membershipCopy = teamAdminShellCopy(membershipShell);
  const membershipActions = teamAdminNextActions({
    orgId,
    shell: membershipShell,
    memberCount: members.length,
    pendingInviteCount: pendingInvites,
    pendingAccessCount: pendingAccess,
  });
  const membershipRelated = teamAdminRelatedLinks(orgId, {
    include: [...TEAM_ADMIN_RELATED_INCLUDE],
  });
  const membershipSteps = membershipShell === "setup" ? teamAdminSetupSteps(orgId) : [];
  const showMembershipTiles = shouldShowTeamAdminSummaryTiles({
    memberCount: members.length,
    inviteCount: invites.length,
  });

  return (
    <main className="module-page team-admin-page">
      <PageHeader
        breadcrumbs="Team / Admin"
        title="Team admin"
        description="Invite exact emails, manage real members, configure GitHub robot-code context, and BYO model providers (API keys). Rosters and repo lists stay blank until real rows exist — never DEMO members or repositories."
      >
        <nav className="product-hub-related team-admin-related" aria-label="Related account tools">
          {membershipRelated.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      </PageHeader>
      <TeamOpsNav orgId={orgId} active="admin" />

      <TeamProfilePanel orgId={orgId} />

      <nav className="settings-hub" aria-label="Workspace settings">
        <a href={withOrgHref("/team/background", orgId)}>
          <strong>Team background</strong>
          <span>Mission, history, demographics for sponsors</span>
        </a>
        <a href={withOrgHref("/team/security", orgId)}>
          <strong>Security &amp; delegation</strong>
          <span>Auth policy and API-key powers</span>
        </a>
        <a href={withOrgHref("/team/ai-keys", orgId)}>
          <strong>Add your API keys</strong>
          <span>OpenAI · Anthropic · Google</span>
        </a>
        <a href="#custom-providers">
          <strong>Custom providers</strong>
          <span>OpenAI-compatible / local relay</span>
        </a>
        <a href={withOrgHref("/team/budgets", orgId)}>
          <strong>API budgets</strong>
          <span>Spend and token hard limits</span>
        </a>
        <a href={withOrgHref("/team/ai-policy", orgId)}>
          <strong>AI governance</strong>
          <span>Tools, spend alerts, approvals</span>
        </a>
        <a href={`${withOrgHref("/team/budgets", orgId)}#prompt-caching`}>
          <strong>Prompt caching</strong>
          <span>Reuse stable AI context blocks</span>
        </a>
        <a href={withOrgHref("/team/ai-memory", orgId)}>
          <strong>AI memory</strong>
          <span>Team memory governance</span>
        </a>
        <a href={withOrgHref("/team/data", orgId)}>
          <strong>Live data</strong>
          <span>TBA connectors</span>
        </a>
        <a href={withOrgHref("/team/discord", orgId)}>
          <strong>Discord</strong>
          <span>Guild, announcements, chat bridge</span>
        </a>
        <a href="#github-connection">
          <strong>GitHub</strong>
          <span>Robot-code context for AI — never DEMO repos</span>
        </a>
        <a href="/account?tab=notifications">
          <strong>Notification prefs</strong>
          <span>In-app and email opt-ins</span>
        </a>
        <a href="/account?tab=integrations">
          <strong>Account Connections</strong>
          <span>TBA, Onshape, Discord, GitHub</span>
        </a>
      </nav>

      <nav className="intel-actions settings-secondary-links" aria-label="More team admin links">
        <a href={withOrgHref("/business", orgId)}>Business</a>
        <a href={withOrgHref("/costs", orgId)}>Season costs</a>
        <a href={withOrgHref("/team/grants", orgId)}>Grants</a>
        <a href={withOrgHref("/team/awards", orgId)}>Awards</a>
        <a href={withOrgHref("/chat", orgId)}>Assistant</a>
        <a href={withOrgHref("/team/usage", orgId)}>AI usage</a>
        <a href={withOrgHref("/team/ai-runs", orgId)}>AI runs</a>
        <a href={withOrgHref("/team/knowledge", orgId)}>Knowledge</a>
        <a href={withOrgHref("/exports", orgId)}>Export</a>
        <a href={withOrgHref("/showcase", orgId)}>Showcase</a>
        <a href="/security">Personal security</a>
        <a href="/account?tab=profile">Account</a>
        <a href={withOrgHref("/team/discord", orgId)}>Discord</a>
        <a href="/account?tab=integrations">Connections</a>
      </nav>

      <section className="compare-panel team-admin-membership" id="membership" aria-labelledby="membership-title">
        <span className="eyebrow">MEMBERS &amp; INVITES</span>
        <h2 id="membership-title">{membershipCopy.title}</h2>
        <p className="app-muted">{membershipCopy.description}</p>
        <nav className="product-hub-related team-admin-related" aria-label="Related membership tools">
          {membershipRelated.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        {membershipShell === "loading" || membershipShell === "error" ? (
          <EmptyState
            soft
            badge={membershipShell === "error" ? "Unavailable" : undefined}
            badgeTone="setup"
            title={membershipCopy.title}
            description={membershipCopy.description}
            aria-busy={membershipShell === "loading"}
          >
            {membershipShell === "error" ? (
              <button type="button" className="app-button secondary" onClick={() => void load()}>
                Retry
              </button>
            ) : null}
          </EmptyState>
        ) : null}

        {membershipShell === "empty" ? (
          <EmptyState
            soft
            badge={membershipCopy.badge}
            badgeTone="setup"
            title={membershipCopy.title}
            description={membershipCopy.description}
          >
            <a className="app-button" href="#invite-form">
              Invite an exact email
            </a>
          </EmptyState>
        ) : null}

        {membershipSteps.length > 0 ? (
          <Panel className="team-admin-membership" aria-label="Membership setup steps">
            <header>
              <h2>Setup steps</h2>
              <p className="app-muted">Workspace, invite, Discord, and Connections — never DEMO members.</p>
            </header>
            <ul className="team-admin-setup-steps">
              {membershipSteps.map((step) => (
                <li key={step.id}>
                  <div>
                    <strong>{step.label}</strong>
                    <p className="app-muted team-admin-tip">{step.detail}</p>
                  </div>
                  <a className="app-button secondary" href={step.href}>
                    Open
                  </a>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <MembershipNextActionsPanel actions={membershipActions} />

        {showMembershipTiles ? (
          <div className="team-admin-metrics" aria-label="Membership metrics">
            <article>
              <strong>{formatTeamAdminMetric(members.length, membersLoaded)}</strong>
              <span>Real members</span>
            </article>
            <article>
              <strong>{formatTeamAdminMetric(pendingInvites, membersLoaded)}</strong>
              <span>Pending invites</span>
            </article>
            <article>
              <strong>{formatTeamAdminMetric(pendingAccess, membersLoaded)}</strong>
              <span>Access requests</span>
            </article>
          </div>
        ) : null}

        {membershipShell === "ready" ? (
          <Panel className="team-admin-members invite-list" aria-label="Members list">
            <span className="eyebrow">Members</span>
            {members.map((member) => (
              <article key={member.userId}>
                <div>
                  <strong>{member.name || member.email}</strong>
                  <small>
                    {member.email} · {member.role}
                    {member.joinedAt
                      ? ` · joined ${new Date(member.joinedAt).toLocaleDateString()}`
                      : ""}
                  </small>
                </div>
                <a className="app-button secondary" href={withOrgHref("/team/security", orgId)}>
                  Capabilities
                </a>
              </article>
            ))}
          </Panel>
        ) : null}
      </section>

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
      <section className="admin-grid" id="invite-form">
        <form className="intel-panel" onSubmit={invite}>
          <span className="eyebrow">INVITE A SPECIFIC EMAIL</span>
          <p>
            Team numbers never grant access. The recipient must verify this exact address — the ledger stays blank
            until a real invite is sent, never DEMO members.
          </p>
          <label>
            Email
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="admin">Admin</option>
              <option value="scout">Scout</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <button className="primary-action">Send invitation</button>
          <div className="intel-actions" style={{ marginTop: "0.75rem" }}>
            <a className="app-button secondary" href="/account?tab=profile">
              Account
            </a>
            <a className="app-button secondary" href={withOrgHref("/team/discord", orgId)}>
              Discord
            </a>
            <a className="app-button secondary" href="/account?tab=integrations">
              Connections
            </a>
          </div>
        </form>
        <Panel className="invite-list" id="invitation-ledger">
          <span className="eyebrow">Invitation ledger</span>
          {!invites.length ? (
            <EmptyState
              soft
              badge="No invitations yet"
              badgeTone="setup"
              title="Invite ledger is empty"
              description="Send an exact-email invite on the left. Nothing is pre-seeded — never DEMO members."
            />
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
      <section className="compare-panel github-panel" id="github-connection">
        <span className="eyebrow">GITHUB ROBOT-CODE CONTEXT</span>
        <nav className="product-hub-related github-related" aria-label="Related code tools">
          {githubRelated.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        {githubShell === "loading" || githubShell === "error" ? (
          <EmptyState
            soft
            badge={githubShell === "error" ? "Unavailable" : undefined}
            badgeTone="setup"
            title={githubCopy.title}
            description={githubCopy.description}
            aria-busy={githubShell === "loading"}
          >
            {githubShell === "error" ? (
              <button type="button" className="app-button secondary" onClick={() => void load()}>
                Retry
              </button>
            ) : null}
          </EmptyState>
        ) : null}

        {githubShell === "empty" ? (
          <EmptyState
            soft
            badge={githubCopy.badge}
            badgeTone="setup"
            title={githubCopy.title}
            description={githubEmptyReason || githubCopy.description}
          >
            <p className="app-muted">
              OAuth is optional when server credentials are missing — encrypt a PAT below. Pair VS Code, Code Coach, and
              Account Connections stay honest until a real link exists.
            </p>
          </EmptyState>
        ) : null}

        {githubSteps.length > 0 ? (
          <Panel className="github-panel" aria-label="GitHub setup steps">
            <header>
              <h2>Setup steps</h2>
              <p className="app-muted">Workspace, PAT, Code Coach, and Pair VS Code — never DEMO repos.</p>
            </header>
            <ul className="github-setup-steps">
              {githubSteps.map((step) => (
                <li key={step.id}>
                  <div>
                    <strong>{step.label}</strong>
                    <p className="app-muted github-tip">{step.detail}</p>
                  </div>
                  <a className="app-button secondary" href={step.href}>
                    Open
                  </a>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <GitHubNextActionsPanel actions={githubActions} />

        {showGithubTiles ? (
          <div className="github-metrics" aria-label="GitHub connection metrics">
            <article>
              <strong>{formatGitHubRepoMetric(githubRepos.length, githubReposLoaded)}</strong>
              <span>Real repositories</span>
            </article>
            <article>
              <strong>{githubConnection?.defaultRepoFullName ? "1" : "0"}</strong>
              <span>Default robot-code repo</span>
            </article>
          </div>
        ) : null}

        <div className="admin-grid">
          <section className="intel-panel">
            <p>
              Link one GitHub account to this workspace so AI chat/code assist can pull size-capped file snippets from your
              robot-code repo. Tokens are encrypted at rest. Vantage never pushes and never requests the <code>workflow</code>{" "}
              scope. Repo pickers stay blank until the linked account returns real repositories — never DEMO repos.
            </p>
            {githubOAuthSetupRequired && (
              <p className="app-muted github-oauth-note">
                One-click OAuth is optional on this deployment (server missing{" "}
                <code>GITHUB_OAUTH_CLIENT_ID</code> / <code>GITHUB_OAUTH_CLIENT_SECRET</code>). Use an encrypted personal
                access token below — that path is fully production-ready without those env vars.
              </p>
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
                className={githubOAuthSetupRequired ? undefined : "primary-action"}
                disabled={githubBusy || githubOAuthSetupRequired || githubLoading}
                onClick={() => void connectGitHubOAuth()}
                title={
                  githubOAuthSetupRequired
                    ? "OAuth App credentials are not configured on the server. Save a PAT instead."
                    : "Authorize GitHub for this workspace"
                }
              >
                {githubOAuthSetupRequired ? "Connect GitHub (OAuth unavailable)" : "Connect GitHub"}
              </button>
              {githubConnection && (
                <button type="button" disabled={githubBusy} onClick={() => void disconnectGitHub()}>
                  Disconnect
                </button>
              )}
              <a className="app-button secondary" href={withOrgHref("/editor/pair", orgId)}>
                Pair VS Code
              </a>
              <a className="app-button secondary" href="/account?tab=integrations">
                Account Connections
              </a>
            </div>
          </section>
          <section className="intel-panel">
            <form onSubmit={saveGitHubPat}>
              <span className="eyebrow">{githubOAuthSetupRequired ? "CONNECT WITH PAT" : "OR SAVE A PAT"}</span>
              <p className="app-muted">
                Fine-grained or classic PAT with Contents: Read. Encrypted like other BYOK secrets.
                {githubOAuthSetupRequired ? " Recommended when OAuth is not configured on the server." : ""}
              </p>
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
              <form id="github-default-repo" onSubmit={setGitHubDefaultRepo} style={{ marginTop: "1.25rem" }}>
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
                  <p className="app-muted">
                    No repositories returned for this account yet — the list stays blank, never DEMO repos.
                  </p>
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
              Prefer first-party OpenAI, Anthropic, or Google? Use{" "}
              <a href={withOrgHref("/team/ai-keys", orgId)}>AI API keys</a> — encrypted paste stop for Free / your-keys
              workspaces. Below is for custom OpenAI-compatible HTTPS endpoints or a local desktop relay. Keys are
              encrypted at rest and never returned. Paid plans can use Vantage-hosted AI instead (cheaper than own keys).
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
