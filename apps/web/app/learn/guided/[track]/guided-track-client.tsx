"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Skeleton, askConfirm } from "../../../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../../../lib/nav/resolve-org";
import { isOnshapeApiCheck, onshapeInputLabel } from "../../../../lib/guided/checks-onshape";
import { canAskLeadInsteadOfOnshape, onshapeOffNotice } from "../../../../lib/guided/onshape-availability";
import type { CheckResult, GuidedStep, GuidedTrack } from "../../../../lib/guided/types";

type Done = Record<string, string>;
type StepState = { busy: boolean; result: CheckResult | null };
type Signoff = { stepId: string; status: "requested" | "approved" | "declined"; note: string | null };
type LoadError = "signin" | "failed";

/** A check can read Onshape or GitHub, which are slow; past this the student hears so instead of waiting. */
const CHECK_TIMEOUT_MS = 30_000;

function timedOut(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** The team in the address bar, so a member of two teams asks the right team's leads. */
function orgFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("orgId");
  } catch {
    return null;
  }
}

/** Steps that read an Onshape document take its address; the track remembers the last one. */
function takesOnshapeUrl(step: GuidedStep): boolean {
  return step.check.kind === "onshape-features" || step.check.kind === "onshape-mass" || isOnshapeApiCheck(step.check);
}

const urlKey = (trackId: string) => `vantage.guided.onshape-url.${trackId}`;

function readSavedUrl(trackId: string): string {
  try {
    return window.localStorage.getItem(urlKey(trackId)) ?? "";
  } catch {
    return "";
  }
}

function saveUrl(trackId: string, url: string) {
  try {
    window.localStorage.setItem(urlKey(trackId), url);
  } catch {
    /* Private windows and blocked storage: the student pastes it again. */
  }
}

/** What the student gives the check: a link, pasted text, numbers, or nothing. */
function StepInput({
  step,
  value,
  onChange,
}: {
  step: GuidedStep;
  value: { url: string; text: string; values: Record<string, string> };
  onChange: (next: { url: string; text: string; values: Record<string, string> }) => void;
}) {
  const check = step.check;
  if (takesOnshapeUrl(step)) {
    return (
      <label className="guided-input">
        {onshapeInputLabel(check.kind)}
        <input
          type="url"
          inputMode="url"
          placeholder="https://cad.onshape.com/documents/…"
          value={value.url}
          onChange={(event) => onChange({ ...value, url: event.target.value })}
        />
      </label>
    );
  }
  if (check.kind === "github-pr" || check.kind === "github-tag") {
    return (
      <label className="guided-input">
        {check.kind === "github-pr" ? "Pull request link" : "Tag or release link"}
        <input
          type="url"
          inputMode="url"
          placeholder={check.kind === "github-pr" ? "https://github.com/owner/repo/pull/12" : "https://github.com/owner/repo/releases/tag/week0"}
          value={value.url}
          onChange={(event) => onChange({ ...value, url: event.target.value })}
        />
      </label>
    );
  }
  if (check.kind === "paste") {
    return (
      <label className="guided-input">
        {check.prompt}
        <textarea
          rows={6}
          spellCheck={false}
          value={value.text}
          onChange={(event) => onChange({ ...value, text: event.target.value })}
        />
      </label>
    );
  }
  if (check.kind === "numbers") {
    return (
      <div className="guided-numbers">
        {check.fields.map((field) => (
          <label className="guided-input" key={field.id}>
            {field.label} ({field.unit})
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={value.values[field.id] ?? ""}
              onChange={(event) => onChange({ ...value, values: { ...value.values, [field.id]: event.target.value } })}
            />
          </label>
        ))}
      </div>
    );
  }
  return null;
}

export function GuidedTrackClient({ track, onshapeConfigured = true }: { track: GuidedTrack; onshapeConfigured?: boolean }) {
  const [done, setDone] = useState<Done>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [inputs, setInputs] = useState<Record<string, { url: string; text: string; values: Record<string, string> }>>({});
  const [states, setStates] = useState<Record<string, StepState>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState("");
  const [signoffs, setSignoffs] = useState<Record<string, Signoff>>({});

  useEffect(() => {
    setSavedUrl(readSavedUrl(track.id));
  }, [track.id]);

  const inputFor = (step: GuidedStep) =>
    inputs[step.id] ?? { url: takesOnshapeUrl(step) ? savedUrl : "", text: "", values: {} };

  const load = useCallback(async () => {
    const org = orgFromUrl();
    const response = await fetch(`/api/guided?track=${encodeURIComponent(track.id)}${org ? `&orgId=${encodeURIComponent(org)}` : ""}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    }).catch(() => null);
    const data = response?.ok
      ? await readJson<{ done?: Array<{ stepId: string; completedAt: string }>; signoffs?: Signoff[] }>(response)
      : null;
    if (!response?.ok || !data || !Array.isArray(data.done)) {
      setLoadError(response?.status === 401 ? "signin" : "failed");
      setLoaded(true);
      return;
    }
    setLoadError(null);
    setDone(Object.fromEntries(data.done.map((row) => [row.stepId, row.completedAt])));
    setSignoffs(Object.fromEntries((data.signoffs ?? []).map((row) => [row.stepId, row])));
    setLoaded(true);
  }, [track.id]);

  const retryLoad = () => {
    setLoaded(false);
    setLoadError(null);
    void load();
  };

  useEffect(() => {
    void load();
  }, [load]);

  // A sign-off notice links to "#step-<id>": open that step so the lead's note is in view.
  useEffect(() => {
    const id = window.location.hash.startsWith("#step-") ? decodeURIComponent(window.location.hash.slice(6)) : "";
    if (id && track.steps.some((step) => step.id === id)) setOpenId(id);
  }, [track.steps]);

  const doneCount = track.steps.filter((step) => done[step.id]).length;
  // The first step not yet done is the one that opens: that is where the student is.
  const current = track.steps.find((step) => !done[step.id])?.id ?? null;
  const open = openId ?? current;

  // A result appears under the Check button, which on a phone sits behind the bottom bar; scroll
  // it into view so it is read where it is written (and the shell does not repeat it as a toast).
  const resultRef = useRef<HTMLDivElement | null>(null);
  const lastResult = open ? states[open]?.result : null;
  useEffect(() => {
    if (!lastResult) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    resultRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [lastResult]);

  async function runCheck(step: GuidedStep, action?: "signoff") {
    const input = inputFor(step);
    if (takesOnshapeUrl(step) && input.url.trim()) {
      saveUrl(track.id, input.url.trim());
      setSavedUrl(input.url.trim());
    }
    setStates((prev) => ({ ...prev, [step.id]: { busy: true, result: prev[step.id]?.result ?? null } }));
    let failure: unknown = null;
    const response = await fetch("/api/guided", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trackId: track.id,
        stepId: step.id,
        orgId: orgFromUrl(),
        ...(action ? { action } : {}),
        input: { url: input.url, text: input.text, values: input.values },
      }),
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    }).catch((error: unknown) => {
      failure = error;
      return null;
    });
    const body = response ? await readJson<CheckResult & { pending?: boolean; error?: string }>(response) : null;
    const result: CheckResult & { pending?: boolean } =
      response?.ok && body && typeof body.message === "string"
        ? body
        : {
            passed: false,
            message:
              response?.status === 401
                ? "Sign in to run checks."
                : timedOut(failure)
                  ? "The check took too long to answer. Nothing was saved. Try again in a minute."
                  : (body?.message ?? body?.error ?? "Couldn't run the check. Try again."),
          };
    setStates((prev) => ({ ...prev, [step.id]: { busy: false, result } }));
    if ("pending" in result && result.pending) {
      setSignoffs((prev) => ({ ...prev, [step.id]: { stepId: step.id, status: "requested", note: null } }));
    }
    if (result.passed) {
      setDone((prev) => ({ ...prev, [step.id]: new Date().toISOString() }));
      setOpenId(null);
    }
  }

  async function reopen(step: GuidedStep, action: "reopen" | "withdraw" = "reopen") {
    const signedOff = step.check.kind === "lead-signoff" || signoffs[step.id]?.status === "approved";
    if (action === "reopen") {
      // Doing a finished step again throws away its check, and for a lead's step the lead's
      // sign-off too: say so before it happens.
      const ok = await askConfirm({
        title: `Do “${step.title}” again?`,
        body: signedOff
          ? "This clears the lead's sign-off. The step won't count until a lead signs it off again."
          : "This clears the check. The step won't count until you check it again.",
        confirmLabel: signedOff ? "Clear sign-off" : "Do it again",
        tone: "destructive",
      });
      if (!ok) return;
    }
    const response = await fetch("/api/guided", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId: track.id, stepId: step.id, action, orgId: orgFromUrl() }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    }).catch(() => null);
    if (!response?.ok) {
      // Nothing changed on the server, so nothing changes here either.
      setStates((prev) => ({
        ...prev,
        [step.id]: {
          busy: false,
          result: { passed: false, message: response?.status === 401 ? "Sign in again, then try that." : "That didn't save. Check your connection and try again." },
        },
      }));
      setOpenId(step.id);
      return;
    }
    setSignoffs((prev) => {
      const next = { ...prev };
      delete next[step.id];
      return next;
    });
    setDone((prev) => {
      const next = { ...prev };
      delete next[step.id];
      return next;
    });
    setStates((prev) => ({ ...prev, [step.id]: { busy: false, result: null } }));
    setOpenId(step.id);
  }

  return (
    <main className="module-page guided-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">
            <a href="/learn">Learn</a> / <a href="/learn/guided">Guided tracks</a>
          </span>
          <h1>{track.title}</h1>
          <p>{track.summary}</p>
          <p className="guided-meta">
            {track.time} · {track.audience}
          </p>
        </div>
      </header>

      <div className="guided-progress" role="status" aria-live="polite" aria-busy={!loaded}>
        {!loaded ? (
          <span>
            <span className="sr-only">Loading your progress</span>
            <Skeleton width="11em" height={14} />
          </span>
        ) : loadError ? null : (
          <span>{`${doneCount} of ${track.steps.length} steps checked`}</span>
        )}
        <span className="guided-bar" aria-hidden="true">
          <i style={{ width: `${(doneCount / Math.max(1, track.steps.length)) * 100}%` }} />
        </span>
      </div>
      {loaded && loadError ? (
        <div className="guided-load-error" role="alert">
          {loadError === "signin" ? (
            <>
              <p>Sign in to save your progress. You can read every step without signing in.</p>
              <Button as="a" variant="secondary" href={`/signin?next=${encodeURIComponent(`/learn/guided/${track.id}`)}`}>
                Sign in
              </Button>
            </>
          ) : (
            <>
              <p>Couldn&apos;t load your progress. Checks still work, and a passed check is still saved.</p>
              <Button variant="secondary" onClick={retryLoad}>
                Retry
              </Button>
            </>
          )}
        </div>
      ) : null}

      <ol className="guided-steps">
        {track.steps.map((step, index) => {
          const isDone = Boolean(done[step.id]);
          const isOpen = open === step.id;
          const state = states[step.id];
          // Onshape is off for this deployment: an Onshape-checked step goes to a lead instead.
          const viaLead = canAskLeadInsteadOfOnshape(step.check, onshapeConfigured);
          const offNotice = viaLead ? onshapeOffNotice(track.id, step.check) : null;
          const signoff = step.check.kind === "lead-signoff" || viaLead || signoffs[step.id]?.status === "approved";
          const practice = step.practice === true;
          return (
            <li
              key={step.id}
              id={`step-${step.id}`}
              className={`guided-step${isDone ? " is-done" : ""}${isOpen ? " is-open" : ""}${practice ? " is-practice" : ""}`}
              data-testid="guided-step"
            >
              <button
                type="button"
                className="guided-step-head"
                aria-expanded={isOpen}
                onClick={() => setOpenId(isOpen ? "__none__" : step.id)}
              >
                <b aria-hidden="true">{isDone ? "✓" : index + 1}</b>
                <span>
                  {practice ? <em className="guided-practice-chip">Practice</em> : null}
                  <strong>{step.title}</strong>
                  <small>
                    {isDone
                      ? signoff
                        ? "Signed off by a lead"
                        : "Checked"
                      : signoffs[step.id]?.status === "requested"
                        ? "Waiting for a lead"
                        : step.id === current
                          ? "Your next step"
                          : "Not done yet"}
                  </small>
                </span>
              </button>
              {isOpen ? (
                <div className="guided-step-body">
                  {step.why ? <p className="guided-why">{step.why}</p> : null}
                  {step.whenToUse || step.example ? (
                    <div className="guided-teach">
                      {step.whenToUse ? (
                        <p className="guided-when">
                          <strong>When to use it</strong>
                          {step.whenToUse}
                        </p>
                      ) : null}
                      {step.example ? (
                        <p className="guided-example">
                          <strong>Example</strong>
                          {step.example}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {practice ? <p className="guided-practice-note">No click-by-click this time. Build it from the spec below; the steps above show every tool you need.</p> : null}
                  <ol className="guided-do">
                    {step.do.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ol>
                  {step.links?.length ? (
                    <p className="guided-links">
                      {step.links.map((link, i) => (
                        <span key={link.href}>
                          {i ? " · " : ""}
                          <a href={link.href} target={link.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
                            {link.label}
                          </a>
                        </span>
                      ))}
                    </p>
                  ) : null}
                  <div className="guided-check">
                    <p className="guided-checked-by">
                      <strong>How it&apos;s checked:</strong>{" "}
                      {viaLead ? "for now, a team lead checks it with you and signs it off in Vantage." : step.checkedBy}
                    </p>
                    {isDone ? (
                      <div className="guided-actions">
                        <span className="guided-ok">{signoff ? "Signed off by a lead." : "Checked and done."}</span>
                        <Button variant="secondary" onClick={() => void reopen(step)}>
                          Do it again
                        </Button>
                      </div>
                    ) : signoff && signoffs[step.id]?.status === "requested" ? (
                      <div className="guided-actions">
                        <span className="guided-waiting" role="status">
                          Waiting for a lead. Your team&apos;s owners and admins got a notice; find one to check it with you.
                          You&apos;ll get a notice when it is signed off or sent back.
                        </span>
                        <Button variant="secondary" onClick={() => void reopen(step, "withdraw")}>
                          Withdraw request
                        </Button>
                      </div>
                    ) : (
                      <>
                        {signoff && signoffs[step.id]?.status === "declined" ? (
                          <p className="guided-declined">
                            A lead asked you to try again{signoffs[step.id]?.note ? `: “${signoffs[step.id]?.note}”` : "."}
                          </p>
                        ) : null}
                        {offNotice ? (
                          <div className="guided-onshape-off" role="note" data-testid="guided-onshape-off">
                            <p>
                              <strong>{offNotice.title}</strong>
                              {offNotice.body}
                            </p>
                            {offNotice.dxf ? (
                              <p>
                                {offNotice.dxf.text} <a href={offNotice.dxf.href}>Open the CAD checker</a>
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <StepInput
                            step={step}
                            value={inputFor(step)}
                            onChange={(next) => setInputs((prev) => ({ ...prev, [step.id]: next }))}
                          />
                        )}
                        <div className="guided-actions">
                          <Button variant="primary" disabled={state?.busy} onClick={() => void runCheck(step, viaLead ? "signoff" : undefined)}>
                            {state?.busy
                              ? step.check.kind === "onshape-drawing" && step.check.minDimensions
                                ? "Checking… up to 15 seconds"
                                : "Checking…"
                              : signoff
                                ? "Ask a lead to sign this off"
                                : "Check my work"}
                          </Button>
                        </div>
                      </>
                    )}
                    {state?.result && !isDone && !(signoff && signoffs[step.id]?.status === "requested") ? (
                      <div ref={isOpen ? resultRef : undefined} className={`guided-result${state.result.passed ? " is-pass" : " is-fail"}`} role="status">
                        <p>{state.result.message}</p>
                        {state.result.evidence?.length ? (
                          <details>
                            <summary data-disclosure>What was checked</summary>
                            <ul>
                              {state.result.evidence.map((line) => (
                                <li key={line}>{line}</li>
                              ))}
                            </ul>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {loaded && doneCount === track.steps.length ? (
        <p className="guided-finished" role="status">
          Every step is checked. Nice work. Show a lead your finished track, or start <a href="/learn/guided">another one</a>.
        </p>
      ) : null}
    </main>
  );
}
