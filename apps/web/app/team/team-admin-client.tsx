"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog, EmptyState, PageHeader, Panel } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import {
  classifyGitHubShell,
  githubShellCopy,
} from "../../lib/github/github-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
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
import {
  formatInviteRowMeta,
  inviteDeliveryBanner,
  inviteSendResultCopy,
  type InviteDeliveryMode,
} from "../../lib/team/team-invites";
import { TeamBrandingPanel } from "../../lib/branding/team-branding-panel";
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

type AdminTenure = {
  orgCreatedAt: string;
  adminCount: number;
  bootstrapActive: boolean;
  daysRemaining: number | null;
  lastAdminLocked: boolean;
  inviteHint: string | null;
};

type AccessRequest = {
  id: string;
  userId: string;
  name: string;
  email: string;
  requestedTeamRole: string | null;
  crewRole: string | null;
  roleDescription: string | null;
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

function MembershipNextActionsPanel({ actions }: { actions: TeamAdminNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel team-admin-next-actions" aria-label="Membership next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
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
  const [adminTenure, setAdminTenure] = useState<AdminTenure | null>(null);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [membershipLoading, setMembershipLoading] = useState(true);
  const [membershipFetchFailed, setMembershipFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [membershipErrorStatus, setMembershipErrorStatus] = useState<number | null>(null);
  const [membershipErrorMessage, setMembershipErrorMessage] = useState("");
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("scout");
  const [message, setMessage] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [actingInviteId, setActingInviteId] = useState<string | null>(null);
  const [inviteLinks, setInviteLinks] = useState<Record<string, string>>({});
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<{ tone: "ok" | "warn" | "error"; message: string } | null>(
    null,
  );
  const [deliveryMode, setDeliveryMode] = useState<InviteDeliveryMode | null>(null);
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
  const [githubOAuthSetupRequired, setGithubOAuthSetupRequired] = useState(false);
  const [githubConnection, setGithubConnection] = useState<GitHubConnection | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepo[]>([]);
  const [githubPat, setGithubPat] = useState("");
  const [githubBusy, setGithubBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState<Member | null>(null);
  const [resetBusyUserId, setResetBusyUserId] = useState<string | null>(null);
  const [githubLoading, setGithubLoading] = useState(true);
  const [githubFetchFailed, setGithubFetchFailed] = useState(false);
  const [githubErrorStatus, setGithubErrorStatus] = useState<number | null>(null);
  const [githubErrorMessage, setGithubErrorMessage] = useState("");
  const [defaultRepo, setDefaultRepo] = useState("");

  async function load() {
    setGithubLoading(true);
    setGithubFetchFailed(false);
    setMembershipLoading(true);
    setMembershipFetchFailed(false);

    const response = await fetch(`/api/organizations/invites?orgId=${orgId}`);
    const data = await response.json();
    setInvites(data.invites ?? []);
    if (data.adminTenure) setAdminTenure(data.adminTenure as AdminTenure);
    if (data.delivery) setDeliveryMode(data.delivery as InviteDeliveryMode);
    if (!response.ok) setMessage(data.error);

    const membersResponse = await fetch(`/api/organizations/members?orgId=${encodeURIComponent(orgId)}`);
    const membersData = await membersResponse.json();
    if (membersResponse.ok) {
      setMembers(Array.isArray(membersData.members) ? membersData.members : []);
      if (membersData.adminTenure) setAdminTenure(membersData.adminTenure as AdminTenure);
      setMembersLoaded(true);
      setMembershipFetchFailed(false);
      setMembershipErrorStatus(null);
      setMembershipErrorMessage("");
    } else {
      setMembers([]);
      setMembersLoaded(true);
      setMembershipFetchFailed(true);
      setMembershipErrorStatus(membersResponse.status);
      setMembershipErrorMessage(membersData.error ?? "Could not load members");
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
      setDefaultRepo(githubData.connection?.defaultRepoFullName ?? "");
      if (githubData.connection) {
        const reposResponse = await fetch(`/api/github/repos?orgId=${encodeURIComponent(orgId)}`);
        const reposData = await reposResponse.json();
        if (reposResponse.ok) {
          setGithubRepos(Array.isArray(reposData.repos) ? reposData.repos : []);
        } else {
          setGithubRepos([]);
        }
      } else {
        setGithubRepos([]);
      }
      setGithubFetchFailed(false);
      setGithubErrorStatus(null);
      setGithubErrorMessage("");
    } else {
      setGithubFetchFailed(true);
      setGithubErrorStatus(githubResponse.status);
      setGithubErrorMessage(githubData.error ?? "Could not load GitHub context");
      setGithubConnection(null);
      setGithubRepos([]);
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
  async function copyInviteLink(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInviteId(id);
      window.setTimeout(() => {
        setCopiedInviteId((current) => (current === id ? null : current));
      }, 2000);
    } catch {
      setInviteNotice({
        tone: "error",
        message: "Could not copy automatically. Select the invite link and copy it.",
      });
    }
  }

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    if (inviteBusy) return;
    setInviteBusy(true);
    try {
      const response = await fetch("/api/organizations/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, email, role }),
      });
      const data = (await response.json()) as {
        id?: string;
        inviteUrl?: string;
        emailSent?: boolean;
        delivery?: InviteDeliveryMode;
        emailError?: string;
        error?: string;
      };
      if (!response.ok) {
        setInviteNotice({ tone: "error", message: data.error ?? "Could not create invitation." });
        return;
      }
      setInviteNotice(
        inviteSendResultCopy({
          emailSent: Boolean(data.emailSent),
          delivery: data.delivery ?? "failed",
          emailError: data.emailError,
        }),
      );
      if (data.id && data.inviteUrl) {
        setInviteLinks((current) => ({ ...current, [data.id!]: data.inviteUrl! }));
        await copyInviteLink(data.id, data.inviteUrl);
      }
      setEmail("");
      await load();
    } finally {
      setInviteBusy(false);
    }
  }

  async function act(inviteId: string, action: "resend" | "revoke") {
    if (actingInviteId) return;
    setActingInviteId(inviteId);
    try {
      const response = await fetch("/api/organizations/invites", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, inviteId, action }),
      });
      const data = (await response.json()) as {
        inviteUrl?: string;
        emailSent?: boolean;
        delivery?: InviteDeliveryMode;
        emailError?: string;
        error?: string;
      };
      if (!response.ok) {
        setInviteNotice({
          tone: "error",
          message: data.error ?? `Could not ${action} invitation.`,
        });
        return;
      }
      if (action === "resend") {
        setInviteNotice(
          inviteSendResultCopy({
            emailSent: Boolean(data.emailSent),
            delivery: data.delivery ?? "failed",
            emailError: data.emailError,
          }),
        );
        if (data.inviteUrl) {
          setInviteLinks((current) => ({ ...current, [inviteId]: data.inviteUrl! }));
          await copyInviteLink(inviteId, data.inviteUrl);
        }
      } else {
        setInviteNotice({ tone: "ok", message: "Invite revoked." });
        setInviteLinks((current) => {
          const next = { ...current };
          delete next[inviteId];
          return next;
        });
      }
      await load();
    } finally {
      setActingInviteId(null);
    }
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
  async function sendPasswordReset(member: Member) {
    if (resetBusyUserId) return;
    setResetBusyUserId(member.userId);
    try {
      const response = await fetch("/api/team/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, userId: member.userId }),
      });
      const data = await response.json();
      setMessage(
        response.ok
          ? `Password reset email sent to ${member.email}. They set the new password themselves; existing sessions end when the reset completes.`
          : data.error ?? "Could not send the password reset email.",
      );
    } finally {
      setResetBusyUserId(null);
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
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const nextPath =
    typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`;
  const githubFailure =
    githubShell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({ status: githubErrorStatus, message: githubErrorMessage, online }),
          { nextPath, message: githubErrorMessage || githubCopy.description },
        )
      : null;

  const pendingInvites = invites.filter((invite) => invite.status === "pending").length;
  const pendingAccess = accessRequests.filter((request) => request.status === "pending").length;
  const deliveryBanner = inviteDeliveryBanner(deliveryMode);
  const membershipShell = classifyTeamAdminShell({
    loading: membershipLoading,
    fetchFailed: membershipFetchFailed,
    hasOrgs: true,
    orgId,
    memberCount: members.length,
  });
  const membershipCopy = teamAdminShellCopy(membershipShell);
  const membershipFailure =
    membershipShell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: membershipErrorStatus,
            message: membershipErrorMessage,
            online,
          }),
          { nextPath, message: membershipErrorMessage || membershipCopy.description },
        )
      : null;
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
        description="Invite exact emails, manage real members, configure GitHub robot-code context, and BYO model providers (API keys). Rosters and repo lists stay blank until real rows exist."
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

      <TeamBrandingPanel orgId={orgId} />

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
          <strong>AI keys</strong>
          <span>Yours or the team’s · OpenAI, Anthropic, Ollama</span>
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
        <a href={withOrgHref("/team/slack", orgId)}>
          <strong>Slack</strong>
          <span>Two-way team chat bridge</span>
        </a>
        <a href="#github-connection">
          <strong>GitHub</strong>
          <span>Robot-code context for AI.</span>
        </a>
        <a href="/account?tab=notifications">
          <strong>Notification prefs</strong>
          <span>In-app and email opt-ins</span>
        </a>
        <a href="/account?tab=integrations">
          <strong>Account Connections</strong>
          <span>TBA, Onshape, Discord, Slack, GitHub</span>
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
            badge={membershipFailure ? "Unavailable" : undefined}
            badgeTone="setup"
            title={membershipFailure ? membershipFailure.title : membershipCopy.title}
            description={
              membershipFailure ? membershipFailure.description : membershipCopy.description
            }
            aria-busy={membershipShell === "loading"}
          >
            {membershipFailure?.primary ? (
              <a className="app-button" href={membershipFailure.primary.href}>
                {membershipFailure.primary.label}
              </a>
            ) : null}
            {membershipFailure?.showRetry ? (
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
              <p className="app-muted">Finish these once and this page fills in.</p>
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
                <div className="team-member-actions">
                  <a className="app-button secondary" href={withOrgHref("/team/security", orgId)}>
                    Capabilities
                  </a>
                  <button
                    type="button"
                    className="app-button secondary"
                    disabled={resetBusyUserId === member.userId}
                    onClick={() => setResetTarget(member)}
                  >
                    {resetBusyUserId === member.userId ? "Sending…" : "Send password reset"}
                  </button>
                </div>
              </article>
            ))}
          </Panel>
        ) : null}
      </section>

      <ConfirmDialog
        open={Boolean(resetTarget)}
        opts={
          resetTarget
            ? {
                title: "Send password reset email",
                body: `Email a password reset link to ${resetTarget.name || resetTarget.email} (${resetTarget.email})? This never sets a password — they choose a new one from the email, and their existing sessions end when the reset completes.`,
                confirmLabel: "Send password reset",
                tone: "destructive",
              }
            : null
        }
        onResolve={(ok) => {
          const member = resetTarget;
          setResetTarget(null);
          if (ok && member) void sendPasswordReset(member);
        }}
      />

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
                <div><dt>CREW</dt><dd>{request.crewRole ?? "Not specified"}</dd></div>
                <div><dt>PRIMARY FOCUS</dt><dd>{request.primaryFocus}</dd></div>
                {request.roleDescription ? (
                  <div><dt>HOW THEY HELP</dt><dd>{request.roleDescription}</dd></div>
                ) : null}
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
      <section className="admin-grid team-invite-grid" id="invite-form">
        <form className="team-invite-form" onSubmit={sendInvite}>
          <span className="eyebrow">INVITE BY EMAIL</span>
          <h2>Add a teammate</h2>
          <p>
            Send an invite to one email. They sign in with that address and accept the link. Team
            numbers never grant access.
          </p>
          {adminTenure?.inviteHint ? (
            <p className="app-muted team-admin-tenure-hint" role="note">
              {adminTenure.inviteHint}
            </p>
          ) : null}
          {deliveryBanner ? (
            <p
              className={`team-invite-banner ${deliveryBanner.tone === "setup" ? "setup" : "info"}`}
              role="note"
            >
              <strong>{deliveryBanner.title}</strong>
              <span>{deliveryBanner.detail}</span>
            </p>
          ) : null}
          <label>
            Email
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
            />
          </label>
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="scout">Scout</option>
              <option value="admin">Admin</option>
              <option value="viewer">Viewer</option>
            </select>
          </label>
          <button className="primary-action" type="submit" disabled={inviteBusy}>
            {inviteBusy ? "Sending…" : "Send invite"}
          </button>
          {inviteNotice ? (
            <p className={`team-invite-notice ${inviteNotice.tone}`} role="status">
              {inviteNotice.message}
            </p>
          ) : null}
        </form>
        <Panel className="invite-list team-invite-ledger" id="invitation-ledger">
          <span className="eyebrow">Pending and past invites</span>
          {!invites.length ? (
            <EmptyState
              soft
              badge="No invitations yet"
              badgeTone="setup"
              title="No invites sent yet"
              description="Send an email on the left. You will get a copyable link even if email is not configured."
            />
          ) : (
            invites.map((inviteRow) => {
              const link = inviteLinks[inviteRow.id];
              const pending = inviteRow.status === "pending";
              return (
                <article key={inviteRow.id} className={pending ? "pending" : undefined}>
                  <div>
                    <strong>{inviteRow.email}</strong>
                    <small>{formatInviteRowMeta(inviteRow)}</small>
                  </div>
                  <time>
                    {inviteRow.acceptedAt
                      ? `Accepted ${new Date(inviteRow.acceptedAt).toLocaleDateString()}`
                      : `Expires ${new Date(inviteRow.expiresAt).toLocaleString()}`}
                  </time>
                  {pending ? (
                    <div className="team-invite-row-actions">
                      {link ? (
                        <button
                          type="button"
                          onClick={() => void copyInviteLink(inviteRow.id, link)}
                        >
                          {copiedInviteId === inviteRow.id ? "Copied" : "Copy link"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={actingInviteId === inviteRow.id}
                        onClick={() => void act(inviteRow.id, "resend")}
                      >
                        {actingInviteId === inviteRow.id ? "Working…" : link ? "Resend" : "Resend & copy link"}
                      </button>
                      <button
                        type="button"
                        disabled={actingInviteId === inviteRow.id}
                        onClick={() => void act(inviteRow.id, "revoke")}
                      >
                        Revoke
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </Panel>
      </section>
      <section className="compare-panel github-panel" id="github-connection">
        <h2>GitHub</h2>
        <p className="app-muted">Connect so calendar due dates and code tools can use this team’s repo.</p>

        {githubShell === "loading" || githubShell === "error" ? (
          <EmptyState
            soft
            badge={githubFailure ? "Unavailable" : undefined}
            badgeTone="setup"
            title={githubFailure ? githubFailure.title : githubCopy.title}
            description={githubFailure ? githubFailure.description : githubCopy.description}
            aria-busy={githubShell === "loading"}
          >
            {githubFailure?.primary ? (
              <a className="app-button" href={githubFailure.primary.href}>
                {githubFailure.primary.label}
              </a>
            ) : null}
            {githubFailure?.showRetry ? (
              <button type="button" className="app-button secondary" onClick={() => void load()}>
                Retry
              </button>
            ) : null}
          </EmptyState>
        ) : null}

        <div className="admin-grid">
          <section className="intel-panel">
            {githubOAuthSetupRequired ? (
              <p className="app-muted github-oauth-note">OAuth isn’t configured on this server. Save a PAT instead.</p>
            ) : null}
            {githubConnection ? (
              <article className="admin-org">
                <b>LINKED</b>
                <div>
                  <strong>@{githubConnection.githubLogin ?? "github"}</strong>
                  <small>
                    {githubConnection.authMethod} · {githubConnection.status}
                    {githubConnection.defaultRepoFullName
                      ? ` · ${githubConnection.defaultRepoFullName}`
                      : " · pick a default repo"}
                  </small>
                </div>
              </article>
            ) : null}
            <div className="intel-actions">
              <button
                type="button"
                className={githubOAuthSetupRequired ? undefined : "primary-action"}
                disabled={githubBusy || githubOAuthSetupRequired || githubLoading}
                onClick={() => void connectGitHubOAuth()}
              >
                {githubOAuthSetupRequired ? "Connect GitHub (OAuth unavailable)" : "Connect GitHub"}
              </button>
              {githubConnection ? (
                <button type="button" disabled={githubBusy} onClick={() => void disconnectGitHub()}>
                  Disconnect
                </button>
              ) : null}
            </div>
          </section>
          <section className="intel-panel">
            <form onSubmit={saveGitHubPat}>
              <span className="eyebrow">{githubOAuthSetupRequired ? "CONNECT WITH PAT" : "OR SAVE A PAT"}</span>
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
                Save token
              </button>
            </form>
            {githubConnection ? (
              <form id="github-default-repo" onSubmit={setGitHubDefaultRepo} style={{ marginTop: "1.25rem" }}>
                <span className="eyebrow">DEFAULT REPO</span>
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
                {!githubRepos.length ? (
                  <p className="app-muted">No repositories on this account yet.</p>
                ) : null}
                <button className="primary-action" disabled={githubBusy || !defaultRepo}>
                  Set default repo
                </button>
              </form>
            ) : null}
          </section>
        </div>
      </section>
      <section className="compare-panel" id="custom-providers">
        <span className="eyebrow">AI keys</span>
        <p>
          OpenAI, Anthropic, and Ollama / LM Studio live on{" "}
          <a href={withOrgHref("/team/ai-keys", orgId)}>AI keys</a>
          — personal or team-wide.
        </p>
        {providers.length ? (
          <section className="intel-panel">
            <span className="eyebrow">LEFTOVER CUSTOM ENDPOINTS</span>
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
                  {item.enabled ? (
                    <div>
                      <button type="button" onClick={() => void providerAction(item.id, "test")}>
                        Test
                      </button>
                      <button type="button" onClick={() => void providerAction(item.id, "disable")}>
                        Disable
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </section>
    </main>
  );
}
