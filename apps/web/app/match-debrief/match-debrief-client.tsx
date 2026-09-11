"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { AIAttribution, Button, EmptyState, PageHeader } from "../../components/ui";
import {
  AI_EXPAND_IDLE,
  expandedDisplay,
  expandFailureState,
  expandSuccessState,
  type AiExpandState,
} from "../../lib/ai-expand";
import { MATCH_RESULTS, type Alliance, type MatchResult } from "../../lib/match-debrief";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type Debrief = {
  id: string; seasonYear: number; eventKey: string; matchLabel: string; alliance: Alliance; result: MatchResult;
  pointsScored: number | null; cycleCount: number | null; drivetrainOk: boolean; mechanismsOk: boolean; autoOk: boolean;
  whatWorked: string; whatBroke: string; actionItems: string; byName: string | null; createdAt: string;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string }; seasonYear: number; debriefs: Debrief[]; summary: { total: number; wins: number; losses: number; ties: number; record: string; avgPoints: number | null; openActionItems: number }; takeaways: string };

const RESULT_LABEL: Record<MatchResult, string> = { win: "Win", loss: "Loss", tie: "Tie", unknown: "—" };
const EMPTY = { matchLabel: "", eventKey: "", alliance: "unknown", result: "unknown", pointsScored: "", cycleCount: "", drivetrainOk: true, mechanismsOk: true, autoOk: true, whatWorked: "", whatBroke: "", actionItems: "" };

function isMatchDebriefView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function MatchDebriefRelated({ orgId }: { orgId?: string | null }) {
  const links = [
    { id: "scouting", label: "Scouting", href: withOrgHref("/scouting", orgId) },
    { id: "repairs", label: "Repairs", href: withOrgHref("/repairs", orgId) },
    { id: "command", label: "Event day", href: withOrgHref("/command", orgId) },
  ];
  return (
    <nav className="product-hub-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function matchDebriefCacheOrg(data: View, orgHint: string): string {
  if (data.status === "ready" && data.context.orgId.trim()) return data.context.orgId;
  return orgHint;
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

export default function MatchDebriefClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a dead-end error line.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [form, setForm] = useState<typeof EMPTY>({ ...EMPTY });
  // Optional metered AI coach over the computed takeaways; the computed text
  // always renders and a missing model degrades to it with a setup note.
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
    setErrorStatus(null);
    try {
      const response = await fetch(
        `/api/match-debrief?seasonYear=${seasonYear}${orgHint ? `&orgId=${encodeURIComponent(orgHint)}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      );
      const data = (await response.json()) as View & { error?: string };
      if (!response.ok || !isMatchDebriefView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Match debrief. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setMessage("error" in data && data.error ? data.error : "Failed to load match log");
          setErrorStatus(response.status);
          setFetchFailed(true);
        }
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistMatchDebriefSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Match debrief. Showing the last copy on this device.");
        setFetchFailed(false);
      } else {
        setFetchFailed(true);
      }
    }
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    try {
      const response = await fetch("/api/match-debrief", {
        method: "POST", headers: { "content-type": "application/json" },
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

  if (!view) {
    const failure = fetchFailed
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
      <main className="intel-app">
        <PageHeader
          breadcrumbs={
            <>
              <a href={withOrgHref("/competition", orgId)}>Competition</a>
              {" / Match debrief"}
            </>
          }
          title="Match debrief"
          description="Log how our robot performed each match — separate from scouting other teams."
        >
          <MatchDebriefRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Match debrief" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading match log…"}
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
  if (view.status === "setup_required") {
    return (
      <main className="intel-app">
        <PageHeader
          breadcrumbs={
            <>
              <a href={withOrgHref("/competition", orgId)}>Competition</a>
              {" / Match debrief"}
            </>
          }
          title="Match debrief"
          description="Log how our robot performed each match — separate from scouting other teams."
        >
          <MatchDebriefRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Match debrief" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState badge="Needs setup" badgeTone="setup" soft title="Choose your team" description={view.message}>
          <Button as="a" variant="primary" href="/workspace">Choose your team</Button>
        </EmptyState>
      </main>
    );
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

  return (
    <main className="intel-app">
        <PageHeader
          breadcrumbs={
            <>
              <a href={withOrgHref("/competition", orgId)}>Competition</a>
              {" / Match debrief"}
            </>
          }
          title={`Our match debrief — ${seasonYear}`}
          description="Log how our robot performed each match — separate from scouting other teams."
        >
          <MatchDebriefRelated orgId={orgId} />
        </PageHeader>
      <OfflineBanner feature="Match debrief" fromCache={fromCache} cachedAt={cachedAt} />
      {message && <p className="telemetry-status">{message}</p>}
      <p className="telemetry-status">Log how <strong>our</strong> robot performed each match — separate from scouting other teams. Patterns here tell you what to fix before the next match.</p>

      <section className="metric-grid">
        <article><span>Record (W-L-T)</span><strong>{view.summary.record}</strong></article>
        <article><span>Matches logged</span><strong>{view.summary.total}</strong></article>
        <article><span>Avg points</span><strong>{view.summary.avgPoints ?? "—"}</strong></article>
        <article><span>Matches with action items</span><strong>{view.summary.openActionItems}</strong></article>
      </section>

      <section className="intel-panel" aria-label="Between-matches takeaways">
        <span className="eyebrow">TAKEAWAYS</span>
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
            {takeawaysDisplay.note ? <small>{takeawaysDisplay.note}</small> : null}
          </div>
        )}
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addDebrief}>
          <span className="eyebrow">LOG A MATCH</span>
          <div className="budget-fields">
            <label>Match<input required value={form.matchLabel} onChange={(e) => setForm({ ...form, matchLabel: e.target.value })} placeholder="Qual 12" /></label>
            <label>Result<select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value as MatchResult })}>{MATCH_RESULTS.map((r) => <option key={r} value={r}>{RESULT_LABEL[r]}</option>)}</select></label>
          </div>
          <div className="budget-fields">
            <label>Points scored<input type="number" min="0" value={form.pointsScored} onChange={(e) => setForm({ ...form, pointsScored: e.target.value })} /></label>
            <label>Cycles<input type="number" min="0" value={form.cycleCount} onChange={(e) => setForm({ ...form, cycleCount: e.target.value })} /></label>
          </div>
          <div className="budget-fields">
            <label className="check-field"><input type="checkbox" checked={form.drivetrainOk} onChange={(e) => setForm({ ...form, drivetrainOk: e.target.checked })} /> Drivetrain OK</label>
            <label className="check-field"><input type="checkbox" checked={form.mechanismsOk} onChange={(e) => setForm({ ...form, mechanismsOk: e.target.checked })} /> Mechanisms OK</label>
            <label className="check-field"><input type="checkbox" checked={form.autoOk} onChange={(e) => setForm({ ...form, autoOk: e.target.checked })} /> Auto OK</label>
          </div>
          <label>What worked<input value={form.whatWorked} onChange={(e) => setForm({ ...form, whatWorked: e.target.value })} /></label>
          <label>What broke<input value={form.whatBroke} onChange={(e) => setForm({ ...form, whatBroke: e.target.value })} /></label>
          <label>Action items before next match<input value={form.actionItems} onChange={(e) => setForm({ ...form, actionItems: e.target.value })} /></label>
          <Button type="submit" variant="primary">Save debrief</Button>
        </form>
        <section className="intel-panel">
          <span className="eyebrow">OPEN ACTION ITEMS</span>
          {view.debriefs.filter((d) => d.actionItems.trim()).length === 0 && <p>No outstanding action items.</p>}
          {view.debriefs.filter((d) => d.actionItems.trim()).map((d) => (
            <article key={d.id}><div><strong>{d.matchLabel}</strong><small>{d.actionItems}</small></div></article>
          ))}
        </section>
      </section>

      <section className="intel-panel invite-list">
        <span className="eyebrow">MATCH LOG</span>
        {view.debriefs.length === 0 && <p>No matches logged yet.</p>}
        {view.debriefs.map((d) => (
          <article key={d.id}>
            <div style={{ flex: 1 }}>
              <strong>{d.matchLabel} · {RESULT_LABEL[d.result]}{d.pointsScored != null ? ` · ${d.pointsScored} pts` : ""}</strong>
              <small>
                {d.cycleCount != null ? `${d.cycleCount} cycles` : "cycles n/a"}
                {flag(d.drivetrainOk, "drivetrain")}{flag(d.mechanismsOk, "mechanism")}{flag(d.autoOk, "auto")}
                {d.byName ? ` · ${d.byName}` : ""}
              </small>
              {d.whatWorked && <small>✓ {d.whatWorked}</small>}
              {d.whatBroke && <small>✗ {d.whatBroke}</small>}
            </div>
            {view.context.role !== "viewer" && <button onClick={() => void post({ action: "delete_debrief", id: d.id }, "Debrief deleted.")}>Delete</button>}
          </article>
        ))}
      </section>
    </main>
  );
}
