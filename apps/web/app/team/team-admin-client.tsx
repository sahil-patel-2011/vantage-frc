"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog, EmptyState, PageHeader, Panel, Button } from "../../components/ui";
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
  teamAdminCardPrimaryHref,
  teamAdminNextActions,
  teamAdminRelatedLinks,
  teamAdminSetupSteps,
  teamAdminShellCopy,
  shouldShowTeamAdminSummaryTiles,
} from "../../lib/team/team-admin-related";
import {
  inviteDeliveryBanner,
  inviteSendResultCopy,
  type InviteDeliveryMode,
} from "../../lib/team/team-invites";
import { TeamBrandingPanel } from "../../lib/branding/team-branding-panel";
import { TeamAdminAccessPanel } from "./team-admin-access";
import { MembershipNextActionsPanel } from "./team-admin-chrome";
import { TeamAdminGitHubPanel } from "./team-admin-github";
import { TeamAdminInvitesPanel } from "./team-admin-invites";
import {
  type AccessRequest,
  type AdminTenure,
  type CustomProvider,
  type GitHubConnection,
  type GitHubRepo,
  type Invite,
  type InviteNotice,
  type Member,
} from "./team-admin-model";
import { TeamAdminProvidersPanel } from "./team-admin-providers";
import { TeamProfilePanel } from "./team-profile-panel";
import "./github-connection.css";
import "./team-access-requests.css";
import "./team-admin.css";

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
  const [inviteNotice, setInviteNotice] = useState<InviteNotice | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<InviteDeliveryMode | null>(null);
  const [providers, setProviders] = useState<CustomProvider[]>([]);
  const [githubOAuthSetupRequired, setGithubOAuthSetupRequired] = useState(false);
  /** Setup copy from the server — names the variables and the callback URL. */
  const [githubOAuthMessage, setGithubOAuthMessage] = useState("");
  const [githubCredentialRejected, setGithubCredentialRejected] = useState<{ login: string | null } | null>(null);
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
      setGithubOAuthMessage(typeof githubData.message === "string" ? githubData.message : "");
      setGithubCredentialRejected(
        githubData.credentialRejected ? { login: githubData.rejectedLogin ?? null } : null,
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
    if (params.get("github") === "connected") setMessage("GitHub connected for this team.");
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
      setMessage(response.ok ? "GitHub PAT encrypted and saved for this team." : data.error);
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
    if (!confirm("Disconnect GitHub for this team? AI chat will stop using repo file context.")) return;
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
  const membershipCardPrimary =
    membershipShell === "empty"
      ? "#invite-form"
      : membershipShell === "setup"
        ? teamAdminCardPrimaryHref(orgId)
        : null;
  const membershipActions = teamAdminNextActions({
    orgId,
    shell: membershipShell,
    memberCount: members.length,
    pendingInviteCount: pendingInvites,
    pendingAccessCount: pendingAccess,
  }).filter((action) => !membershipCardPrimary || action.href !== membershipCardPrimary);
  const membershipRelated = teamAdminRelatedLinks(orgId, {
    include: [...TEAM_ADMIN_RELATED_INCLUDE],
  });
  const membershipSteps =
    membershipShell === "setup"
      ? teamAdminSetupSteps(orgId).filter(
          (step) => !membershipCardPrimary || step.href !== membershipCardPrimary,
        )
      : [];
  const showMembershipTiles = shouldShowTeamAdminSummaryTiles({
    memberCount: members.length,
    inviteCount: invites.length,
  });

  return (
    <main className="module-page team-admin-page">
      <PageHeader
        breadcrumbs="Team / Admin"
        title="Team admin"
        description="Invite exact emails, manage real members, configure GitHub robot-code context, and your own model providers (API keys). Rosters and repo lists stay blank until real rows exist."
      >
        <nav className="product-hub-related team-admin-related" aria-label="Related account tools">
          {membershipRelated.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </nav>
      </PageHeader>
      <TeamOpsNav orgId={orgId} active="admin" />

      <TeamProfilePanel orgId={orgId} />

      <TeamBrandingPanel orgId={orgId} />

      <nav className="settings-hub" aria-label="Team settings">
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
          <strong>Chat limits</strong>
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
        <a href="/connectors">
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
        <a href="/connectors">Connections</a>
      </nav>

      <section className="compare-panel team-admin-membership" id="membership" aria-labelledby="membership-title">
        <span className="eyebrow">MEMBERS &amp; INVITES</span>
        <h2 id="membership-title">{membershipCopy.title}</h2>
        <p className="app-muted">{membershipCopy.description}</p>
        <nav className="product-hub-related team-admin-related" aria-label="Related membership tools">
          {membershipRelated.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
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
              <Button as="a" variant="primary" href={membershipFailure.primary.href}>
                {membershipFailure.primary.label}
              </Button>
            ) : null}
            {membershipFailure?.showRetry ? (
              <Button variant="secondary" type="button" onClick={() => void load()}>
                Retry
              </Button>
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
            <Button as="a" variant="primary" href="#invite-form">
              Invite an exact email
            </Button>
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
                  <Button as="a" variant="secondary" href={step.href}>
                    Open
                  </Button>
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
                  <Button as="a" variant="secondary" href={withOrgHref("/team/security", orgId)}>
                    Capabilities
                  </Button>
                  <Button variant="secondary" type="button" disabled={resetBusyUserId === member.userId} onClick={() => setResetTarget(member)}>
                    {resetBusyUserId === member.userId ? "Sending…" : "Send password reset"}
                  </Button>
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

      <TeamAdminAccessPanel
        accessRequests={accessRequests}
        message={message}
        onReview={(requestId, decision, role) => void reviewAccess(requestId, decision, role)}
      />
      <TeamAdminInvitesPanel
        adminTenure={adminTenure}
        deliveryBanner={deliveryBanner}
        email={email}
        setEmail={setEmail}
        role={role}
        setRole={setRole}
        inviteBusy={inviteBusy}
        inviteNotice={inviteNotice}
        invites={invites}
        inviteLinks={inviteLinks}
        copiedInviteId={copiedInviteId}
        actingInviteId={actingInviteId}
        onSend={(event) => void sendInvite(event)}
        onCopyLink={(id, url) => void copyInviteLink(id, url)}
        onAct={(inviteId, action) => void act(inviteId, action)}
      />
      <TeamAdminGitHubPanel
        githubShell={githubShell}
        githubCopy={githubCopy}
        githubFailure={githubFailure}
        githubLoading={githubLoading}
        githubOAuthSetupRequired={githubOAuthSetupRequired}
        githubOAuthMessage={githubOAuthMessage}
        githubCredentialRejected={githubCredentialRejected}
        githubConnection={githubConnection}
        githubBusy={githubBusy}
        githubPat={githubPat}
        setGithubPat={setGithubPat}
        githubRepos={githubRepos}
        defaultRepo={defaultRepo}
        setDefaultRepo={setDefaultRepo}
        onRetry={() => void load()}
        onConnectOAuth={() => void connectGitHubOAuth()}
        onDisconnect={() => void disconnectGitHub()}
        onSavePat={(event) => void saveGitHubPat(event)}
        onSetDefaultRepo={(event) => void setGitHubDefaultRepo(event)}
      />
      <TeamAdminProvidersPanel
        orgId={orgId}
        providers={providers}
        onAction={(id, action) => void providerAction(id, action)}
      />
    </main>
  );
}
