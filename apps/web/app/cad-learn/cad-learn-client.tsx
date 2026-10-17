"use client";

import { staleCopyNotice, staleCopyProps } from "../../lib/ui/stale-copy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Skeleton, TextBlockSkeleton } from "../../components/ui";
import {
  CAD_COMMUNITY_LINKS,
  CAD_REFERENCE,
  CAD_TRACK,
  allLessons,
  totalCadMinutes,
} from "../../lib/cad-learn/track";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import {
  clearFeatureSnapshot,
  getFeatureSnapshot,
  putFeatureSnapshot,
} from "../../lib/offline/feature-cache";
import { classifyCadLearnShell, type CadLearnShellKind } from "../../lib/cad-learn/cad-learn-related";
import "../cad/cad-setup.css";
import { CadLearnEmptyCard, CadLearnHeader, CadLearnNextActions } from "./cad-learn-chrome";
import { ExploreOnshapeBoard } from "./cad-learn-explore";
import { LessonBody } from "./cad-learn-lesson";
import { BAND_LABEL, isCadLearnView, type CadLearnView } from "./cad-learn-model";
import { OnshapeEditBoard } from "../cad/onshape-edit-board";

async function persistCadLearnSnapshot(orgHint: string, data: CadLearnView): Promise<void> {
  const cacheOrg = data.orgId.trim() || orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("cad-learn", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("cad-learn", "_", data);
  } catch {
    // Live CAD Learn already painted; IndexedDB is best-effort.
  }
}

/** What a grader says when the team could not load, matching the card at the top of the page. */
function unavailableReasonFor(shell: CadLearnShellKind): string {
  if (shell === "signin") return "Sign in to grade your part.";
  if (shell === "setup") return "Choose your team to grade your part.";
  return "Your team didn't load. Retry at the top of the page to grade your part.";
}

export default function CadLearnClient() {
  const [view, setView] = useState<CadLearnView | null>(null);
  const [ready, setReady] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // 401 → signed out (sign in); 403 → signed in but not on that team (choose your team).
  const [authBlocked, setAuthBlocked] = useState<"signin" | "team" | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const viewed = useRef(new Set<string>());
  const viewRef = useRef<CadLearnView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    // The live request and the copy on this device start together; the copy paints first if it
    // wins, and the live answer replaces it either way.
    const query = orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : "";
    const live = fetch(`/api/cad-learn/progress${query}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    // Handled below; this only stops a fast failure being reported as unhandled while the cache reads.
    live.catch(() => undefined);
    try {
      const cached = await getFeatureSnapshot<CadLearnView>("cad-learn", orgHint || "_");
      if (!viewRef.current && cached?.data && isCadLearnView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        for (const row of cached.data.progress) viewed.current.add(row.lessonId);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; the live request is already running.
    }
    setRefreshError("");
    setFetchFailed(false);
    setAuthBlocked(null);
    try {
      const response = await live;
      if (response.status === 401 || response.status === 403) {
        await clearFeatureSnapshot("cad-learn", orgHint || "_");
        if (orgHint) await clearFeatureSnapshot("cad-learn", orgHint);
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setAuthBlocked(response.status === 401 ? "signin" : "team");
        setFetchFailed(false);
        return;
      }
      if (!response.ok) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setRefreshError(staleCopyNotice("CAD Learn"));
        } else {
          setFetchFailed(true);
        }
        return;
      }
      const data: unknown = await response.json().catch(() => null);
      if (!isCadLearnView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setRefreshError(staleCopyNotice("CAD Learn"));
        } else {
          setFetchFailed(true);
        }
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      for (const row of data.progress) viewed.current.add(row.lessonId);
      await persistCadLearnSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setRefreshError(staleCopyNotice("CAD Learn"));
      } else {
        setFetchFailed(true);
      }
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(async (lessonId: string, action: "view" | "complete" | "reopen") => {
    // Progress saves to the team on screen; without one loaded there is nowhere to save it.
    const orgId = viewRef.current?.orgId;
    if (!orgId) return;
    try {
      await fetch("/api/cad-learn/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lessonId, action, orgId }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
    } catch {
      /* progress is a convenience; a failed write must not break the page */
    }
  }, []);

  const registerRef = useCallback((id: string, element: HTMLElement | null) => {
    if (element) elements.current.set(id, element);
    else elements.current.delete(id);
  }, []);

  useEffect(() => {
    if (!ready || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id;
          if (!id || viewed.current.has(id) || !viewRef.current) continue;
          viewed.current.add(id);
          void post(id, "view");
        }
      },
      { threshold: 0.35 },
    );
    for (const element of elements.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [ready, post]);

  const completed = useMemo(
    () => new Set((view?.progress ?? []).filter((row) => row.completedAt).map((row) => row.lessonId)),
    [view],
  );

  const toggle = useCallback(
    (lessonId: string) => {
      const isDone = completed.has(lessonId);
      const previous = viewRef.current;
      if (previous) {
        const rows = previous.progress.filter((row) => row.lessonId !== lessonId);
        rows.push({
          lessonId,
          viewedAt: new Date().toISOString(),
          completedAt: isDone ? null : new Date().toISOString(),
        });
        const next = { ...previous, progress: rows };
        setView(next);
        void persistCadLearnSnapshot(previous.orgId, next);
      }
      void post(lessonId, isDone ? "reopen" : "complete");
    },
    [completed, post],
  );

  const lessons = allLessons();
  const remainingLessons = lessons.filter((lesson) => !completed.has(lesson.id));
  const remainingMinutes = remainingLessons.reduce((sum, lesson) => sum + lesson.minutes, 0);
  const firstUndoneId = remainingLessons[0]?.id ?? null;

  // The lessons are static and paint at once. Only the team parts (next actions, progress,
  // Explore, graders) wait on the network, and they show placeholders while they do.
  const teamLoading = !view && !ready;
  let shell: CadLearnShellKind | null = null;
  if (!view) {
    shell = teamLoading
      ? "loading"
      : classifyCadLearnShell({
          ready,
          fetchFailed,
          authBlocked: authBlocked === "team",
          signedOut: authBlocked === "signin",
        });
  }
  const unavailableReason = shell && shell !== "loading" ? unavailableReasonFor(shell) : null;

  return (
    <main className="module-page cl-page">
      <CadLearnHeader orgId={view?.orgId ?? null} />
      <OfflineBanner feature="CAD Learn" fromCache={fromCache} cachedAt={cachedAt} />
      {refreshError ? (
        <p {...staleCopyProps(refreshError, "cl-muted")}>
          {refreshError}
        </p>
      ) : null}
      {view?.orgId ? (
        <CadLearnNextActions
          orgId={view.orgId}
          firstUndoneId={firstUndoneId}
          remainingLessons={remainingLessons.length}
        />
      ) : null}
      {teamLoading ? (
        <section className="app-card soft-panel cad-next-actions" aria-busy="true" aria-label="Next actions">
          <span className="sr-only">Loading your progress</span>
          <TextBlockSkeleton lines={2} />
        </section>
      ) : null}
      {shell && shell !== "loading" ? (
        <CadLearnEmptyCard
          shell={shell}
          onRetry={
            shell === "error"
              ? () => {
                  setReady(false);
                  void load();
                }
              : undefined
          }
        />
      ) : null}

      <OnshapeEditBoard />
      {view || teamLoading ? <ExploreOnshapeBoard orgId={view?.orgId ?? null} pending={teamLoading} /> : null}

      <div className="cl-shell">
        <nav className="cl-side" aria-label="CAD track sections">
          <p className="cl-side-title">CAD onboarding</p>
          <div className="cl-side-group">
            {view || teamLoading ? <a href="#explore">Explore Onshape</a> : null}
            <a href="#reference">Which tool do I want</a>
          </div>
          {CAD_TRACK.map((unit) => (
            <div key={unit.id} className="cl-side-group">
              <a href={`#${unit.id}`}>{unit.title}</a>
              <ul>
                {unit.lessons.map((lesson) => (
                  <li key={lesson.id}>
                    <a href={`#${lesson.id}`} className={completed.has(lesson.id) ? "cl-side-done" : undefined}>
                      {completed.has(lesson.id) ? "✓ " : ""}
                      {lesson.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {view?.canManage ? (
            <div className="cl-side-group">
              <a href="#team">Team progress</a>
            </div>
          ) : null}
        </nav>

        <div className="cl-main">
          <header className="cl-hero">
            <p className="cl-kicker">Mechanical &amp; design subteam</p>
            {view?.orgName ? (
              <p className="cl-lead">
                Your progress is visible to leads at <strong>{view.orgName}</strong>.
              </p>
            ) : (
              <p className="cl-lead">The lessons stay on this page even if your team has not loaded yet.</p>
            )}
            {view ? (
              <p className="cl-progress">
                {completed.size} of {lessons.length} lessons done
                {remainingMinutes > 0 ? ` · about ${Math.round(remainingMinutes / 30) * 30} min left` : " · all done"}
                <span className="cl-muted"> · full track {Math.round(totalCadMinutes() / 60)}h</span>
              </p>
            ) : teamLoading ? (
              <p className="cl-progress" aria-hidden="true">
                <Skeleton width="16em" height={14} />
              </p>
            ) : (
              <p className="cl-progress">
                {lessons.length} lessons
                <span className="cl-muted"> · full track {Math.round(totalCadMinutes() / 60)}h</span>
              </p>
            )}
          </header>

          {CAD_TRACK.map((unit) => (
            <section key={unit.id} className="cl-unit" id={unit.id}>
              <h2>
                <a className="cl-anchor" href={`#${unit.id}`} aria-label={`Link to ${unit.title}`}>
                  #
                </a>
                {unit.title}
              </h2>
              <p className="cl-blurb">{unit.blurb}</p>
              {unit.lessons.map((lesson) => (
                <LessonBody
                  key={lesson.id}
                  lesson={lesson}
                  done={completed.has(lesson.id)}
                  onToggle={() => toggle(lesson.id)}
                  view={view}
                  teamLoading={teamLoading}
                  unavailableReason={unavailableReason}
                  onChanged={() => void load()}
                  registerRef={registerRef}
                />
              ))}
            </section>
          ))}

          <section className="cl-unit" id="reference">
            <h2>
              <a className="cl-anchor" href="#reference" aria-label="Link to Which tool do I want">
                #
              </a>
              Which tool do I want
            </h2>
            <p className="cl-blurb">
              Jobs to tools, for when you know what you are trying to do and not what it is called. Deliberately not
              keyboard shortcuts — those differ by platform and change between releases, and a wrong one here would
              cost you more time than looking it up.
            </p>
            {CAD_REFERENCE.map((group) => (
              <div key={group.group} className="cl-ref">
                <h3>{group.group}</h3>
                <table className="cl-ref-table">
                  <tbody>
                    {group.rows.map((row) => (
                      <tr key={row.want}>
                        <td>{row.want}</td>
                        <td>
                          <code>{row.tool}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>

          {view?.canManage && view.team ? (
            <section className="cl-unit" id="team">
              <h2>
                <a className="cl-anchor" href="#team" aria-label="Link to Team progress">
                  #
                </a>
                Team progress
              </h2>
              <p className="cl-blurb">
                Everyone at {view.orgName} who has opened the track. &ldquo;Viewed&rdquo; counts lessons that
                actually reached their screen, not lessons the page rendered.
              </p>
              {view.team.length === 0 ? (
                <p className="cl-muted">Nobody has opened the CAD track yet.</p>
              ) : (
                <table className="cl-table">
                  <thead>
                    <tr>
                      <th>Who</th>
                      <th>Viewed</th>
                      <th>Completed</th>
                      <th>Best grade</th>
                      <th>Last active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.team.map((row) => (
                      <tr key={row.userId}>
                        <td>{row.displayName}</td>
                        <td>
                          {row.viewed} / {lessons.length}
                        </td>
                        <td>
                          {row.completed} / {lessons.length}
                        </td>
                        <td>
                          {row.gradedBest ? (
                            <span className={`cl-band cl-band-${row.gradedBest}`}>
                              {BAND_LABEL[row.gradedBest as "match" | "close" | "off"]}
                            </span>
                          ) : (
                            <span className="cl-muted">not submitted</span>
                          )}
                        </td>
                        <td>{row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleDateString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          ) : null}

          <section className="cl-unit">
            <h2>Stuck?</h2>
            <p className="cl-blurb">
              Being stuck in CAD usually means one of two things: the software will not do what you asked, or you do
              not yet know what to ask it for. The forum is good at the first; your CAD lead is far better at the
              second. Ask with a screenshot of your feature list, not a description of it.
            </p>
            <ul className="cl-links">
              {CAD_COMMUNITY_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={link.primary ? "cl-link cl-link-primary" : "cl-link"}
                  >
                    {link.label}
                    <span aria-hidden="true"> ↗</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
