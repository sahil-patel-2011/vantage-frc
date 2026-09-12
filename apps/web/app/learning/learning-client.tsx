"use client";
// /learning — the "Call Your Shot" home page.
//
// Mentors (owner/admin) get the foreman view: per-member per-surface rollups
// with the ONE documented flag rule, the org call feed, and an honest
// "learning mode is off for N students" note. Students get exactly their own
// calls and trends — never another student's. Nothing rendered here is scored
// below its stated minimum sample, and nothing is shown to a mentor that the
// student cannot see about themselves.

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { learningSurfaceLabel, LEARNING_SURFACES } from "../../lib/learning/learning-mode";
import type { MemberRollup, SurfaceRollup } from "../../lib/learning/mentor-view";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import type { LearningFeedRow, LearningOverview } from "../api/learning/mentor/route";

type ReadyView = Extract<LearningOverview, { status: "ready" }>;

const SURFACE_ROUTES: Record<string, string> = {
  gearbox: "/gearbox",
  power_budget: "/power-budget",
  shooter_table: "/shooter-table",
};

function isLearningOverview(value: unknown): value is LearningOverview {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function learningCacheOrg(data: LearningOverview, orgHint: string): string {
  if (data.status === "ready" && data.context.orgId.trim()) return data.context.orgId;
  return orgHint;
}

async function persistLearningSnapshot(orgHint: string, data: LearningOverview): Promise<void> {
  const cacheOrg = learningCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("learning", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("learning", "_", data);
  } catch {
    // Live Learning already painted; IndexedDB is best-effort.
  }
}

function formatWhen(createdAt: string): string {
  const parsed = new Date(createdAt.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return createdAt.slice(0, 16);
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function closenessLabel(row: LearningFeedRow): string {
  if (row.skipped) return "skipped";
  return row.closeness ?? "—";
}

function statusBadge(rollup: SurfaceRollup) {
  if (rollup.status === "needs_mentor") return <span className="app-badge setup">Needs a mentor</span>;
  if (rollup.status === "calibrating") return <span className="app-badge good">Calibrating</span>;
  return <span className="app-badge">Not enough calls yet</span>;
}

export default function LearningClient() {
  const [view, setView] = useState<LearningOverview | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const viewRef = useRef<LearningOverview | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<LearningOverview>("learning", orgHint || "_");
      if (!viewRef.current && cached?.data && isLearningOverview(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setRefreshError("");
    try {
      const query = orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : "";
      const response = await fetch(`/api/learning/mentor${query}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        return;
      }
      if (!response.ok || !isLearningOverview(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setRefreshError("Could not refresh Learning. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistLearningSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setRefreshError("Could not refresh Learning. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const orgId = view && view.status === "ready" ? view.context.orgId : null;

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Learning"}
          </>
        }
        title="Learning — Call Your Shot"
        description="Every call a member commits on Gearbox, Power budget, and Shooter table lands here. Mentors see who is calibrating and who needs a hand; each member sees their own record. Nothing is scored below four graded calls."
      />
      <nav className="intel-actions" aria-label="Related calculators">
        <a href="/gearbox">Gearbox</a>
        <a href="/power-budget">Power budget</a>
        <a href="/shooter-table">Shooter table</a>
      </nav>
      <OfflineBanner feature="Learning" fromCache={fromCache} cachedAt={cachedAt} />
      {refreshError ? (
        <p className="telemetry-status" role="alert">
          {refreshError}
        </p>
      ) : null}

      {!view ? (
        fetchFailed ? (
        <EmptyState
          title="Could not load learning activity"
          description="A network or server issue prevented loading. Try again."
        >
          <Button variant="secondary" type="button" onClick={() => void load()}>
            Retry
          </Button>
        </EmptyState>
        ) : (
        <EmptyState title="Opening Learning" description="Checking your team." aria-busy />
        )
      ) : view.status === "setup_required" ? (
        <EmptyState
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description={
            view.message ||
            "Join a team to record Call Your Shot activity. Calls from Gearbox, Power budget, and Shooter table land here once you belong to a team."
          }
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      ) : (
        <ReadyBody view={view} />
      )}
    </main>
  );
}

function ReadyBody({ view }: { view: ReadyView }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <MySection view={view} />
      {view.org ? <ForemanSection view={view} /> : null}
    </div>
  );
}

// ---- the viewer's own record (every tier) ---------------------------------

function MySection({ view }: { view: ReadyView }) {
  const { mine } = view;
  const hasCalls = mine.rollup != null;

  return (
    <Panel style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Your calls</h2>
      {!hasCalls ? (
        <EmptyState
          badge="No calls yet"
          badgeTone="setup"
          title="You have not called a shot yet"
          description="Open a calculator with learning mode on, call the answer before the reveal, and your record starts here. Skipping is fine and is logged, not blocked."
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {LEARNING_SURFACES.map((surface) => (
              <Button as="a" variant="secondary" key={surface} href={SURFACE_ROUTES[surface]}>
                {learningSurfaceLabel(surface)}
              </Button>
            ))}
          </div>
        </EmptyState>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {mine.trends
              .filter((t) => t.trend.total > 0)
              .map((t) => (
                <div key={t.surface}>
                  <strong>{t.surfaceLabel}</strong>
                  <p className="app-muted" style={{ margin: "4px 0 0" }}>
                    {t.trend.headline}
                  </p>
                </div>
              ))}
          </div>
          {mine.rollup ? <SurfaceRollupList surfaces={mine.rollup.surfaces} /> : null}
          <RecentCalls rows={mine.recent} showWho={false} title="Your recent calls" />
        </>
      )}
    </Panel>
  );
}

// ---- the mentor foreman view ----------------------------------------------

function ForemanSection({ view }: { view: ReadyView }) {
  const org = view.org;
  if (!org) return null;
  const { modeNote } = org;

  return (
    <>
      <Panel style={{ display: "grid", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Team learning mode</h2>
        {modeNote.students === 0 ? (
          <p className="app-muted" style={{ margin: 0 }}>
            No student-tier members yet — invite scouts or viewers and their calculators start teaching.
          </p>
        ) : modeNote.sentence ? (
          <>
            <p style={{ margin: 0 }}>{modeNote.sentence}</p>
            {modeNote.offNames.length > 0 ? (
              <p className="app-muted" style={{ margin: 0 }}>
                Off for: {modeNote.offNames.join(", ")}
              </p>
            ) : null}
          </>
        ) : (
          <p className="app-muted" style={{ margin: 0 }}>
            Learning mode is on (by default or by choice) for all {modeNote.students} student
            {modeNote.students === 1 ? "" : "s"}. Per-surface overrides and device-only choices from before
            preferences were persisted may still differ.
          </p>
        )}
      </Panel>

      <Panel style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Member rollup</h2>
          <small className="app-muted">{org.windowNote}</small>
        </div>
        {org.members.length === 0 ? (
          <EmptyState
            badge="No calls yet"
            badgeTone="setup"
            title="Nobody has called a shot yet"
            description="When members commit calls on the gearbox, power-budget or shooter-table calculators, this rollup shows who is calibrating and who could use a mentor. Until then there is nothing to score."
          />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 16 }}>
            {org.members.map((member) => (
              <MemberCard key={member.userId} member={member} />
            ))}
          </ul>
        )}
      </Panel>

      {org.feed.length > 0 ? (
        <Panel style={{ display: "grid", gap: 8 }}>
          <RecentCalls rows={org.feed} showWho title="Recent calls across the team" />
        </Panel>
      ) : null}
    </>
  );
}

function MemberCard({ member }: { member: MemberRollup }) {
  return (
    <li style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <strong>{member.userName}</strong>
        {member.needsMentor ? <span className="app-badge setup">Needs a mentor</span> : null}
        <small className="app-muted">
          {member.totalCalls} call{member.totalCalls === 1 ? "" : "s"}
          {member.totalSkipped > 0 ? ` · ${member.totalSkipped} skipped` : ""}
          {member.lastCalledAt ? ` · last ${formatWhen(member.lastCalledAt)}` : ""}
        </small>
      </div>
      <SurfaceRollupList surfaces={member.surfaces} />
    </li>
  );
}

function SurfaceRollupList({ surfaces }: { surfaces: SurfaceRollup[] }) {
  if (surfaces.length === 0) return null;
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
      {surfaces.map((rollup) => (
        <li key={rollup.surface} style={{ display: "grid", gap: 2 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>{rollup.surfaceLabel}</span>
            {statusBadge(rollup)}
            <small className="app-muted">
              {rollup.scored} graded
              {rollup.skipped > 0 ? ` · ${rollup.skipped} skipped` : ""}
            </small>
          </div>
          <small className="app-muted">{rollup.note}</small>
        </li>
      ))}
    </ul>
  );
}

function RecentCalls({ rows, showWho, title }: { rows: LearningFeedRow[]; showWho: boolean; title: string }) {
  if (rows.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <h3 style={{ margin: 0 }}>{title}</h3>
      <div style={{ overflowX: "auto" }}>
        <table className="factor-table" style={{ width: "100%" }}>
          <thead>
            <tr>
              {showWho ? <th style={{ textAlign: "left" }}>Member</th> : null}
              <th style={{ textAlign: "left" }}>Surface</th>
              <th style={{ textAlign: "left" }}>Result</th>
              <th style={{ textAlign: "left" }}>When</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {showWho ? <td>{row.userName?.trim() || "Unnamed member"}</td> : null}
                <td>{row.surfaceLabel}</td>
                <td>
                  {row.skipped ? (
                    <span className="app-badge">skipped</span>
                  ) : row.closeness === "spot-on" ? (
                    <span className="app-badge good">spot on</span>
                  ) : row.closeness === "close" ? (
                    <span className="app-badge demo">close</span>
                  ) : (
                    <span className="app-badge setup">{closenessLabel(row)}</span>
                  )}
                </td>
                <td>{formatWhen(row.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
