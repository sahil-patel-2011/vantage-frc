"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, ConfirmDialog, EmptyState, Modal, PageHeader } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import {
  clearFeatureSnapshot,
  getFeatureSnapshot,
  putFeatureSnapshot,
} from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { classifyTeamAdminShell, teamAdminShellCopy } from "../../lib/team/team-admin-related";
import {
  inviteDeliveryBanner,
  inviteEmailIsOff,
  inviteSendResultCopy,
  type InviteDeliveryMode,
} from "../../lib/team/team-invites";
import { MemberAccessPanel, type HubAccessRow } from "./admin/member-access-panel";
import { TeamAdminAccessPanel } from "./team-admin-access";
import { TeamAdminInvitesPanel } from "./team-admin-invites";
import {
  type AccessRequest,
  type AdminTenure,
  type CustomProvider,
  type Invite,
  type InviteNotice,
  type Member,
  type TeamAdminSnapshot,
} from "./team-admin-model";
import { TeamAdminPeople } from "./team-admin-people";
import { TeamAdminProvidersPanel } from "./team-admin-providers";
import { formatInviteRole } from "../../lib/invite/invite-flow";
import { likelyEmailTypo } from "../../lib/team/email-typo";
import "./team-access-requests.css";
import "./team-admin.css";
import { TeamSettingsNav } from "../../components/team-settings-nav";
import { teamSettingsBreadcrumb } from "../../lib/nav/team-settings-nav";

function isTeamAdminSnapshot(value: unknown): value is TeamAdminSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as TeamAdminSnapshot;
  return Array.isArray(row.members) && Array.isArray(row.invites);
}

async function persistTeamAdminSnapshot(orgId: string, data: TeamAdminSnapshot): Promise<void> {
  if (!orgId.trim()) return;
  try {
    await putFeatureSnapshot("team-admin", orgId, data);
  } catch {
    // Live membership already painted; IndexedDB is best-effort.
  }
}

/** Keep people where they were: a role change used to re-sort the list and move the row. */
function keepOrder(previous: Member[], next: Member[]): Member[] {
  if (!previous.length) return next;
  const rank = new Map(previous.map((member, index) => [member.userId, index]));
  return [...next].sort(
    (a, b) => (rank.get(a.userId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.userId) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Plain-words version of the server's "bootstrap window" hint. */
function tenureTip(tenure: AdminTenure | null, invites: Invite[] = []): string | null {
  if (!tenure) return null;
  // Gone once a second adult is on the way: it stayed up after a mentor had been invited.
  const adultInvited = invites.some((invite) => invite.status === "pending" && invite.role !== "scout" && invite.role !== "viewer");
  if (tenure.adminCount <= 1 && !adultInvited) {
    return "Tip: invite a second adult as a mentor or coach, so the team isn't locked out if you're away.";
  }
  return null;
}

/** Wants the invite form: ?invite=1 (Home's "Invite your team") or #invite. */
function wantsInvite(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const hash = window.location.hash.replace(/^#/, "");
  return params.get("invite") === "1" || hash === "invite" || hash === "invite-form";
}

export default function TeamAdminClient({ orgId }: { orgId: string }) {
  const [view, setView] = useState<TeamAdminSnapshot | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [hubAccessByUser, setHubAccessByUser] = useState<Record<string, HubAccessRow[]>>({});
  const [adminTenure, setAdminTenure] = useState<AdminTenure | null>(null);
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
  // The address a "did you mean" was shown for: pressing Send again with it sends it anyway.
  const [typoWarnedFor, setTypoWarnedFor] = useState<string | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<InviteDeliveryMode | null>(null);
  const [providers, setProviders] = useState<CustomProvider[]>([]);
  const [resetTarget, setResetTarget] = useState<Member | null>(null);
  const [resetBusyUserId, setResetBusyUserId] = useState<string | null>(null);
  // Who is looking, so a row never offers to change or remove yourself or an owner.
  const [actor, setActor] = useState<{ userId: string | null; role: string | null }>({ userId: null, role: null });
  const [memberBusyId, setMemberBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);
  const [accessTarget, setAccessTarget] = useState<Member | null>(null);
  const viewRef = useRef<TeamAdminSnapshot | null>(null);
  viewRef.current = view;
  const membersRef = useRef<Member[]>([]);
  membersRef.current = members;
  const emailRef = useRef<HTMLInputElement | null>(null);
  const focusedInvite = useRef(false);

  const applySnapshot = useCallback((data: TeamAdminSnapshot) => {
    setView(data);
    setInvites(data.invites);
    setMembers(keepOrder(membersRef.current, data.members));
    setHubAccessByUser(data.hubAccessByUser ?? {});
    setAdminTenure(data.adminTenure);
    setAccessRequests(data.accessRequests);
    setProviders(data.providers);
    setDeliveryMode(data.deliveryMode);
  }, []);

  const load = useCallback(async () => {
    setMembershipLoading(true);
    setMembershipFetchFailed(false);
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<TeamAdminSnapshot>("team-admin", orgId);
      if (!viewRef.current && cached?.data && isTeamAdminSnapshot(cached.data)) {
        applySnapshot(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        setMembershipLoading(false);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }

    const timeout = { signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS), cache: "no-store" as const };
    const denied = (status: number, error: string) => {
      setView(null);
      setFromCache(false);
      setCachedAt(null);
      setMembershipFetchFailed(true);
      setMembershipErrorStatus(status);
      setMembershipErrorMessage(error);
      setMembershipLoading(false);
      void clearFeatureSnapshot("team-admin", orgId);
    };

    try {
      const [response, membersResponse] = await Promise.all([
        fetch(`/api/organizations/invites?orgId=${orgId}`, timeout),
        fetch(`/api/organizations/members?orgId=${encodeURIComponent(orgId)}`, timeout),
      ]);
      const data = await response.json();
      if (response.status === 401 || response.status === 403) {
        denied(response.status, typeof data.error === "string" ? data.error : "");
        return;
      }
      const nextInvites = Array.isArray(data.invites) ? data.invites : [];
      const nextTenure = data.adminTenure ? (data.adminTenure as AdminTenure) : null;
      const nextDelivery = data.delivery ? (data.delivery as InviteDeliveryMode) : null;
      if (!response.ok) setMessage(data.error);

      const membersData = await membersResponse.json();
      if (membersResponse.status === 401 || membersResponse.status === 403) {
        denied(membersResponse.status, membersData.error ?? "Could not load members");
        return;
      }

      let nextMembers: Member[] = [];
      if (membersResponse.ok) {
        nextMembers = Array.isArray(membersData.members) ? membersData.members : [];
        setActor({
          userId: typeof membersData.actorUserId === "string" ? membersData.actorUserId : null,
          role: typeof membersData.actorRole === "string" ? membersData.actorRole : null,
        });
        setMembershipFetchFailed(false);
        setMembershipErrorStatus(null);
        setMembershipErrorMessage("");
      } else if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh the people list. Showing the last copy on this device.");
        setMembershipFetchFailed(false);
        setMembershipLoading(false);
        return;
      } else {
        setMembers([]);
        setMembershipFetchFailed(true);
        setMembershipErrorStatus(membersResponse.status);
        setMembershipErrorMessage(membersData.error ?? "Could not load members");
        setMembershipLoading(false);
        return;
      }

      const [accessResponse, providerResponse] = await Promise.all([
        fetch(`/api/organizations/access-requests?orgId=${orgId}`, timeout),
        fetch(`/api/organizations/providers?orgId=${orgId}`, timeout),
      ]);
      const accessData = await accessResponse.json();
      const nextAccess = Array.isArray(accessData.requests) ? accessData.requests : [];
      if (!accessResponse.ok) setMessage(accessData.error);
      const providerData = await providerResponse.json().catch(() => ({}));
      const nextProviders = Array.isArray(providerData.providers) ? providerData.providers : [];

      const snapshot: TeamAdminSnapshot = {
        invites: nextInvites,
        members: nextMembers,
        adminTenure: nextTenure ?? (membersData.adminTenure as AdminTenure | undefined) ?? null,
        accessRequests: nextAccess,
        providers: nextProviders,
        deliveryMode: nextDelivery,
        hubAccessByUser:
          membersData.hubAccessByUser && typeof membersData.hubAccessByUser === "object"
            ? membersData.hubAccessByUser
            : {},
      };
      applySnapshot(snapshot);
      setFromCache(false);
      setCachedAt(null);
      setMembershipLoading(false);
      await persistTeamAdminSnapshot(orgId, snapshot);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh the people list. Showing the last copy on this device.");
        setMembershipFetchFailed(false);
        setMembershipLoading(false);
        return;
      }
      setMembershipFetchFailed(true);
      setMembershipLoading(false);
    }
  }, [applySnapshot, orgId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // GitHub moved to Connectors; old links and OAuth returns land there.
    if (params.get("github") || window.location.hash === "#github-connection") {
      window.location.replace(`/connectors/github${window.location.search}#github-connection`);
      return;
    }
    void load();
  }, [load, orgId]);

  // Arriving from "Invite someone" / Home's "Invite your team": the form is at
  // the top already, so put the cursor in Email, once.
  useEffect(() => {
    if (!view || focusedInvite.current || !wantsInvite()) return;
    focusedInvite.current = true;
    const input = emailRef.current;
    if (!input) return;
    document.getElementById("invite")?.scrollIntoView({ block: "start" });
    input.focus({ preventScroll: true });
  }, [view]);

  async function copyInviteLink(id: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInviteId(id);
      window.setTimeout(() => {
        setCopiedInviteId((current) => (current === id ? null : current));
      }, 2000);
    } catch {
      // Copying is a convenience; the Copy link button stays beside the message.
    }
  }

  /** Take someone off the team (PATCH /api/organizations/members). */
  async function removeMember(member: Member) {
    if (memberBusyId) return;
    setMemberBusyId(member.userId);
    try {
      const response = await fetch("/api/organizations/members", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, userId: member.userId, action: "remove" }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setMessage(
        response.ok
          ? `${member.name || member.email} is no longer on the team.`
          : (data.error ?? "That didn't save. Try again."),
      );
      if (response.ok) await load();
    } finally {
      setMemberBusyId(null);
    }
  }

  async function sendInvite(event: React.FormEvent | null, again?: { email: string; role: string }) {
    event?.preventDefault();
    if (inviteBusy) return;
    const inviteEmail = again?.email ?? email;
    const inviteRole = again?.role ?? role;
    // Several addresses pasted at once (commas, spaces, new lines): one invite each, same role,
    // and every link in one list to copy.
    const many = again ? [] : inviteEmail.split(/[\s,;]+/).map((entry) => entry.trim()).filter(Boolean);
    // Checked here, by name: a typo came back from the server as "Request fields are invalid."
    const notEmails = (many.length ? many : [inviteEmail.trim()]).filter(
      (entry) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry),
    );
    if (!again && notEmails.length) {
      setInviteNotice({
        tone: "error",
        message: `${notEmails.map((entry) => `"${entry}"`).join(", ")} ${
          notEmails.length === 1 ? "isn't a full email address" : "aren't full email addresses"
        }, like name@school.org.`,
      });
      return;
    }
    const typos = (many.length ? many : [inviteEmail.trim()])
      .map((entry) => ({ entry, fix: likelyEmailTypo(entry) }))
      .filter((row): row is { entry: string; fix: string } => row.fix != null);
    const typoKey = typos.map((row) => row.entry.toLowerCase()).join(",");
    if (!again && typos.length && typoWarnedFor !== typoKey) {
      setTypoWarnedFor(typoKey);
      setInviteNotice({
        tone: "error",
        message: `Check ${typos.map((row) => `"${row.entry}"`).join(", ")}: did you mean ${typos
          .map((row) => row.fix)
          .join(", ")}? Press Create invite again to use it as typed.`,
      });
      return;
    }
    if (many.length > 1) {
      await sendInvites(many, inviteRole);
      return;
    }
    // Inviting an address that already has an invite replaces it; say so when the role changes
    // instead of quietly turning a mentor's invite into a student's.
    const earlier = invites.find(
      (invite) => invite.status === "pending" && invite.email.toLowerCase() === inviteEmail.trim().toLowerCase(),
    );
    setInviteBusy(true);
    setInviteNotice(null);
    try {
      const response = await fetch("/api/organizations/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, email: inviteEmail, role: inviteRole }),
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
        setInviteNotice({ tone: "error", message: data.error ?? "Could not create the invite." });
        return;
      }
      const result = inviteSendResultCopy({
        emailSent: Boolean(data.emailSent),
        delivery: data.delivery ?? "failed",
        emailError: data.emailError,
      });
      const link = data.id && data.inviteUrl ? { id: data.id, url: data.inviteUrl } : null;
      const roleChange =
        earlier && earlier.role !== inviteRole
          ? ` They will now join as ${formatInviteRole(inviteRole) ?? inviteRole} (the earlier invite said ${formatInviteRole(earlier.role) ?? earlier.role}).`
          : "";
      setInviteNotice({
        tone: result.tone,
        message: `${again ? "Invite back for" : "Invite ready for"} ${inviteEmail.trim()}.${roleChange} ${result.message}`,
        link,
      });
      if (link) setInviteLinks((current) => ({ ...current, [link.id]: link.url }));
      if (!again) {
        setEmail("");
        // Back to the usual choice, so the next person isn't invited with the last one's role.
        setRole("scout");
      }
      await load();
    } finally {
      setInviteBusy(false);
    }
  }

  async function sendInvites(emails: string[], inviteRole: string) {
    setInviteBusy(true);
    setInviteNotice(null);
    const made: Array<{ email: string; id: string; url: string }> = [];
    const failed: string[] = [];
    let delivery: InviteDeliveryMode | undefined;
    try {
      for (const address of emails) {
        const response = await fetch("/api/organizations/invites", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, email: address, role: inviteRole }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          id?: string;
          inviteUrl?: string;
          delivery?: InviteDeliveryMode;
          error?: string;
        };
        if (response.ok && data.id && data.inviteUrl) {
          made.push({ email: address, id: data.id, url: data.inviteUrl });
          delivery = data.delivery ?? delivery;
        } else {
          failed.push(`${address} (${data.error ?? "could not be invited"})`);
        }
      }
      setInviteLinks((current) => ({ ...current, ...Object.fromEntries(made.map((row) => [row.id, row.url])) }));
      const sent = !inviteEmailIsOff(delivery) && delivery !== "failed";
      setInviteNotice({
        tone: failed.length ? "warn" : "ok",
        message:
          `${made.length} ${made.length === 1 ? "invite" : "invites"} ready.` +
          (sent ? " We emailed each of them a link." : " Email is off here, so copy the links below and send them yourself.") +
          (failed.length ? ` Not invited: ${failed.join("; ")}.` : ""),
        links: made,
      });
      if (made.length) {
        setEmail("");
        setRole("scout");
      }
      await load();
    } finally {
      setInviteBusy(false);
    }
  }

  async function act(inviteId: string, action: "resend" | "revoke" | "copy") {
    if (actingInviteId) return;
    setActingInviteId(inviteId);
    const target = invites.find((invite) => invite.id === inviteId);
    try {
      const response = await fetch("/api/organizations/invites", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        // "copy" on a row whose link we don't hold makes a fresh one — that is a resend.
        body: JSON.stringify({ orgId, inviteId, action: action === "copy" ? "resend" : action }),
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
          message: data.error ?? `Could not ${action === "revoke" ? "revoke" : "resend"} that invite.`,
        });
        return;
      }
      if (action === "revoke") {
        setInviteNotice({
          tone: "ok",
          message: `Invite to ${target?.email ?? "that person"} revoked. Their link no longer works.`,
          undo: target ? { label: "Undo", run: () => void sendInvite(null, { email: target.email, role: target.role }) } : null,
        });
        setInviteLinks((current) => {
          const next = { ...current };
          delete next[inviteId];
          return next;
        });
      } else {
        const result = inviteSendResultCopy({
          emailSent: Boolean(data.emailSent),
          delivery: data.delivery ?? "failed",
          emailError: data.emailError,
        });
        const link = data.inviteUrl ? { id: inviteId, url: data.inviteUrl } : null;
        if (link) {
          setInviteLinks((current) => ({ ...current, [inviteId]: link.url }));
          if (action === "copy") await copyInviteLink(inviteId, link.url);
        }
        setInviteNotice({
          tone: result.tone,
          message: `${action === "copy" || !data.emailSent || inviteEmailIsOff(data.delivery) ? "New link for" : "Invite emailed again to"} ${target?.email ?? "them"}. The earlier link no longer works. ${result.message}`,
          link,
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
          ? inviteEmailIsOff(deliveryMode)
            ? "Approved. Email is off here, so let them know they can sign in now."
            : "Approved. We emailed them a sign-in link."
          : "Request declined."
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
          ? inviteEmailIsOff(deliveryMode)
            ? `Email is off here, so no reset email reached ${member.email}. Once email is on they can use "Forgot password" on the sign-in page.`
            : `Password reset email sent to ${member.email}. They choose the new password themselves.`
          : data.error ?? "Could not send the password reset email.",
      );
    } finally {
      setResetBusyUserId(null);
    }
  }

  async function providerAction(id: string, action: "test" | "disable") {
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
      setMessage("Test this one from the paired desktop app.");
    } else {
      setMessage(action === "test" ? "It works." : "Turned off.");
    }
    await load();
  }

  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const nextPath =
    typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`;
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

  const header = (
    <PageHeader
      breadcrumbs={teamSettingsBreadcrumb("people")}
      title="Team admin"
      description="Invite people and choose what each person can open."
    >
      <TeamSettingsNav orgId={orgId} current="people" />
    </PageHeader>
  );

  if (!view) {
    const copy = membershipFailure
      ? membershipFailure
      : {
          title: membershipCopy.title,
          description: membershipCopy.description,
          primary: null as { href: string; label: string } | null,
          showRetry: membershipFetchFailed,
        };
    return (
      <main className="module-page team-admin-page">
        {header}
        <OfflineBanner feature="Team admin" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge={
            membershipFailure
              ? membershipFailure.badge
              : membershipFetchFailed
                ? "Unavailable"
                : undefined
          }
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
          aria-busy={!membershipFetchFailed}
        >
          {copy.primary ? (
            <Button as="a" variant="primary" href={copy.primary.href}>
              {copy.primary.label}
            </Button>
          ) : null}
          {copy.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="module-page team-admin-page">
      {header}
      <OfflineBanner feature="Team admin" fromCache={fromCache} cachedAt={cachedAt} />

      <TeamAdminInvitesPanel
        deliveryBanner={deliveryBanner}
        emailOff={inviteEmailIsOff(deliveryMode)}
        tip={tenureTip(adminTenure, invites)}
        email={email}
        setEmail={setEmail}
        role={role}
        setRole={setRole}
        emailRef={emailRef}
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

      <TeamAdminAccessPanel
        accessRequests={accessRequests}
        message=""
        onReview={(requestId, decision, reviewRole) => void reviewAccess(requestId, decision, reviewRole)}
      />

      {message ? (
        <p className="team-admin-message" role="status">
          {message}
        </p>
      ) : null}

      {membershipShell === "loading" || membershipShell === "error" ? (
        <EmptyState
          soft
          badge={membershipFailure ? membershipFailure.badge : undefined}
          badgeTone="setup"
          title={membershipFailure ? membershipFailure.title : membershipCopy.title}
          description={membershipFailure ? membershipFailure.description : membershipCopy.description}
          aria-busy={membershipShell === "loading"}
        >
          {membershipFailure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <TeamAdminPeople
          members={members}
          actorUserId={actor.userId}
          actorRole={actor.role}
          busyUserId={memberBusyId ?? resetBusyUserId}
          onAccess={(member) => setAccessTarget(member)}
          onPasswordReset={(member) => setResetTarget(member)}
          onRemove={(member) => setRemoveTarget(member)}
        />
      )}

      <TeamAdminProvidersPanel
        orgId={orgId}
        providers={providers}
        onAction={(id, action) => void providerAction(id, action)}
      />

      <MemberAccessPanel
        orgId={orgId}
        member={accessTarget}
        actorRole={actor.role}
        actorUserId={actor.userId}
        hubRows={accessTarget ? (hubAccessByUser[accessTarget.userId] ?? []) : []}
        onClose={() => setAccessTarget(null)}
        onSaved={async (text) => {
          setMessage(text);
          await load();
        }}
      />

      <ConfirmDialog
        open={Boolean(removeTarget)}
        opts={
          removeTarget
            ? {
                title: `Remove ${removeTarget.name || removeTarget.email} from the team?`,
                body: "They lose access to this team straight away. Their account stays theirs, and what they did stays with the team. You can invite them again later.",
                confirmLabel: "Remove from team",
                tone: "destructive",
              }
            : null
        }
        onResolve={(ok) => {
          const member = removeTarget;
          setRemoveTarget(null);
          if (ok && member) void removeMember(member);
        }}
      />

      {/* Not destructive, so not the red confirm: a plain dialog with a normal button. */}
      <Modal
        open={Boolean(resetTarget)}
        onClose={() => setResetTarget(null)}
        title="Send a password reset email?"
        description={
          resetTarget
            ? `${resetTarget.name || resetTarget.email} (${resetTarget.email}) gets a link to choose a new password. Nothing changes until they use it.`
            : undefined
        }
      >
        <div className="team-admin-dialog-actions">
          <Button variant="secondary" type="button" onClick={() => setResetTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="button"
            onClick={() => {
              const member = resetTarget;
              setResetTarget(null);
              if (member) void sendPasswordReset(member);
            }}
          >
            Send reset email
          </Button>
        </div>
      </Modal>
    </main>
  );
}
