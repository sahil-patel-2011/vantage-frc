"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { AIAttribution, Button, EmptyState, FormGrid, FormRow, PageHeader, Panel, StatTile } from "../../components/ui";
import {
  AI_EXPAND_IDLE,
  expandedDisplay,
  expandFailureState,
  expandSuccessState,
  type AiExpandState,
} from "../../lib/ai-expand";
import { MATCH_RESULTS, type Alliance, type MatchResult } from "../../lib/match-debrief";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Debrief = {
  id: string;
  seasonYear: number;
  eventKey: string;
  matchLabel: string;
  alliance: Alliance;
  result: MatchResult;
  pointsScored: number | null;
  cycleCount: number | null;
  drivetrainOk: boolean;
  mechanismsOk: boolean;
  autoOk: boolean;
  whatWorked: string;
  whatBroke: string;
  actionItems: string;
  byName: string | null;
  createdAt: string;
};
type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string };
      seasonYear: number;
      debriefs: Debrief[];
      summary: {
        total: number;
        wins: number;
        losses: number;
        ties: number;
        record: string;
        avgPoints: number | null;
        openActionItems: number;
      };
      takeaways: string;
    };

const RESULT_LABEL: Record<MatchResult, string> = { win: "Win", loss: "Loss", tie: "Tie", unknown: "—" };
const EMPTY = {
  matchLabel: "",
  eventKey: "",
  alliance: "unknown" as Alliance,
  result: "unknown" as MatchResult,
  pointsScored: "",
  cycleCount: "",
  drivetrainOk: true,
  mechanismsOk: true,
  autoOk: true,
  whatWorked: "",
  whatBroke: "",
  actionItems: "",
};

function isMatchDebriefView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function matchDebriefCacheOrg(data: View, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return orgHint;
    case "ready":
      return data.context.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistMatchDebriefSnapshot(
  orgHint: string,
  seasonHint: string,
  data: View,
): Promise<void> {
  const cacheOrg = matchDebriefCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("match-debrief", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("match-debrief", "_", data, seasonHint || seasonKey);
  } catch {
    // Live match debrief already painted; IndexedDB is best-effort.
  }
}

function MatchDebriefRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related match tools">
      <Button as="a" variant="secondary" href={hubHref("/competition", "scouting", orgId)}>
        Scouting
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/competition", "pit-repair-triage", orgId)}>
        Repair triage
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/competition", "match-notes-timeline", orgId)}>
        Match notes
      </Button>
    </nav>
  );
}

function MatchDebriefNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "log",
      label: "Log this match",
      detail: "Result, what worked, and what broke — before the next queue.",
      href: "#match-debrief-form",
      primary: true,
    },
    {
      id: "notes",
      label: "Open Match notes",
      detail: "Timeline of field notes sits next to this log.",
      href: hubHref("/competition", "match-notes-timeline", orgId),
      primary: false,
    },
    {
      id: "repair",
      label: "Open Repair triage",
      detail: "What broke here should match the pit board.",
      href: hubHref("/competition", "pit-repair-triage", orgId),
      primary: false,
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

export default function MatchDebriefClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [coach, setCoach] = useState<AiExpandState>(AI_EXPAND_IDLE);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    const seasonHint = String(seasonYear);
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("match-debrief", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isMatchDebriefView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setLoadError("");
    setErrorStatus(null);
    try {
      const response = await fetch(
        `/api/match-debrief?seasonYear=${seasonYear}${orgHint ? `&orgId=${encodeURIComponent(orgHint)}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isMatchDebriefView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Match debrief. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Failed to load match log",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setMessage("");
      await persistMatchDebriefSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Match debrief. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, [orgId, seasonYear]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    try {
      const response = await fetch("/api/match-debrief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: view.context.orgId, ...body }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = await response.json();
      setMessage(response.ok ? okMessage : data.error);
      if (response.ok) await load();
    } catch {
      setMessage("Network error — changes were not saved.");
    }
  }

  async function addDebrief(event: FormEvent) {
    event.preventDefault();
    await post({ action: "create_debrief", seasonYear, ...form }, "Match debrief saved.");
    if (view?.status === "ready") setForm({ ...EMPTY });
  }

  const competitionHref = orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition";

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs={
            <>
              <a href={competitionHref}>Competition</a>
              {" / Match debrief"}
            </>
          }
          title="Match debrief"
          description="How our robot performed each match — separate from scouting other teams."
        >
          <MatchDebriefRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Match debrief" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading match log…"}
          description={failure ? failure.description : "Checking your team."}
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
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          <PageHeader
            breadcrumbs={
              <>
                <a href={competitionHref}>Competition</a>
                {" / Match debrief"}
              </>
            }
            title="Match debrief"
            description="How our robot performed each match — separate from scouting other teams."
          >
            <MatchDebriefRelated orgId={orgId} />
          </PageHeader>
          <OfflineBanner feature="Match debrief" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState badge="Setup required" badgeTone="setup" title="Choose your team" description={view.message}>
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          </EmptyState>
        </main>
      );
    case "ready":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  const flag = (ok: boolean, label: string) => (ok ? "" : ` · ${label} issue`);

  const askCoach = async () => {
    if (view.status !== "ready") return;
    setCoach({ status: "loading" });
    try {
      const response = await fetch("/api/match-debrief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "coach", orgId: view.context.orgId, seasonYear }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setCoach(
          expandFailureState({
            httpStatus: response.status,
            code: typeof data.code === "string" ? data.code : null,
            error: typeof data.error === "string" ? data.error : null,
          }),
        );
        return;
      }
      setCoach(expandSuccessState(data));
    } catch {
      setCoach(expandFailureState({ httpStatus: 0, error: "network error" }));
    }
  };

  const takeawaysDisplay = expandedDisplay(view.takeaways ?? "", coach);
  const openItems = view.debriefs.filter((d) => d.actionItems.trim());

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match debrief"}
          </>
        }
        title={`Match debrief — ${seasonYear}`}
        description="How our robot performed each match — separate from scouting other teams."
      >
        <MatchDebriefRelated orgId={view.context.orgId} />
      </PageHeader>
      <OfflineBanner feature="Match debrief" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? (
        <p className="app-muted" role="status">
          {message}
        </p>
      ) : null}

      <DebriefIntro />

      <MatchDebriefNextActions orgId={view.context.orgId} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <StatTile label="Record (W-L-T)" value={view.summary.record} />
        <StatTile label="Matches logged" value={view.summary.total} />
        <StatTile label="Avg points" value={view.summary.avgPoints ?? "—"} />
        <StatTile label="Matches with action items" value={view.summary.openActionItems} />
      </div>

      <Panel aria-label="Between-matches takeaways">
        <h2>Takeaways</h2>
        <p style={{ margin: "6px 0 0" }}>{takeawaysDisplay.text}</p>
        <AIAttribution kind="computed" feature="match_debrief" generatedAt={new Date().toISOString()} />
        {coach.status === "ready" && takeawaysDisplay.aiText ? (
          <>
            <p style={{ margin: "6px 0 0" }}>{takeawaysDisplay.aiText}</p>
            <AIAttribution
              kind="ai"
              feature="match_debrief"
              generatedAt={coach.expansion.generatedAt}
              onRegenerate={() => void askCoach()}
            />
          </>
        ) : (
          <div style={{ display: "grid", gap: 6, justifyItems: "start", marginTop: 8 }}>
            <Button
              type="button"
              variant="primary"
              disabled={coach.status === "loading" || view.summary.total === 0}
              onClick={() => void askCoach()}
            >
              {coach.status === "loading" ? "Expanding…" : "Expand with AI"}
            </Button>
            {takeawaysDisplay.note ? <small className="app-muted">{takeawaysDisplay.note}</small> : null}
          </div>
        )}
      </Panel>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        <Panel as="form" id="match-debrief-form" onSubmit={addDebrief}>
          <h2>Log a match</h2>
          <FormGrid min={140}>
            <FormRow label="Match">
              <input
                required
                value={form.matchLabel}
                onChange={(e) => setForm({ ...form, matchLabel: e.target.value })}
                placeholder="Qual 12"
              />
            </FormRow>
            <FormRow label="Result">
              <select
                value={form.result}
                onChange={(e) => setForm({ ...form, result: e.target.value as MatchResult })}
              >
                {MATCH_RESULTS.map((r) => (
                  <option key={r} value={r}>
                    {RESULT_LABEL[r]}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Points scored">
              <input
                type="number"
                min="0"
                value={form.pointsScored}
                onChange={(e) => setForm({ ...form, pointsScored: e.target.value })}
              />
            </FormRow>
            <FormRow label="Cycles">
              <input
                type="number"
                min="0"
                value={form.cycleCount}
                onChange={(e) => setForm({ ...form, cycleCount: e.target.value })}
              />
            </FormRow>
          </FormGrid>
          <FormGrid min={140}>
            <label className="check-field">
              <input
                type="checkbox"
                checked={form.drivetrainOk}
                onChange={(e) => setForm({ ...form, drivetrainOk: e.target.checked })}
              />{" "}
              Drivetrain OK
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={form.mechanismsOk}
                onChange={(e) => setForm({ ...form, mechanismsOk: e.target.checked })}
              />{" "}
              Mechanisms OK
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={form.autoOk}
                onChange={(e) => setForm({ ...form, autoOk: e.target.checked })}
              />{" "}
              Auto OK
            </label>
          </FormGrid>
          <FormRow label="What worked">
            <input value={form.whatWorked} onChange={(e) => setForm({ ...form, whatWorked: e.target.value })} />
          </FormRow>
          <FormRow label="What broke">
            <input value={form.whatBroke} onChange={(e) => setForm({ ...form, whatBroke: e.target.value })} />
          </FormRow>
          <FormRow label="Action items before next match">
            <input value={form.actionItems} onChange={(e) => setForm({ ...form, actionItems: e.target.value })} />
          </FormRow>
          <Button variant="primary" type="submit">
            Save debrief
          </Button>
        </Panel>

        <Panel>
          <h2>Open action items</h2>
          {openItems.length === 0 ? <p className="app-muted">No outstanding action items.</p> : null}
          {openItems.map((d) => (
            <article key={d.id}>
              <strong>{d.matchLabel}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {d.actionItems}
              </small>
            </article>
          ))}
        </Panel>
      </div>

      <Panel>
        <h2>Match log</h2>
        {view.debriefs.length === 0 ? <p className="app-muted">No matches logged yet.</p> : null}
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {view.debriefs.map((d) => (
            <li
              key={d.id}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}
            >
              <div style={{ flex: 1 }}>
                <strong>
                  {d.matchLabel} · {RESULT_LABEL[d.result]}
                  {d.pointsScored != null ? ` · ${d.pointsScored} pts` : ""}
                </strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {d.cycleCount != null ? `${d.cycleCount} cycles` : "cycles n/a"}
                  {flag(d.drivetrainOk, "drivetrain")}
                  {flag(d.mechanismsOk, "mechanism")}
                  {flag(d.autoOk, "auto")}
                  {d.byName ? ` · ${d.byName}` : ""}
                </small>
                {d.whatWorked ? (
                  <small className="app-muted" style={{ display: "block" }}>
                    ✓ {d.whatWorked}
                  </small>
                ) : null}
                {d.whatBroke ? (
                  <small className="app-muted" style={{ display: "block" }}>
                    ✗ {d.whatBroke}
                  </small>
                ) : null}
              </div>
              {view.context.role !== "viewer" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={() => void post({ action: "delete_debrief", id: d.id }, "Debrief deleted.")}
                >
                  Delete
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  );
}

function DebriefIntro() {
  return (
    <p className="app-muted">
      Log how <strong>our</strong> robot performed each match — separate from scouting other teams. Patterns here tell
      you what to fix before the next match.
    </p>
  );
}
