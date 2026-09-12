"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";

type Signals = {
  members: number;
  pendingInvites: number;
  knowledgeChars: number;
  teamMemories: number;
  alumni: number;
  assistantRuns: number;
  budgetsConfigured: boolean | null;
  byokKeysConfigured: boolean | null;
  discordConnected: boolean | null;
  joinedSubteam: boolean;
  logisticsTrips: number;
  kickoffActions: number;
  hasLocation?: boolean;
};

type Data = {
  role: string;
  isAdmin: boolean;
  teamNumber: number | null;
  orgName: string;
  signals: Signals;
};

type Task = {
  title: string;
  detail: string;
  done: boolean;
  href: string;
  cta: string;
  adminOnly?: boolean;
};

function buildTasks(data: Data, orgId: string): Task[] {
  const s = data.signals;
  const q = `?orgId=${orgId}`;
  return [
    {
      title: "Add team location",
      detail:
        s.hasLocation === true
          ? "City and state are on the team profile for sponsorships and partners."
          : "Owners/admins: add city and state so one-pagers know where you compete from.",
      done: s.hasLocation === true,
      href: `/team${q}`,
      cta: "Set location",
      adminOnly: true,
    },
    {
      title: "Invite your team",
      detail:
        s.members > 1
          ? `${s.members} members on board${s.pendingInvites ? `, ${s.pendingInvites} invite(s) pending` : ""}.`
          : "Invite mentors and students by their exact email.",
      done: s.members > 1,
      href: `/team${q}`,
      cta: "Invite members",
      adminOnly: true,
    },
    {
      title: "Join a subteam calendar",
      detail: s.joinedSubteam
        ? "You're on at least one subteam — practices and build sessions will show up."
        : "Pick mechanical, software, or your build crew so the right calendar events appear.",
      done: s.joinedSubteam,
      href: `/team/calendar${q}`,
      cta: "Open calendar",
    },
    {
      title: "Write your Team Knowledge",
      detail:
        s.knowledgeChars > 0
          ? `${s.knowledgeChars.toLocaleString()} characters — the AI reads this on every team chat.`
          : "Add robot, strategy, and conventions so the AI knows your team from turn one.",
      done: s.knowledgeChars > 100,
      href: `/team/knowledge${q}`,
      cta: "Edit knowledge",
    },
    {
      title: "Check event logistics",
      detail:
        s.logisticsTrips > 0
          ? `${s.logisticsTrips} trip(s) on file — lodging, travel notes, day-of lists.`
          : "Mentors add hotels and travel checklists here before competition.",
      done: s.logisticsTrips > 0,
      href: `/logistics${q}`,
      cta: "Open logistics",
    },
    {
      title: "Open kickoff summary",
      detail:
        s.kickoffActions > 0
          ? `${s.kickoffActions} scoring action(s) captured — keep priorities current.`
          : "Structure the game: scoring value, design priorities, CAD brief handoff.",
      done: s.kickoffActions > 0,
      href: `/kickoff${q}`,
      cta: "Open kickoff",
    },
    {
      title: "Try the assistant",
      detail:
        s.assistantRuns > 0
          ? `${s.assistantRuns} assistant run(s) so far.`
          : "Ask it something real: draft an auto strategy or what should we scout.",
      done: s.assistantRuns > 0,
      href: `/chat${q}`,
      cta: "Open assistant",
    },
    {
      title: "Add the team's keys",
      detail:
        s.byokKeysConfigured == null
          ? "An owner can paste the team's own keys, or a local relay, so Ask AI can run."
          : s.byokKeysConfigured
            ? "At least one encrypted provider key or custom relay is on file."
            : "Paste OpenAI, Anthropic, or Google under AI keys — or use a local relay.",
      done: s.byokKeysConfigured === true,
      href: `/team/ai-keys${q}`,
      cta: "Add the team's keys",
      adminOnly: true,
    },
    {
      title: "Set AI budgets",
      detail:
        s.budgetsConfigured == null
          ? "An admin sets hard spend and token limits before anything runs up a bill."
          : s.budgetsConfigured
            ? "Budget controls are configured."
            : "Set hard spend/token limits so AI never surprises you.",
      done: s.budgetsConfigured === true,
      href: `/team/budgets${q}`,
      cta: "Set budgets",
      adminOnly: true,
    },
    {
      title: "Start your alumni network",
      detail:
        s.alumni > 0
          ? `${s.alumni} alum(s) in the network.`
          : "Keep grads connected — add alumni and connect your Discord.",
      done: s.alumni > 0,
      href: `/team/alumni${q}`,
      cta: "Add alumni",
    },
    {
      title: "Connect Discord",
      detail:
        s.discordConnected == null
          ? "An admin can link your Discord to broadcast alumni-network announcements."
          : s.discordConnected
            ? "Discord is connected."
            : "Link a channel webhook to post announcements to your server.",
      done: s.discordConnected === true,
      href: `/team/alumni${q}`,
      cta: "Connect Discord",
      adminOnly: true,
    },
  ];
}

type GettingStartedView = Data & { status: "ready"; orgId: string };

function isGettingStartedView(value: unknown): value is GettingStartedView {
  if (!value || typeof value !== "object") return false;
  const row = value as { status?: unknown; orgId?: unknown; orgName?: unknown; signals?: unknown };
  return (
    row.status === "ready" &&
    typeof row.orgId === "string" &&
    typeof row.orgName === "string" &&
    row.signals != null &&
    typeof row.signals === "object"
  );
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

async function persistGettingStartedSnapshot(orgHint: string, data: GettingStartedView): Promise<void> {
  const cacheOrg = data.orgId.trim() || orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("getting-started", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("getting-started", "_", data);
  } catch {
    // Live Team setup already painted; IndexedDB is best-effort.
  }
}

function GettingStartedRelated({ orgId }: { orgId: string }) {
  return (
    <nav className="product-hub-related" aria-label="Related team tools">
      <Button as="a" variant="secondary" href={withOrgHref("/start", orgId)}>
        Your path
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/team/knowledge", orgId)}>
        Playbook
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/team/calendar", orgId)}>
        Calendar
      </Button>
    </nav>
  );
}

function GettingStartedNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "path",
      label: "Open Your path",
      detail: "Personal first-week steps for your role, not the whole team.",
      href: withOrgHref("/start", orgId),
      primary: true,
    },
    {
      id: "playbook",
      label: "Open Playbook",
      detail: "Team Knowledge is what Ask AI reads on every chat.",
      href: withOrgHref("/team/knowledge", orgId),
    },
    {
      id: "background",
      label: "Open Team background",
      detail: "Mission, location, and funding facts used by grants and sponsor drafts.",
      href: withOrgHref("/team/background", orgId),
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

export default function GettingStartedClient({ orgId }: { orgId: string }) {
  const [view, setView] = useState<GettingStartedView | null>(null);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<GettingStartedView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<GettingStartedView>("getting-started", orgId || "_");
      if (!viewRef.current && cached?.data && isGettingStartedView(cached.data)) {
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
      const response = await fetch(`/api/team/getting-started?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(responseError(body) || "Unable to load getting-started");
        return;
      }
      if (!response.ok || !body || typeof body !== "object") {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Team setup. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setMessage(responseError(body) || "Unable to load getting-started");
        return;
      }
      const data = body as Data;
      const next: GettingStartedView = { status: "ready", orgId, ...data };
      setView(next);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistGettingStartedSnapshot(orgId, next);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Team setup. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tasks = view ? buildTasks(view, orgId).filter((t) => view.isAdmin || !t.adminOnly) : [];
  const done = tasks.filter((t) => t.done).length;
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;

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
    <main className="module-page start-page getting-started-page">
      <PageHeader
        navPath="/team/getting-started"
        title={view ? `Team setup · ${view.orgName}` : "Team setup"}
        description="Team setup checklist — invites, knowledge, and budgets. For your personal role path, open Your path."
      >
        <GettingStartedRelated orgId={orgId} />
      </PageHeader>

      <TeamOpsNav orgId={orgId} />
      <OfflineBanner feature="Team setup" fromCache={fromCache} cachedAt={cachedAt} />

      {message ? (
        <p className="start-warn" role="status">
          {message}
        </p>
      ) : null}

      {!view ? (
        <EmptyState
          soft
          title={failure ? failure.title : "Opening Team setup"}
          description={failure ? failure.description : "Checking this team's setup."}
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
          <section className="start-progress" aria-label="Setup progress">
            <strong>
              {done}/{tasks.length} done · {pct}%
            </strong>
            <div className="start-progress-bar">
              <span style={{ width: `${pct}%` }} />
            </div>
          </section>

          <ul className="start-checks">
            {tasks.map((task) => (
              <li key={task.title} className={`start-check${task.done ? " done" : ""}`}>
                <span aria-hidden="true">{task.done ? "✓" : "○"}</span>
                <div>
                  <strong>{task.title}</strong>
                  <span>{task.detail}</span>
                </div>
                <a href={task.href}>{task.done ? "Review" : task.cta}</a>
              </li>
            ))}
          </ul>

          <section className="start-empty">
            <p>
              <strong>Getting great answers from the AI</strong> — 1 · Give it context (Team Knowledge does
              this). 2 · Say what you want to do. 3 · Describe the result you expect.
            </p>
          </section>
          <GettingStartedNextActions orgId={orgId} />
        </>
      )}
    </main>
  );
}
