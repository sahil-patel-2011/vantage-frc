"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PageHeader, Button } from "../../components/ui";
import {
  BUG_DESCRIPTION_MAX,
  BUG_SEVERITIES,
  BUG_SEVERITY_LABELS,
  normalizeBugRoute,
  type BugSeverity,
} from "../../lib/feedback/bug-report";

/**
 * Report a bug — one textarea, an optional severity, and a visible list of the
 * only details we attach (page address, viewport, browser). Nothing is
 * collected silently: what the panel shows is exactly what the API receives.
 */

type CapturedDetails = {
  route: string | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  userAgent: string | null;
};

function captureDetails(): CapturedDetails {
  if (typeof window === "undefined") {
    return { route: null, viewportWidth: null, viewportHeight: null, userAgent: null };
  }
  const params = new URLSearchParams(window.location.search);
  // Prefer the page the reporter came from (the Report-a-bug button passes ?from=);
  // fall back to a same-origin referrer. Both go through the same normalizer the
  // server applies, so the preview always matches what is stored.
  let route = normalizeBugRoute(params.get("from"));
  if (!route && document.referrer) {
    try {
      const ref = new URL(document.referrer);
      if (ref.origin === window.location.origin && ref.pathname !== "/report-bug") {
        route = normalizeBugRoute(`${ref.pathname}${ref.search}`);
      }
    } catch {
      // Unparseable referrer — leave the route blank rather than guessing.
    }
  }
  return {
    route,
    viewportWidth: window.innerWidth || null,
    viewportHeight: window.innerHeight || null,
    userAgent: navigator.userAgent || null,
  };
}

export default function ReportBugClient() {
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<BugSeverity | null>(null);
  const [details, setDetails] = useState<CapturedDetails | null>(null);
  const [includeDetails, setIncludeDetails] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setDetails(captureDetails());
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !description.trim()) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        description: description.trim(),
        severity,
        route: includeDetails ? details?.route ?? null : null,
        clientInfo: includeDetails
          ? {
              viewportWidth: details?.viewportWidth ?? null,
              viewportHeight: details?.viewportHeight ?? null,
              userAgent: details?.userAgent ?? null,
            }
          : null,
      };
      const response = await fetch("/api/feedback/bug", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not send the bug report. Please try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Network error — the report was not sent. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <main className="module-page report-bug-page">
        <PageHeader breadcrumbs="Support / Report a bug" title="Report a bug" />
        <section className="app-card soft-panel report-bug-thanks" role="status">
          <h2>Thanks — we read every one.</h2>
          <p>
            Your report is in. If it turns out to be urgent, open{" "}
            <a href="/support">Support</a> so we can reply to you directly.
          </p>
          <div className="report-bug-thanks-actions">
            <Button variant="secondary" type="button" onClick={() => { setSent(false); setDescription(""); setSeverity(null); }}>
              Report another
            </Button>
            <Button as="a" variant="primary" href={details?.route ?? "/dashboard"}>
              Back to what you were doing
            </Button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="module-page report-bug-page">
      <PageHeader
        breadcrumbs="Support / Report a bug"
        title="Report a bug"
        description="One box. Say what happened — we read every report. Need a reply? Use Support instead."
      />

      <form className="app-card soft-panel report-bug-form" onSubmit={(event) => void onSubmit(event)}>
        <label className="report-bug-description">
          What happened?
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={BUG_DESCRIPTION_MAX}
            rows={6}
            required
            autoFocus
            placeholder="What you were doing, what you expected, and what happened instead."
          />
        </label>

        <fieldset className="report-bug-severity">
          <legend>How bad is it? (optional)</legend>
          {BUG_SEVERITIES.map((value) => (
            <label key={value} className="report-bug-severity-option">
              <input
                type="radio"
                name="severity"
                checked={severity === value}
                onChange={() => setSeverity(value)}
              />
              <span>{BUG_SEVERITY_LABELS[value]}</span>
            </label>
          ))}
          {severity ? (
            <button type="button" className="report-bug-clear-severity" onClick={() => setSeverity(null)}>
              Clear choice
            </button>
          ) : null}
        </fieldset>

        <section className="report-bug-details" aria-label="Details attached to this report">
          <label className="report-bug-details-toggle">
            <input
              type="checkbox"
              checked={includeDetails}
              onChange={(event) => setIncludeDetails(event.target.checked)}
            />
            <span>Attach these details (they help us reproduce it)</span>
          </label>
          <ul className={includeDetails ? undefined : "report-bug-details-off"}>
            <li>
              <strong>Page</strong>
              <span>{details?.route ?? "Not captured — you can mention it in the description."}</span>
            </li>
            <li>
              <strong>Window size</strong>
              <span>
                {details?.viewportWidth && details?.viewportHeight
                  ? `${details.viewportWidth} × ${details.viewportHeight}`
                  : "Not captured."}
              </span>
            </li>
            <li>
              <strong>Browser</strong>
              <span>{details?.userAgent ?? "Not captured."}</span>
            </li>
          </ul>
          <p className="report-bug-details-note">
            This is everything the report sends besides your words — nothing is collected silently.
          </p>
        </section>

        {error ? (
          <p className="report-bug-error" role="alert">
            {error}
          </p>
        ) : null}

        <Button variant="primary" className="report-bug-submit" type="submit" disabled={busy || !description.trim()}>
          {busy ? "Sending…" : "Send report"}
        </Button>
      </form>
    </main>
  );
}
