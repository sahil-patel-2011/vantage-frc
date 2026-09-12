"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Badge, EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  SUBTEAM_LABELS,
  TEAM_ROLE_LABELS,
  type SubteamMember,
  type SubteamProgress,
} from "../../lib/subteams/store";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type View = {
  orgId?: string;
  orgName: string;
  canManage: boolean;
  progress: SubteamProgress | null;
};

function isSubteamsView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { orgName?: unknown }).orgName === "string";
}

function subteamsCacheOrg(data: View, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistSubteamsSnapshot(orgHint: string, data: View): Promise<void> {
  const cacheOrg = subteamsCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("subteams", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("subteams", "_", data);
  } catch {
    // Live subteam progress already painted; IndexedDB is best-effort.
  }
}

/**
 * What each person still owes, in words rather than a score.
 *
 * Deliberately not a percentage or a "readiness" number: a mentor needs to know
 * that Maya has not confirmed the safety notice, not that she is 67% complete.
 * Returning an empty list is the normal, good case.
 */
function owed(member: SubteamMember): string[] {
  const items: string[] = [];
  if (!member.onboarded) items.push("has not finished onboarding");
  if (member.outstandingForms > 0) {
    items.push(`${member.outstandingForms} form${member.outstandingForms === 1 ? "" : "s"} to fill in`);
  }
  if (member.unacknowledgedNotices > 0) {
    items.push(
      `${member.unacknowledgedNotices} notice${member.unacknowledgedNotices === 1 ? "" : "s"} to confirm`,
    );
  }
  return items;
}

function MemberRow({ member }: { member: SubteamMember }) {
  const items = owed(member);
  return (
    <li className={items.length > 0 ? "st-member owed" : "st-member"}>
      <span className="st-member-name">
        <strong>{member.displayName}</strong>
        {member.teamRole ? (
          <small className="app-muted">{TEAM_ROLE_LABELS[member.teamRole] ?? member.teamRole}</small>
        ) : null}
      </span>
      <span className="st-member-state">
        {items.length === 0 ? (
          <small className="app-muted">Up to date</small>
        ) : (
          <small>{items.join(" · ")}</small>
        )}
      </span>
    </li>
  );
}

/**
 * Where a mentor goes to settle what this group owes.
 *
 * Without these the page is a read-only dead end: it tells you four people have
 * not confirmed a notice and gives you nowhere to go. Only the links that are
 * actually relevant to this group are rendered.
 */
function GroupActions({ members }: { members: SubteamMember[] }) {
  const forms = members.some((member) => member.outstandingForms > 0);
  const notices = members.some((member) => member.unacknowledgedNotices > 0);
  if (!forms && !notices) return null;
  return (
    <div className="st-actions">
      {notices ? (
        <Button as="a" variant="secondary" href="/announcements">
          Open announcements
        </Button>
      ) : null}
      {forms ? (
        <Button as="a" variant="secondary" href="/forms">
          Open forms
        </Button>
      ) : null}
    </div>
  );
}

export default function SubteamsClient() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = new URLSearchParams(window.location.search).get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("subteams", orgHint || "_");
      if (!viewRef.current && cached?.data && isSubteamsView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      const response = await fetch(`/api/subteams${orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as View & { error?: string };
      if (!response.ok || !isSubteamsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Subteam progress. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setError("error" in data && data.error ? data.error : "Could not load subteams.");
          setErrorStatus(response.status);
          setFetchFailed(true);
        }
        return;
      }
      setError("");
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistSubteamsSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Subteam progress. Showing the last copy on this device.");
        setFetchFailed(false);
      } else {
        setFetchFailed(true);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error || "Check your connection and try again.",
          },
        )
      : null;
    return (
      <main className="module-page subteams-page">
        <PageHeader breadcrumbs="Team / Subteam progress" title="Subteam progress" />
        <OfflineBanner feature="Subteam progress" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Opening Subteam progress"}
          description={failure ? failure.description : undefined}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>{failure.primary.label}</Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>Retry</Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (!view.canManage || !view.progress) {
    return (
      <main className="module-page subteams-page">
        <PageHeader breadcrumbs="Team / Subteam progress" title="Subteam progress" />
        <OfflineBanner feature="Subteam progress" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge="Leads only"
          badgeTone="setup"
          title="This view is for mentors and coaches"
          description="It shows who on each subteam still owes a form or has not confirmed a required notice, so it is limited to owners and admins."
        >
          <Button as="a" variant="primary" href="/team">Open Team</Button>
        </EmptyState>
      </main>
    );
  }

  const { progress } = view;
  const attention = progress.subteams.reduce((total, group) => total + group.needsAttention.length, 0);

  return (
    <main className="module-page subteams-page">
      <PageHeader
        breadcrumbs="Team / Subteam progress"
        title="Subteam progress"
        description={`Who is on each subteam in ${view.orgName}, and what each of them still owes.`}
      />
      <OfflineBanner feature="Subteam progress" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? <p className="app-muted">{error}</p> : null}

      <Panel className="st-summary">
        <div>
          <strong>{progress.totalMembers}</strong>
          <small className="app-muted">on the team</small>
        </div>
        <div>
          <strong>{progress.studentCount}</strong>
          <small className="app-muted">students</small>
        </div>
        <div>
          <strong>{progress.mentorCount}</strong>
          <small className="app-muted">mentors &amp; coaches</small>
        </div>
        <div>
          <strong>{attention + progress.unassigned.length}</strong>
          <small className="app-muted">need a follow-up</small>
        </div>
      </Panel>

      {progress.totalMembers === 0 ? (
        <EmptyState
          soft
          badge="No members"
          badgeTone="setup"
          title="Nobody has joined yet"
          description="Invite your team, and everyone who finishes onboarding will appear here under the subteam they picked."
        >
          <Button as="a" variant="primary" href="/team/admin">Invite people</Button>
        </EmptyState>
      ) : null}

      {progress.unassigned.length > 0 ? (
        <Panel className="st-group st-unassigned">
          <header>
            <h2>No subteam yet</h2>
            <Badge tone="setup">{progress.unassigned.length}</Badge>
          </header>
          <p className="app-muted">
            These people finished onboarding without picking a subteam, or joined before they were asked. They are the
            easiest people on the team to lose.
          </p>
          <ul className="st-members">
            {progress.unassigned.map((member) => (
              <MemberRow key={member.userId} member={member} />
            ))}
          </ul>
          <GroupActions members={progress.unassigned} />
        </Panel>
      ) : null}

      {progress.subteams.map((group) => (
        <Panel key={group.id} className="st-group">
          <header>
            <h2>{SUBTEAM_LABELS[group.id] ?? group.label}</h2>
            <span className="st-group-meta">
              <small className="app-muted">
                {group.members.length} {group.members.length === 1 ? "person" : "people"}
              </small>
              {group.needsAttention.length > 0 ? (
                <Badge tone="setup">{group.needsAttention.length} to follow up</Badge>
              ) : (
                <Badge tone="good">All clear</Badge>
              )}
            </span>
          </header>
          <ul className="st-members">
            {group.members.map((member) => (
              <MemberRow key={member.userId} member={member} />
            ))}
          </ul>
          <GroupActions members={group.members} />
        </Panel>
      ))}
    </main>
  );
}
