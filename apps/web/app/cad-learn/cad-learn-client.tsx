"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { ToolStrip } from "../../components/ui";
import {
  CAD_COMMUNITY_LINKS,
  CAD_REFERENCE,
  CAD_TRACK,
  allLessons,
  totalCadMinutes,
  type Lesson,
} from "../../lib/cad-learn/track";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

/**
 * The CAD track page.
 *
 * Deliberately the same surface as /dev-setup — left rail, one anchor per
 * lesson, tabbed alternatives, a "when you use it" line kept apart from the
 * steps, and a reference table at the end — because that page is the agreed
 * pattern for a guide a student comes back to rather than reads once.
 *
 * What is new here is the grader, and the rule it follows: it shows two
 * percentages when it measured two things, and it shows a clearly-labelled
 * setup or failure state when it measured nothing. There is no third state
 * where a number appears without a measurement behind it.
 */

type ProgressRow = { lessonId: string; viewedAt: string; completedAt: string | null };
type ReferenceRow = {
  lessonId: string;
  documentId: string;
  workspaceId: string;
  elementId: string;
  massKg: number;
  volumeM3: number | null;
  principalInertia: number[] | null;
  material: string;
  measuredAt: string;
  measuredByName: string | null;
};
type SubmissionRow = {
  id: string;
  lessonId: string;
  userId: string;
  displayName: string | null;
  massKg: number;
  massPercentDifference: number;
  inertiaPercentDifference: number | null;
  overallBand: "match" | "close" | "off";
  material: string;
  gradedAt: string;
};
type TeamRow = {
  userId: string;
  displayName: string;
  viewed: number;
  completed: number;
  lastActivityAt: string | null;
  gradedBest: string | null;
};

type View = {
  orgId: string;
  orgName: string;
  canManage: boolean;
  progress: ProgressRow[];
  references: ReferenceRow[];
  submissions: SubmissionRow[];
  team: TeamRow[] | null;
};

type GradeFactor = {
  id: "mass" | "moment_of_inertia";
  label: string;
  unit: string;
  reference: number;
  student: number;
  percentDifference: number;
  band: "match" | "close" | "off";
};

type GradeResponse =
  | { status: "graded"; lessonTitle: string; material: string; referenceMeasuredAt: string; openUrl: string; grade: {
      overall: "match" | "close" | "off";
      material: string;
      factors: GradeFactor[];
      perAxisInertiaPercent: number[] | null;
      inertiaUngradedReason: string | null;
      densityCheck: { referenceKgM3: number; studentKgM3: number; percentDifference: number; sameMaterial: boolean } | null;
      whatToCheck: string[];
    } }
  | { status: "no_reference"; message: string }
  | { status: "not_connected"; message: string }
  | { status: "cannot_read"; reason: string; message: string }
  | { status: "error"; message: string };

const BAND_LABEL: Record<"match" | "close" | "off", string> = {
  match: "Match",
  close: "Close",
  off: "Off",
};

function formatPercent(value: number): string {
  const rounded = Math.abs(value) < 0.05 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function formatKg(value: number): string {
  if (value >= 1) return `${value.toFixed(3)} kg`;
  return `${(value * 1000).toFixed(1)} g`;
}

function MethodTabs({ methods }: { methods: NonNullable<Lesson["methods"]> }) {
  const [active, setActive] = useState(0);
  const current = methods[Math.min(active, methods.length - 1)]!;
  return (
    <div className="cl-methods">
      {methods.length > 1 ? (
        <ToolStrip
          aria-label="How to do this"
          value={String(Math.min(active, methods.length - 1))}
          onChange={(id) => setActive(Number(id))}
          items={methods.map((method, index) => ({
            id: String(index),
            label: method.label,
          }))}
        />
      ) : null}
      <ol className="cl-method-lines">
        {current.lines.map((line, index) => (
          <li key={`${current.label}-${index}`}>{line}</li>
        ))}
      </ol>
      {current.note ? <p className="cl-method-note">{current.note}</p> : null}
    </div>
  );
}

/** A setup-required or could-not-measure state. Never a score. */
function GradeNotice({ tone, title, message }: { tone: "setup" | "fail"; title: string; message: string }) {
  return (
    <div className={tone === "setup" ? "cl-notice cl-notice-setup" : "cl-notice cl-notice-fail"} role="status">
      <strong>{title}</strong>
      <p>{message}</p>
      <p className="cl-muted">Nothing was graded, and this is not a mark against you.</p>
    </div>
  );
}

function GradeResult({ response }: { response: Extract<GradeResponse, { status: "graded" }> }) {
  const { grade } = response;
  return (
    <div className={`cl-grade cl-grade-${grade.overall}`}>
      <div className="cl-grade-head">
        <span className={`cl-band cl-band-${grade.overall}`}>{BAND_LABEL[grade.overall]}</span>
        <span className="cl-muted">
          Compared on {grade.material}, against the reference measured{" "}
          {new Date(response.referenceMeasuredAt).toLocaleDateString()}
        </span>
      </div>

      <div className="cl-factors">
        {grade.factors.map((factor) => (
          <div key={factor.id} className={`cl-factor cl-factor-${factor.band}`}>
            <p className="cl-factor-label">{factor.label}</p>
            <p className="cl-factor-value">{formatPercent(factor.percentDifference)}</p>
            <p className="cl-muted">
              {factor.id === "mass"
                ? `yours ${formatKg(factor.student)} · reference ${formatKg(factor.reference)}`
                : `yours ${factor.student.toExponential(3)} · reference ${factor.reference.toExponential(3)} ${factor.unit}`}
            </p>
            <p className={`cl-factor-band cl-band-${factor.band}`}>{BAND_LABEL[factor.band]}</p>
          </div>
        ))}
        {grade.inertiaUngradedReason ? (
          <div className="cl-factor cl-factor-unknown">
            <p className="cl-factor-label">Moment of inertia</p>
            <p className="cl-factor-value">Not measured</p>
            <p className="cl-muted">{grade.inertiaUngradedReason}</p>
          </div>
        ) : null}
      </div>

      {grade.perAxisInertiaPercent ? (
        <p className="cl-axes">
          Per principal axis:{" "}
          {grade.perAxisInertiaPercent.map((value, index) => (
            <span key={index} className="cl-axis">
              {formatPercent(value)}
            </span>
          ))}
        </p>
      ) : null}

      {grade.densityCheck ? (
        <p className={grade.densityCheck.sameMaterial ? "cl-density" : "cl-density cl-density-bad"}>
          Density check: yours {Math.round(grade.densityCheck.studentKgM3)} kg/m³ vs reference{" "}
          {Math.round(grade.densityCheck.referenceKgM3)} kg/m³ ({formatPercent(grade.densityCheck.percentDifference)}) —{" "}
          {grade.densityCheck.sameMaterial ? "same material" : "NOT the same material"}
        </p>
      ) : null}

      <div className="cl-what">
        <strong>What to check</strong>
        <ul>
          {grade.whatToCheck.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The grader, and — for a lead — the control that binds the reference part.
 *
 * Both sides read mass properties live from Onshape. Neither side has a field
 * for typing a number in.
 */
function Grader({
  lesson,
  view,
  onChanged,
}: {
  lesson: Lesson;
  view: View | null;
  onChanged: () => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<GradeResponse | null>(null);

  const [referenceUrl, setReferenceUrl] = useState("");
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceNote, setReferenceNote] = useState<string | null>(null);

  const reference = (view?.references ?? []).find((row) => row.lessonId === lesson.id) ?? null;
  const mine = (view?.submissions ?? []).filter((row) => row.lessonId === lesson.id).slice(0, 5);

  async function grade() {
    if (!url.trim()) return;
    setBusy(true);
    setResponse(null);
    try {
      const result = await fetch("/api/cad-learn/grade", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lessonId: lesson.id, url }),
      });
      const data = (await result.json()) as GradeResponse & { error?: string };
      if (!result.ok) {
        setResponse({ status: "error", message: data.error ?? "Could not grade that part." });
        return;
      }
      setResponse(data);
      if (data.status === "graded") onChanged();
    } catch {
      setResponse({ status: "error", message: "Could not reach the server. Nothing was graded." });
    } finally {
      setBusy(false);
    }
  }

  async function bindReference() {
    if (!referenceUrl.trim()) return;
    setReferenceBusy(true);
    setReferenceNote(null);
    try {
      const result = await fetch("/api/cad-learn/reference", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lessonId: lesson.id, url: referenceUrl }),
      });
      const data = (await result.json()) as {
        status?: string;
        message?: string;
        error?: string;
        massKg?: number;
        gradesInertia?: boolean;
      };
      if (!result.ok) {
        setReferenceNote(data.error ?? "Could not set the reference part.");
        return;
      }
      if (data.status === "measured") {
        setReferenceNote(
          `Reference measured: ${formatKg(data.massKg ?? 0)}.${
            data.gradesInertia
              ? ""
              : " Onshape returned no principal moments for it, so this lesson will grade mass only."
          }`,
        );
        setReferenceUrl("");
        onChanged();
        return;
      }
      setReferenceNote(data.message ?? "Nothing was measured, so no reference was stored.");
    } catch {
      setReferenceNote("Could not reach the server. No reference was stored.");
    } finally {
      setReferenceBusy(false);
    }
  }

  return (
    <div className="cl-grader">
      <div className="cl-grader-head">
        <strong>Grade this part</strong>
        <span className="cl-chip">Material: cast iron</span>
      </div>
      <p className="cl-muted">
        Vantage reads your part&rsquo;s mass and moment of inertia from Onshape and compares them with your
        team&rsquo;s reference part. Both must be on <strong>cast iron</strong> — mass and inertia both scale with
        density, so on a different material neither number tells you anything about your geometry.
      </p>

      {reference ? (
        <p className="cl-muted">
          Reference set{reference.measuredByName ? ` by ${reference.measuredByName}` : ""} on{" "}
          {new Date(reference.measuredAt).toLocaleDateString()} · {formatKg(Number(reference.massKg))}
          {reference.principalInertia ? "" : " · mass only (no principal moments in the reference)"}
        </p>
      ) : (
        <p className="cl-muted">
          No reference part is set for this lesson yet, so nothing can be graded. A lead sets it below.
        </p>
      )}

      <label className="cl-field">
        <span>Your Onshape Part Studio URL</span>
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://cad.onshape.com/documents/…/w/…/e/…"
          spellCheck={false}
        />
      </label>
      <button type="button" className="cl-button" disabled={busy || !url.trim()} onClick={() => void grade()}>
        {busy ? "Measuring…" : "Grade my part"}
      </button>

      {response?.status === "graded" ? <GradeResult response={response} /> : null}
      {response?.status === "no_reference" ? (
        <GradeNotice tone="setup" title="No reference part yet" message={response.message} />
      ) : null}
      {response?.status === "not_connected" ? (
        <GradeNotice tone="setup" title="Onshape is not connected" message={response.message} />
      ) : null}
      {response?.status === "cannot_read" ? (
        <GradeNotice tone="fail" title="Could not read your mass properties" message={response.message} />
      ) : null}
      {response?.status === "error" ? (
        <GradeNotice tone="fail" title="Could not grade that" message={response.message} />
      ) : null}

      {mine.length > 0 ? (
        <details className="cl-fold">
          <summary>Your attempts ({mine.length})</summary>
          <div className="cl-fold-body">
            <table className="cl-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Mass</th>
                  <th>MOI</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.gradedAt).toLocaleString()}</td>
                    <td>{formatPercent(Number(row.massPercentDifference))}</td>
                    <td>
                      {row.inertiaPercentDifference === null
                        ? "not measured"
                        : formatPercent(Number(row.inertiaPercentDifference))}
                    </td>
                    <td className={`cl-band cl-band-${row.overallBand}`}>{BAND_LABEL[row.overallBand]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      {view?.canManage ? (
        <details className="cl-fold">
          <summary>Lead: set the reference part for this lesson</summary>
          <div className="cl-fold-body">
            <p className="cl-muted">
              Paste the Onshape URL of the CORRECT part. Vantage measures it over your own Onshape connection and
              stores what it measured — there is no field for typing a mass in, deliberately. Assign cast iron to
              the reference part before you bind it.
            </p>
            <label className="cl-field">
              <span>Reference Part Studio URL</span>
              <input
                type="url"
                value={referenceUrl}
                onChange={(event) => setReferenceUrl(event.target.value)}
                placeholder="https://cad.onshape.com/documents/…/w/…/e/…"
                spellCheck={false}
              />
            </label>
            <button
              type="button"
              className="cl-button"
              disabled={referenceBusy || !referenceUrl.trim()}
              onClick={() => void bindReference()}
            >
              {referenceBusy ? "Measuring…" : "Measure and set as reference"}
            </button>
            {referenceNote ? <p className="cl-note">{referenceNote}</p> : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function LessonBody({
  lesson,
  done,
  onToggle,
  view,
  onChanged,
  registerRef,
}: {
  lesson: Lesson;
  done: boolean;
  onToggle: () => void;
  view: View | null;
  onChanged: () => void;
  registerRef: (id: string, element: HTMLElement | null) => void;
}) {
  return (
    <section className="cl-lesson" id={lesson.id} ref={(element) => registerRef(lesson.id, element)}>
      <header className="cl-lesson-head">
        <div>
          <h3>
            <a className="cl-anchor" href={`#${lesson.id}`} aria-label={`Link to ${lesson.title}`}>
              #
            </a>
            {lesson.title}
          </h3>
          <small className="cl-muted">
            about {lesson.minutes} min{lesson.gradable ? " · graded" : ""}
          </small>
        </div>
        <label className="cl-done">
          <input type="checkbox" checked={done} onChange={onToggle} />
          <span>Done</span>
        </label>
      </header>

      {/* "When you use it" first and visually distinct — the question a student
          actually has, and the one most guides never answer. */}
      <p className="cl-why">
        <strong>When you use it —</strong> {lesson.why}
      </p>

      <ol className="cl-steps">
        {lesson.steps.map((step, index) => (
          <li key={`${lesson.id}-s-${index}`}>{step}</li>
        ))}
      </ol>

      {lesson.methods ? <MethodTabs methods={lesson.methods} /> : null}

      <p className="cl-practice">
        <strong>Build this —</strong> {lesson.practice}
      </p>

      {lesson.tip ? (
        <aside className="cl-callout cl-tip">
          <strong>Worth knowing</strong>
          <p>{lesson.tip}</p>
        </aside>
      ) : null}

      {lesson.warning ? (
        <aside className="cl-callout cl-warn">
          <strong>Careful</strong>
          <p>{lesson.warning}</p>
        </aside>
      ) : null}

      <p className="cl-verify">
        <strong>You know it worked when —</strong> {lesson.verify}
      </p>

      {lesson.links.length > 0 ? (
        <ul className="cl-links">
          {lesson.links.map((link) => (
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
      ) : null}

      {lesson.gradable ? <Grader lesson={lesson} view={view} onChanged={onChanged} /> : null}
    </section>
  );
}

function isCadLearnView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const row = value as { orgId?: unknown; progress?: unknown };
  return typeof row.orgId === "string" && Array.isArray(row.progress);
}

async function persistCadLearnSnapshot(orgHint: string, data: View): Promise<void> {
  const cacheOrg = data.orgId.trim() || orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("cad-learn", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("cad-learn", "_", data);
  } catch {
    // Live CAD Learn already painted; IndexedDB is best-effort.
  }
}

export default function CadLearnClient() {
  const [view, setView] = useState<View | null>(null);
  const [ready, setReady] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const elements = useRef(new Map<string, HTMLElement>());
  const viewed = useRef(new Set<string>());
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("cad-learn", orgHint || "_");
      if (!viewRef.current && cached?.data && isCadLearnView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        for (const row of cached.data.progress) viewed.current.add(row.lessonId);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setRefreshError("");
    try {
      const query = orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : "";
      const response = await fetch(`/api/cad-learn/progress${query}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        return;
      }
      if (!response.ok) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setRefreshError("Could not refresh CAD Learn. Showing the last copy on this device.");
        }
        return;
      }
      const data: unknown = await response.json().catch(() => null);
      if (!isCadLearnView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setRefreshError("Could not refresh CAD Learn. Showing the last copy on this device.");
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
        setRefreshError("Could not refresh CAD Learn. Showing the last copy on this device.");
      }
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const post = useCallback(async (lessonId: string, action: "view" | "complete" | "reopen") => {
    try {
      await fetch("/api/cad-learn/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lessonId, action }),
      });
    } catch {
      /* progress is a convenience; a failed write must not break the page */
    }
  }, []);

  const registerRef = useCallback((id: string, element: HTMLElement | null) => {
    if (element) elements.current.set(id, element);
    else elements.current.delete(id);
  }, []);

  /**
   * "Viewed" is recorded when a lesson actually reaches the screen, not when
   * the page loads. A mentor asking "has Maya got as far as mates yet" wants
   * the honest answer, and marking all fourteen viewed because the page
   * rendered would make the whole column meaningless.
   */
  useEffect(() => {
    if (!ready || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = entry.target.id;
          if (!id || viewed.current.has(id)) continue;
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
      // Optimistic: the checkbox has to feel instant, and a failed write only
      // costs a tick that comes back on reload.
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
  const remainingMinutes = lessons.filter((lesson) => !completed.has(lesson.id)).reduce((sum, lesson) => sum + lesson.minutes, 0);

  return (
    <main className="module-page cl-page">
      <div className="cl-shell">
        <nav className="cl-side" aria-label="CAD track sections">
          <p className="cl-side-title">CAD onboarding</p>
          <div className="cl-side-group">
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
            <h1>Learn CAD, and have your part checked</h1>
            <p className="cl-lead">
              Onshape from the first sketch to a mated assembly, in the order things actually build on each other.
              At the end you link your part and Vantage measures it — mass and moment of inertia — against your
              team&rsquo;s reference part, and tells you what to look at when they differ.
              {view?.orgName ? (
                <>
                  {" "}
                  Your progress is visible to leads at <strong>{view.orgName}</strong>.
                </>
              ) : null}
            </p>
            {ready ? (
              <p className="cl-progress">
                {completed.size} of {lessons.length} lessons done
                {remainingMinutes > 0 ? ` · about ${Math.round(remainingMinutes / 30) * 30} min left` : " · all done"}
                <span className="cl-muted"> · full track {Math.round(totalCadMinutes() / 60)}h</span>
              </p>
            ) : null}
          </header>
          <OfflineBanner feature="CAD Learn" fromCache={fromCache} cachedAt={cachedAt} />
          {refreshError ? (
            <p className="cl-muted" role="alert">
              {refreshError}
            </p>
          ) : null}

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
              <li>
                <a className="cl-link" href="/team?tab=messages">
                  Ask in team chat
                </a>
              </li>
              <li>
                <a className="cl-link" href="/build?tab=cad">
                  The CAD workbench
                </a>
              </li>
              <li>
                <a className="cl-link" href="/dev-setup">
                  Programming subteam? Start here instead
                </a>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
