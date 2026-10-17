"use client";

import { staleCopyNotice } from "../../lib/ui/stale-copy";
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
import { MoneyManagersLine } from "./admin/money-managers-line";
import { TeamAdminAccessPanel } from "./team-admin-access";
import { TeamAdminInvitesPanel } from "./team-admin-invites";
import { TeamJoinCode } from "./team-join-code";
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
import { TeamHandoverDialog } from "./team-handover-dialog";
import { TeamAdminProvidersPanel } from "./team-admin-providers";
import { formatInviteRole } from "../../lib/invite/invite-flow";
import { likelyEmailTypo } from "../../lib/team/email-typo";
import { inviteEmailProblem, splitInviteEmails } from "../../lib/team/invite-email-address";
import { bulkInviteOutcome, type BulkInviteResult } from "../../lib/team/team-invites";
import { ORGANIZATION_INVITE_HOURS } from "@vantage/core/invite-policy";
import "./team-access-requests.css";
import "./team-admin.css";
import "./team-people-invites.css";
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
    return "Invite your team lead as a mentor or coach. Once they join, use your people menu to hand over the team or change your access.";
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
  const [lifetimeHours, setLifetimeHours] = useState(ORGANIZATION_INVITE_HOURS);
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
  const [stepDownOpen, setStepDownOpen] = useState(false);
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
    if (data.actor?.role) setActor(data.actor);
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

    // Each list on its own: one slow call (the members list, 8 s under load) used to replace the
    // whole page, invite form included, with "Something went wrong" (QA A3-23).
    const fetchJson = async (url: string) => {
      try {
        const response = await fetch(url, timeout);
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        return { ok: response.ok, status: response.status, data };
      } catch {
        return { ok: false, status: 0, data: {} as Record<string, unknown> };
      }
    };
    const refused = (result: { status: number; data: Record<string, unknown> }) =>
      result.status !== 0 &&
      ["auth", "reauth", "forbidden"].includes(
        classifyLoadFailure({ status: result.status, message: typeof result.data.error === "string" ? result.data.error : "" }),
      );

    try {
      const [invitesResult, membersResult] = await Promise.all([
        fetchJson(`/api/organizations/invites?orgId=${orgId}`),
        fetchJson(`/api/organizations/members?orgId=${encodeURIComponent(orgId)}`),
      ]);
      const data = invitesResult.data;
      if (refused(invitesResult)) {
        denied(invitesResult.status, typeof data.error === "string" ? data.error : "");
        return;
      }
      const membersData = membersResult.data;
      if (refused(membersResult)) {
        denied(membersResult.status, typeof membersData.error === "string" ? membersData.error : "Could not load members");
        return;
      }
      if (!invitesResult.ok && !membersResult.ok) {
        // Nothing came back at all: the last copy on this device, or the page's own error.
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage(staleCopyNotice("the people list"));
          setMembershipFetchFailed(false);
          setMembershipLoading(false);
          return;
        }
        setMembershipFetchFailed(true);
        setMembershipErrorStatus(membersResult.status || null);
        setMembershipErrorMessage(typeof membersData.error === "string" ? membersData.error : "");
        setMembershipLoading(false);
        return;
      }
      const nextInvites = Array.isArray(data.invites) ? (data.invites as Invite[]) : (viewRef.current?.invites ?? []);
      const nextTenure = data.adminTenure ? (data.adminTenure as AdminTenure) : null;
      const nextDelivery = data.delivery ? (data.delivery as InviteDeliveryMode) : null;
      if (!invitesResult.ok && typeof data.error === "string") setMessage(data.error);

      let nextMembers: Member[] = viewRef.current?.members ?? [];
      const membersLoaded = membersResult.ok;
      // Who is looking: the members answer if it came, else the (faster) invites answer — so the
      // owner keeps the Mentor choice and their own row stays "you" even when members is slow.
      const actorSource = membersLoaded ? membersData : invitesResult.ok ? data : null;
      const nextActor = actorSource && typeof actorSource.actorRole === "string"
        ? {
            userId: typeof actorSource.actorUserId === "string" ? actorSource.actorUserId : null,
            role: actorSource.actorRole,
          }
        : (viewRef.current?.actor ?? null);
      if (nextActor) setActor(nextActor);
      if (membersLoaded) {
        nextMembers = Array.isArray(membersData.members) ? (membersData.members as Member[]) : [];
        setMembershipFetchFailed(false);
        setMembershipErrorStatus(null);
        setMembershipErrorMessage("");
      } else {
        // The invite form still works; only People shows Retry.
        setMembershipFetchFailed(true);
        setMembershipErrorStatus(membersResult.status || null);
        setMembershipErrorMessage(typeof membersData.error === "string" ? membersData.error : "");
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
            ? (membersData.hubAccessByUser as Record<string, HubAccessRow[]>)
            : (viewRef.current?.hubAccessByUser ?? {}),
        ...(nextActor ? { actor: nextActor } : {}),
      };
      applySnapshot(snapshot);
      setFromCache(false);
      setCachedAt(null);
      setMembershipLoading(false);
      // Only a complete copy is kept on the phone: a failed people list must not replace it.
      if (membersLoaded && invitesResult.ok) await persistTeamAdminSnapshot(orgId, snapshot);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage(staleCopyNotice("the people list"));
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

  // A teammate's "please invite" notice opens here with the address and access filled in, so
  // inviting the mentor a student asked for is one tap (QA A3-04).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const suggested = params.get("email")?.trim();
    const suggestedRole = params.get("role");
    if (suggested && !inviteEmailProblem(suggested)) setEmail(suggested);
    if (suggestedRole === "admin" || suggestedRole === "scout" || suggestedRole === "viewer") setRole(suggestedRole);
  }, []);

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
          ? `${member.name || member.email} is no longer on the team. We let them know.`
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
    const many = again ? [] : splitInviteEmails(inviteEmail);
    // Checked here, by name, with the same rule as the server (invite-email-address.ts): a typo
    // or a non-ASCII address came back from the server as "Request fields are invalid."
    const problems = (many.length ? many : [inviteEmail.trim()])
      .map((entry) => inviteEmailProblem(entry))
      .filter((problem): problem is string => Boolean(problem));
    if (!again && problems.length) {
      setInviteNotice({ tone: "error", message: problems.join(" ") });
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
        body: JSON.stringify({ orgId, email: inviteEmail.trim(), role: inviteRole, expiresInHours: lifetimeHours }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        id?: string;
        inviteUrl?: string;
        emailSent?: boolean;
        delivery?: InviteDeliveryMode;
        emailError?: string;
        error?: string;
        code?: string;
        userId?: string;
      };
      if (!response.ok) {
        // Already on the team: say who and as what, and open their Access in one tap (QA A3-12).
        setInviteNotice({
          tone: "error",
          message: data.error ?? "Could not create the invite.",
          memberUserId: data.code === "already_member" && data.userId ? data.userId : null,
        });
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

  /**
   * A pasted list is one request (the server makes each invite on its own), so 20 addresses no
   * longer hit the limit at the 16th, and the addresses that didn't go stay in the field to fix
   * or send again instead of vanishing with the ones that did (QA A3-11).
   */
  async function sendInvites(emails: string[], inviteRole: string) {
    setInviteBusy(true);
    setInviteNotice(null);
    try {
      let results: BulkInviteResult[] = [];
      let requestError: string | null = null;
      try {
        const response = await fetch("/api/organizations/invites", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, emails, role: inviteRole, expiresInHours: lifetimeHours }),
        });
        const data = (await response.json().catch(() => ({}))) as { results?: BulkInviteResult[]; error?: string };
        if (Array.isArray(data.results)) results = data.results;
        else requestError = data.error ?? "Could not create the invites. Try again.";
      } catch {
        requestError = "Couldn't reach Vantage. Your list is still here. Try again.";
      }
      if (requestError) {
        setInviteNotice({ tone: "error", message: requestError });
        return;
      }
      const outcome = bulkInviteOutcome(results);
      setInviteLinks((current) => ({ ...current, ...Object.fromEntries(outcome.made.map((row) => [row.id, row.url])) }));
      setInviteNotice({ tone: outcome.tone, message: outcome.message, links: outcome.made });
      setEmail(outcome.keep.join(", "));
      if (!outcome.keep.length) setRole("scout");
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

  async function reviewAccess(
    requestId: string,
    decision: "approved" | "declined",
    role: "admin" | "scout" | "viewer" = "viewer",
  ) {
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
      title="Members and invites"
      description="Invite people and choose what each person can open."
    />
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
        lifetimeHours={lifetimeHours}
        setLifetimeHours={setLifetimeHours}
        canInviteMentor={actor.role === "owner"}
        roleKnown={actor.role !== null}
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
        onOpenMember={(userId) => {
          const member = members.find((row) => row.userId === userId);
          if (member) setAccessTarget(member);
        }}
      />

      {/* Inviting is this page's main job, so it comes first; the team code is the other way in. */}
      <div id="join-code" className="settings-anchor"><TeamJoinCode key={orgId} orgId={orgId} /></div>

      <TeamAdminAccessPanel
        accessRequests={accessRequests}
        message=""
        canApproveMentor={actor.role === "owner"}
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
        <>
        {/* Who can change the team's money (0714) — the owner and the people they chose. */}
        <div id="money-managers" className="settings-anchor"><MoneyManagersLine orgId={orgId} version={message} /></div>
        <TeamAdminPeople
          members={members}
          actorUserId={actor.userId}
          actorRole={actor.role}
          busyUserId={memberBusyId ?? resetBusyUserId}
          onAccess={(member) => setAccessTarget(member)}
          onPasswordReset={(member) => setResetTarget(member)}
          onRemove={(member) => setRemoveTarget(member)}
          onStepDown={() => setStepDownOpen(true)}
        />
        </>
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

      {stepDownOpen && actor.userId ? <TeamHandoverDialog orgId={orgId} actorUserId={actor.userId}
        owner={actor.role === "owner"} members={members} onClose={() => setStepDownOpen(false)} /> : null}

      <ConfirmDialog
        open={Boolean(removeTarget)}
        opts={
          removeTarget
            ? {
                title: `Remove ${removeTarget.name || removeTarget.email} from the team?`,
                body: "They lose access to this team straight away, and we tell them they were removed. Their account stays theirs, and what they did stays with the team. You can invite them again later.",
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
