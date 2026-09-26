"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../../components/ui";
import { isOnshapeApiCheck, onshapeInputLabel } from "../../../../lib/guided/checks-onshape";
import type { CheckResult, GuidedStep, GuidedTrack } from "../../../../lib/guided/types";

type Done = Record<string, string>;
type StepState = { busy: boolean; result: CheckResult | null };

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

export function GuidedTrackClient({ track }: { track: GuidedTrack }) {
  const [done, setDone] = useState<Done>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inputs, setInputs] = useState<Record<string, { url: string; text: string; values: Record<string, string> }>>({});
  const [states, setStates] = useState<Record<string, StepState>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [savedUrl, setSavedUrl] = useState("");

  useEffect(() => {
    setSavedUrl(readSavedUrl(track.id));
  }, [track.id]);

  const inputFor = (step: GuidedStep) =>
    inputs[step.id] ?? { url: takesOnshapeUrl(step) ? savedUrl : "", text: "", values: {} };

  const load = useCallback(async () => {
    const response = await fetch(`/api/guided?track=${encodeURIComponent(track.id)}`, { cache: "no-store" }).catch(() => null);
    if (!response?.ok) {
      setLoadError(response?.status === 401 ? "Sign in to save your progress." : "Couldn't load your progress. Checks still work.");
      setLoaded(true);
      return;
    }
    const data = (await response.json()) as { done: Array<{ stepId: string; completedAt: string }> };
    setDone(Object.fromEntries(data.done.map((row) => [row.stepId, row.completedAt])));
    setLoaded(true);
  }, [track.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const doneCount = track.steps.filter((step) => done[step.id]).length;
  // The first step not yet done is the one that opens: that is where the student is.
  const current = track.steps.find((step) => !done[step.id])?.id ?? null;
  const open = openId ?? current;

  async function runCheck(step: GuidedStep, extra?: Record<string, unknown>) {
    const input = inputFor(step);
    if (takesOnshapeUrl(step) && input.url.trim()) {
      saveUrl(track.id, input.url.trim());
      setSavedUrl(input.url.trim());
    }
    setStates((prev) => ({ ...prev, [step.id]: { busy: true, result: prev[step.id]?.result ?? null } }));
    const response = await fetch("/api/guided", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        trackId: track.id,
        stepId: step.id,
        input: { url: input.url, text: input.text, values: { ...input.values, ...extra } },
      }),
    }).catch(() => null);
    const result = response?.ok
      ? ((await response.json()) as CheckResult)
      : { passed: false, message: response?.status === 401 ? "Sign in to run checks." : "Couldn't run the check. Try again." };
    setStates((prev) => ({ ...prev, [step.id]: { busy: false, result } }));
    if (result.passed) {
      setDone((prev) => ({ ...prev, [step.id]: new Date().toISOString() }));
      setOpenId(null);
    }
  }

  async function reopen(step: GuidedStep) {
    await fetch("/api/guided", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId: track.id, stepId: step.id, action: "reopen" }),
    }).catch(() => null);
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
            <a href="/learn">Code &amp; CAD</a> / <a href="/learn/guided">Checked step by step</a>
          </span>
          <h1>{track.title}</h1>
          <p>{track.summary}</p>
          <p className="guided-meta">
            {track.time} · {track.audience}
          </p>
        </div>
      </header>

      <div className="guided-progress" role="status" aria-live="polite">
        <span>
          {!loaded ? "Loading your progress…" : `${doneCount} of ${track.steps.length} steps checked`}
          {loadError ? ` · ${loadError}` : ""}
        </span>
        <span className="guided-bar" aria-hidden="true">
          <i style={{ width: `${(doneCount / Math.max(1, track.steps.length)) * 100}%` }} />
        </span>
      </div>

      <ol className="guided-steps">
        {track.steps.map((step, index) => {
          const isDone = Boolean(done[step.id]);
          const isOpen = open === step.id;
          const state = states[step.id];
          const signoff = step.check.kind === "lead-signoff";
          return (
            <li key={step.id} className={`guided-step${isDone ? " is-done" : ""}${isOpen ? " is-open" : ""}`} data-testid="guided-step">
              <button
                type="button"
                className="guided-step-head"
                aria-expanded={isOpen}
                onClick={() => setOpenId(isOpen ? "__none__" : step.id)}
              >
                <b aria-hidden="true">{isDone ? "✓" : index + 1}</b>
                <span>
                  <strong>{step.title}</strong>
                  <small>{isDone ? (signoff ? "Marked done after a lead's check" : "Checked") : step.id === current ? "Your next step" : "Not done yet"}</small>
                </span>
              </button>
              {isOpen ? (
                <div className="guided-step-body">
                  {step.why ? <p className="guided-why">{step.why}</p> : null}
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
                      <strong>How it&apos;s checked:</strong> {step.checkedBy}
                    </p>
                    {isDone ? (
                      <div className="guided-actions">
                        <span className="guided-ok">{signoff ? "Marked done after a lead's check." : "Checked and done."}</span>
                        <Button variant="secondary" onClick={() => void reopen(step)}>
                          Do it again
                        </Button>
                      </div>
                    ) : (
                      <>
                        <StepInput
                          step={step}
                          value={inputFor(step)}
                          onChange={(next) => setInputs((prev) => ({ ...prev, [step.id]: next }))}
                        />
                        <div className="guided-actions">
                          <Button
                            variant="primary"
                            disabled={state?.busy}
                            onClick={() => void runCheck(step, signoff ? { confirmed: true } : undefined)}
                          >
                            {state?.busy ? (step.check.kind === "onshape-drawing" && step.check.minDimensions ? "Checking… up to 15 seconds" : "Checking…") : signoff ? "A lead checked this with me" : "Check my work"}
                          </Button>
                        </div>
                      </>
                    )}
                    {state?.result && !isDone ? (
                      <div className={`guided-result${state.result.passed ? " is-pass" : " is-fail"}`} role="status">
                        <p>{state.result.message}</p>
                        {state.result.evidence?.length ? (
                          <details>
                            <summary>What was checked</summary>
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
