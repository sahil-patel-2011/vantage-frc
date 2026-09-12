"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { RECOGNITION_STAGE_LABEL, SUGGESTED_AWARDS, type RecognitionStage } from "../../lib/recognition";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type RankedNomination = { id: string; nomineeName: string; reason: string; voteCount: number };
type Award = {
  id: string;
  seasonYear: number;
  name: string;
  description: string;
  stage: RecognitionStage;
  byName: string | null;
  ranked: RankedNomination[];
  totalVotes: number;
  winnerId: string | null;
  myVote: string | null;
};
type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string; canManage: boolean };
      seasonYear: number;
      awards: Award[];
    };

const NEXT_STAGE: Record<RecognitionStage, RecognitionStage | null> = {
  nominating: "voting",
  voting: "closed",
  closed: null,
};

function isRecognitionView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function recognitionCacheOrg(data: View, orgHint: string): string {
  if (data.status === "ready" && data.context.orgId.trim()) return data.context.orgId;
  return orgHint;
}

async function persistRecognitionSnapshot(
  orgHint: string,
  seasonHint: string,
  data: View,
): Promise<void> {
  const cacheOrg = recognitionCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = data.status === "ready" ? String(data.seasonYear) : seasonHint;
  try {
    await putFeatureSnapshot("recognition", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("recognition", "_", data, seasonHint || seasonKey);
  } catch {
    // Live recognition already painted; IndexedDB is best-effort.
  }
}

export default function RecognitionClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [awardName, setAwardName] = useState("");
  const [nomineeInputs, setNomineeInputs] = useState<Record<string, string>>({});
  const [fetchFailed, setFetchFailed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgId?.trim() ?? "";
    const seasonHint = String(seasonYear);
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("recognition", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isRecognitionView(cached.data)) {
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
        `/api/recognition?seasonYear=${seasonYear}${orgHint ? `&orgId=${encodeURIComponent(orgHint)}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      );
      const data = (await response.json()) as View & { error?: string };
      if (!response.ok || !isRecognitionView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Recognition. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setMessage("error" in data && data.error ? data.error : "Failed to load team awards");
          setErrorStatus(response.status);
          setFetchFailed(true);
        }
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistRecognitionSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Recognition. Showing the last copy on this device.");
        setFetchFailed(false);
      } else {
        setFetchFailed(true);
      }
    }
  }, [orgId, seasonYear]);
  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    try {
      const response = await fetch("/api/recognition", {
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

  async function createAward(name: string) {
    if (!name.trim()) return;
    await post({ action: "create_award", seasonYear, name }, "Award created.");
    setAwardName("");
  }

  async function nominate(awardId: string) {
    const name = (nomineeInputs[awardId] ?? "").trim();
    if (!name) return;
    await post({ action: "add_nomination", awardId, nomineeName: name }, "Nomination added.");
    setNomineeInputs((prev) => ({ ...prev, [awardId]: "" }));
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
      <main className="module-page">
        <PageHeader
          navPath="/recognition"
          title="Recognition"
          description="Nominate teammates for your team's own end-of-season awards, then vote."
        />
        <OfflineBanner feature="Recognition" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Opening Recognition"}
          description={failure ? failure.description : undefined}
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

  if (view.status === "setup_required") {
    return (
      <main className="module-page">
        <PageHeader
          navPath="/recognition"
          title="Recognition"
          description="Nominate teammates for your team's own end-of-season awards, then vote."
        />
        <OfflineBanner feature="Recognition" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description={view.message}
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }

  const canManage = view.context.canManage;

  return (
    <main className="module-page">
      <PageHeader
        navPath="/recognition"
        title="Recognition"
        description={`Nominate teammates, then vote — one ballot each · ${seasonYear}. These are your team's own end-of-season awards, separate from the FIRST competition awards.`}
      >
        <nav className="visit-inline-actions" aria-label="Related">
          <Button as="a" variant="secondary" href={`/team/awards${orgId ? `?orgId=${orgId}` : ""}`}>
            FIRST awards
          </Button>
          <Button as="a" variant="secondary" href="/workspace">
            Your team
          </Button>
        </nav>
      </PageHeader>
      <OfflineBanner feature="Recognition" fromCache={fromCache} cachedAt={cachedAt} />
      {message ? <p className="telemetry-status" role="status">{message}</p> : null}

      {canManage ? (
        <section className="app-card soft-panel">
          <span className="app-badge">Create an award</span>
          <h2>Owner / admin</h2>
          <div className="budget-fields">
            <label>
              Award name
              <input
                value={awardName}
                onChange={(e) => setAwardName(e.target.value)}
                placeholder="Most Valuable Player"
              />
            </label>
            <Button variant="primary" type="button" onClick={() => void createAward(awardName)}>
              Create
            </Button>
          </div>
          <p>
            <small>
              Quick add:{" "}
              {SUGGESTED_AWARDS.map((s) => (
                <a
                  key={s}
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    void createAward(s);
                  }}
                  style={{ marginRight: 10 }}
                >
                  {s}
                </a>
              ))}
            </small>
          </p>
        </section>
      ) : null}

      {view.awards.length === 0 ? (
        <EmptyState
          soft
          title="No team awards yet"
          description={canManage ? "Create one above to start nominations." : "No team awards have been set up yet."}
        />
      ) : null}

      {view.awards.map((award) => (
        <section className="app-card soft-panel" key={award.id}>
          <span className="app-badge">
            {RECOGNITION_STAGE_LABEL[award.stage]}
            {award.stage === "voting" ? ` · ${award.totalVotes} votes` : ""}
          </span>
          <h2>{award.name}</h2>
          {award.description ? <p className="app-muted">{award.description}</p> : null}

          {award.ranked.length === 0 ? <p className="app-muted">No nominations yet.</p> : null}
          {award.ranked.map((nom) => (
            <article key={nom.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ flex: 1 }}>
                <strong>
                  {nom.nomineeName}
                  {award.winnerId === nom.id ? " — winner" : ""}
                </strong>
                <div className="app-muted">
                  {award.stage !== "nominating"
                    ? `${nom.voteCount} vote${nom.voteCount === 1 ? "" : "s"}`
                    : "nominated"}
                  {nom.reason ? ` · ${nom.reason}` : ""}
                </div>
              </div>
              {award.stage === "voting" ? (
                <Button variant="secondary" type="button" onClick={() => void post({ action: "cast_vote", awardId: award.id, nominationId: nom.id }, "Vote recorded.") } disabled={award.myVote === nom.id}>
                  {award.myVote === nom.id ? "Your vote" : "Vote"}
                </Button>
              ) : null}
            </article>
          ))}

          {award.stage === "nominating" ? (
            <div className="budget-fields" style={{ marginTop: 12 }}>
              <label>
                Nominate someone
                <input
                  value={nomineeInputs[award.id] ?? ""}
                  onChange={(e) => setNomineeInputs((prev) => ({ ...prev, [award.id]: e.target.value }))}
                  placeholder="Teammate name"
                />
              </label>
              <Button variant="primary" type="button" onClick={() => void nominate(award.id)}>
                Nominate
              </Button>
            </div>
          ) : null}

          {canManage ? (
            <p style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {NEXT_STAGE[award.stage] ? (
                <Button variant="secondary" type="button" onClick={() => void post( { action: "set_stage", id: award.id, stage: NEXT_STAGE[award.stage] }, `Moved to ${NEXT_STAGE[award.stage]}.`, ) }>
                  Advance to {RECOGNITION_STAGE_LABEL[NEXT_STAGE[award.stage]!]}
                </Button>
              ) : null}
              <Button variant="secondary" type="button" onClick={() => void post({ action: "delete_award", id: award.id }, "Award deleted.")}>
                Delete
              </Button>
            </p>
          ) : null}
        </section>
      ))}
    </main>
  );
}
