"use client";

import { useCallback, useEffect, useState } from "react";
import "../admin-flow.css";

type HubStatus = {
  urlSet: boolean;
  secretSet: boolean;
  configured: boolean;
  check: { ok: boolean; version: number | null; hub: boolean; folderUrl: string | null; error: string | null } | null;
  script: string | null;
};

/**
 * Team sheets in the platform owner's Google Drive: one spreadsheet per team in a
 * "VantageFRC" folder, created when a team is created and kept up to date automatically.
 * Platform admins only (this page is gated by admin/layout.tsx).
 */
export function SheetsHubCard() {
  const [status, setStatus] = useState<HubStatus | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/admin/sheets-hub", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as HubStatus & { error?: string };
      if (!response.ok) setError(data.error ?? "Couldn't check the team sheets setup.");
      else {
        setError("");
        setStatus(data);
      }
    } catch {
      setError("Couldn't reach Vantage. Check your connection.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = async () => {
    if (!status?.script) return;
    try {
      await navigator.clipboard.writeText(status.script);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Couldn't copy. Select the script below and copy it by hand.");
    }
  };

  const working = Boolean(status?.check?.ok);
  return (
    <section className="compare-panel sheets-hub-card" aria-labelledby="sheets-hub-title">
      <span className="eyebrow">Google Sheets</span>
      <h2 id="sheets-hub-title">Team sheets in your Google Drive</h2>
      <p className="app-muted">
        Every team gets its own spreadsheet in a <strong>VantageFRC</strong> folder of your Google account, named like
        &ldquo;FRC 6925 · Team Name&rdquo;, with a tab per kind of record. It is created when the team is, updates by
        itself while people use Vantage, and is shared view-only with the team&rsquo;s owners.
      </p>

      {error ? <p role="alert">{error}</p> : null}
      {!status && !error ? <p className="app-muted">Checking…</p> : null}

      {status ? (
        <>
          <p role="status" className={working ? "sheets-hub-ok" : "sheets-hub-off"}>
            {working
              ? "On. Team sheets are being kept up to date."
              : status.check?.error
                ? status.check.error
                : !status.secretSet
                  ? "Off. The server has no VANTAGE_SHEETS_HUB_SECRET yet."
                  : !status.urlSet
                    ? "Almost there. Deploy the script below, then add its address to the server."
                    : "Off."}
            {working && status.check?.folderUrl ? (
              <>
                {" "}
                <a href={status.check.folderUrl} target="_blank" rel="noreferrer">
                  Open the VantageFRC folder
                </a>
              </>
            ) : null}
          </p>

          {!working && status.script ? (
            <ol className="sheets-hub-steps">
              <li>
                Go to <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com</a>{" "}
                and start a new project, signed in as the Google account that should hold the sheets.
              </li>
              <li>
                Replace everything in the editor with the script below, and save.{" "}
                <button type="button" className="app-button secondary" onClick={() => void copy()}>
                  {copied ? "Copied" : "Copy script"}
                </button>
              </li>
              <li>
                Deploy → New deployment → Web app. Execute as <strong>Me</strong>, who has access <strong>Anyone</strong>.
                Allow the permissions Google asks for.
              </li>
              <li>
                Copy the web app address (it ends in <code>/exec</code>) into the server setting{" "}
                <code>VANTAGE_SHEETS_HUB_URL</code>, redeploy, then press Check again.
              </li>
            </ol>
          ) : null}

          {!working && status.script ? (
            <details className="sheets-hub-script">
              <summary>Show the script</summary>
              <textarea readOnly value={status.script} rows={10} aria-label="Hub script" />
            </details>
          ) : null}

          <button type="button" className="app-button secondary" disabled={checking} onClick={() => void load()}>
            {checking ? "Checking…" : "Check again"}
          </button>
        </>
      ) : null}
    </section>
  );
}
