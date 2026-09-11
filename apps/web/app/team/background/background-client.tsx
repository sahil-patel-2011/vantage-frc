"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import FundingProfileClient from "./funding-profile-client";
import "./background.css";

type FormState = {
  city: string;
  stateProv: string;
  description: string;
  mission: string;
  history: string;
  demographics: string;
  achievements: string;
  studentCount: string;
  mentorCount: string;
  foundedYear: string;
};

type BackgroundView = {
  status: "ready";
  orgId: string;
  canEdit: boolean;
  seedWhoWeAre: string | null;
  updatedAt: string | null;
  orgName: string | null;
  teamNumber: number | null;
  form: FormState;
};

function isBackgroundView(value: unknown): value is BackgroundView {
  if (!value || typeof value !== "object") return false;
  const row = value as { status?: unknown; orgId?: unknown; form?: unknown };
  return row.status === "ready" && typeof row.orgId === "string" && row.form != null && typeof row.form === "object";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

async function persistTeamBackgroundSnapshot(orgHint: string, data: BackgroundView): Promise<void> {
  const cacheOrg = data.orgId.trim() || orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("team-background", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("team-background", "_", data);
  } catch {
    // Live Team background already painted; IndexedDB is best-effort.
  }
}

function formFromPayload(data: {
  org?: { city?: string | null; stateProv?: string | null; description?: string | null; orgName?: string | null; teamNumber?: number | null };
  profile?: {
    mission?: string | null;
    history?: string | null;
    demographics?: string | null;
    achievements?: string[] | null;
    studentCount?: number | null;
    mentorCount?: number | null;
    foundedYear?: number | null;
  } | null;
}): FormState {
  return {
    city: data.org?.city ?? "",
    stateProv: data.org?.stateProv ?? "",
    description: data.org?.description ?? "",
    mission: data.profile?.mission ?? "",
    history: data.profile?.history ?? "",
    demographics: data.profile?.demographics ?? "",
    achievements: Array.isArray(data.profile?.achievements) ? data.profile.achievements.join("\n") : "",
    studentCount: data.profile?.studentCount != null ? String(data.profile.studentCount) : "",
    mentorCount: data.profile?.mentorCount != null ? String(data.profile.mentorCount) : "",
    foundedYear: data.profile?.foundedYear != null ? String(data.profile.foundedYear) : "",
  };
}

function TeamBackgroundRelated({ orgId }: { orgId: string }) {
  return (
    <nav className="product-hub-related" aria-label="Related team tools">
      <Button as="a" variant="secondary" href={withOrgHref("/writer", orgId)}>
        Writer
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/team/grants", orgId)}>
        Grant writing
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/team/admin", orgId)}>
        Team admin
      </Button>
    </nav>
  );
}

function TeamBackgroundNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "grants",
      label: "Open Grant calendar",
      detail: "Eligibility chips use the student and mentor counts recorded here.",
      href: withOrgHref("/team/grants/calendar", orgId),
      primary: true,
    },
    {
      id: "writer",
      label: "Open Writer",
      detail: "Award and sponsor drafts pull mission and history from this page.",
      href: withOrgHref("/writer", orgId),
    },
    {
      id: "setup",
      label: "Open Getting started",
      detail: "The team setup checklist ticks location once city and state are saved.",
      href: withOrgHref("/team/getting-started", orgId),
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
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
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function TeamBackgroundClient({ orgId }: { orgId: string }) {
  const [view, setView] = useState<BackgroundView | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "error">("ok");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<BackgroundView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<BackgroundView>("team-background", orgId || "_");
      if (!viewRef.current && cached?.data && isBackgroundView(cached.data)) {
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
      const response = await fetch(`/api/team/background?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(responseError(data) || "Could not load team background");
        setMessageTone("error");
        return;
      }
      if (!response.ok || !data || typeof data !== "object") {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Team background. Showing the last copy on this device.");
          setMessageTone("error");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(responseError(data) || "Could not load team background");
        setMessageTone("error");
        return;
      }
      const payload = data as {
        canEdit?: boolean;
        seedWhoWeAre?: string | null;
        updatedAt?: string | null;
        org?: { orgName?: string | null; teamNumber?: number | null };
      };
      const next: BackgroundView = {
        status: "ready",
        orgId,
        canEdit: Boolean(payload.canEdit),
        seedWhoWeAre: typeof payload.seedWhoWeAre === "string" ? payload.seedWhoWeAre : null,
        updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
        orgName: payload.org?.orgName ?? null,
        teamNumber: payload.org?.teamNumber ?? null,
        form: formFromPayload(payload),
      };
      setView(next);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistTeamBackgroundSnapshot(orgId, next);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Team background. Showing the last copy on this device.");
        setMessageTone("error");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!view?.canEdit || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/team/background", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          city: view.form.city || null,
          stateProv: view.form.stateProv || null,
          description: view.form.description || null,
          mission: view.form.mission || null,
          history: view.form.history || null,
          demographics: view.form.demographics || null,
          achievements: view.form.achievements,
          studentCount: view.form.studentCount || null,
          mentorCount: view.form.mentorCount || null,
          foundedYear: view.form.foundedYear || null,
        }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(responseError(data) || "Could not save team background");
        setMessageTone("error");
        return;
      }
      setMessage("Team background saved for this team only.");
      setMessageTone("ok");
      await load();
    } catch {
      setMessage("Could not reach the server.");
      setMessageTone("error");
    } finally {
      setSaving(false);
    }
  }

  const set =
    (key: keyof FormState) =>
    (event: { target: { value: string } }) =>
      setView((prev) => (prev ? { ...prev, form: { ...prev.form, [key]: event.target.value } } : prev));

  const title =
    view?.teamNumber != null
      ? `Team ${view.teamNumber} background`
      : view?.orgName
        ? `${view.orgName} background`
        : "Team background";

  const failure =
    !view && fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message,
          },
        )
      : null;

  return (
    <main className="module-page team-background-page">
      <PageHeader
        breadcrumbs="Team / Background"
        title={title}
        description="Mission, history, demographics, and achievements used by sponsorship one-pagers and grant drafts. Owners and admins edit this team only — never imported from another team."
      >
        <TeamBackgroundRelated orgId={orgId} />
      </PageHeader>
      <TeamOpsNav orgId={orgId} active="admin" />
      <OfflineBanner feature="Team background" fromCache={fromCache} cachedAt={cachedAt} />

      <FundingProfileClient orgId={orgId} />

      {message && !failure ? (
        <p className={messageTone === "error" ? "status-bad" : "status-good"} role="status">
          {message}
        </p>
      ) : null}

      {!view ? (
        <EmptyState
          soft
          title={failure ? failure.title : "Loading team background"}
          description={failure ? failure.description : "Pulling this team’s profile…"}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <>
        <form className="team-background-form" onSubmit={(event) => void save(event)}>
          <Panel>
            <h2>Location &amp; short description</h2>
            <p className="app-muted team-background-hint">
              City and state come from team onboarding when present. Edit them here anytime — they stay on this organization only.
            </p>
            <div className="team-background-grid">
              <label>
                City
                <input value={view.form.city} onChange={set("city")} disabled={!view.canEdit} placeholder="Portland" maxLength={120} />
              </label>
              <label>
                State / province
                <input value={view.form.stateProv} onChange={set("stateProv")} disabled={!view.canEdit} placeholder="OR" maxLength={80} />
              </label>
            </div>
            <label>
              Team description
              <textarea
                value={view.form.description}
                onChange={set("description")}
                disabled={!view.canEdit}
                rows={3}
                maxLength={2000}
                placeholder="One short paragraph about who this FRC team is."
              />
              <small>Optional. Used as a fallback blurb for sponsor proposals.</small>
            </label>
          </Panel>

          <Panel>
            <h2>Mission &amp; history</h2>
            <label>
              Mission
              <textarea
                value={view.form.mission}
                onChange={set("mission")}
                disabled={!view.canEdit}
                rows={3}
                maxLength={2000}
                placeholder="1–3 sentences: what this team exists to do."
              />
            </label>
            <label>
              History
              <textarea
                value={view.form.history}
                onChange={set("history")}
                disabled={!view.canEdit}
                rows={5}
                maxLength={8000}
                placeholder="Origin story, milestones, how the program grew — facts from this team only."
              />
            </label>
          </Panel>

          <Panel>
            <h2>Demographics</h2>
            <div className="team-background-grid">
              <label>
                Students
                <input
                  type="number"
                  min={0}
                  value={view.form.studentCount}
                  onChange={set("studentCount")}
                  disabled={!view.canEdit}
                  placeholder="40"
                />
              </label>
              <label>
                Mentors
                <input
                  type="number"
                  min={0}
                  value={view.form.mentorCount}
                  onChange={set("mentorCount")}
                  disabled={!view.canEdit}
                  placeholder="8"
                />
              </label>
              <label>
                Founded year
                <input
                  type="number"
                  min={1992}
                  max={3000}
                  value={view.form.foundedYear}
                  onChange={set("foundedYear")}
                  disabled={!view.canEdit}
                  placeholder="2012"
                />
              </label>
            </div>
            <label>
              Demographics notes
              <textarea
                value={view.form.demographics}
                onChange={set("demographics")}
                disabled={!view.canEdit}
                rows={3}
                maxLength={4000}
                placeholder="Schools served, first-gen STEM share, Title I context — only what you are comfortable publishing."
              />
            </label>
          </Panel>

          <Panel>
            <h2>Achievements</h2>
            <label>
              Key achievements
              <textarea
                value={view.form.achievements}
                onChange={set("achievements")}
                disabled={!view.canEdit}
                rows={5}
                placeholder={"won our regional\nlogged 400 outreach hours\ngrew to 40 students"}
              />
              <small>One per line. Used by the award writer and sponsorship drafts for this org only.</small>
            </label>
          </Panel>

          {view.seedWhoWeAre ? (
            <Panel>
              <h2>Sponsor proposal preview seed</h2>
              <p className="app-muted team-background-hint">
                Draft “who we are” text assembled from this team’s fields. Nothing is copied from another team.
              </p>
              <pre className="team-background-seed">{view.seedWhoWeAre}</pre>
            </Panel>
          ) : null}

          <div className="team-background-actions">
            {view.canEdit ? (
              <Button variant="primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save team background"}
              </Button>
            ) : (
              <p className="app-muted">View only — ask an owner or admin to edit this profile.</p>
            )}
            {view.updatedAt ? (
              <small className="app-muted">Last updated {new Date(view.updatedAt).toLocaleString()}</small>
            ) : null}
          </div>
        </form>
        <TeamBackgroundNextActions orgId={orgId} />
        </>
      )}
    </main>
  );
}
