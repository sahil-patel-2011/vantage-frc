"use client";

import { useCallback, useEffect, useState } from "react";
import "../admin-flow.css";

type HubStatus = {
  urlSet: boolean;
  secretSet: boolean;
  configured: boolean;
  check: {
    ok: boolean;
    version: number | null;
    hub: boolean;
    folderUrl: string | null;
    error: string | null;
    updateAvailable?: boolean;
  } | null;
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
  const [connectNote, setConnectNote] = useState("");

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
    // Back from the script's "Connect to Vantage" button: store its address, then check it.
    const params = new URLSearchParams(window.location.search);
    const url = params.get("sheetsHub");
    const ts = params.get("ts");
    const sig = params.get("sig");
    if (!url || !ts || !sig) {
      void load();
      return;
    }
    for (const key of ["sheetsHub", "ts", "sig"]) params.delete(key);
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
    void (async () => {
      try {
        const response = await fetch("/api/admin/sheets-hub", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "register", url, ts, sig }),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string; check?: { ok?: boolean } | null };
        // When the script doesn't answer yet, the status line below says why; don't also claim success.
        if (response.ok && data.check?.ok) setConnectNote("Connected. New and existing teams will get their spreadsheets from this script.");
        else if (response.ok) setConnectNote("Saved the script's address.");
        else setError(data.error ?? "Couldn't connect the script. Open its address again and press Connect.");
      } catch {
        setError("Couldn't reach Vantage. Check your connection, then open the script's address again.");
      }
      await load();
    })();
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
        &ldquo;6925 - Team Name - VantageFRC&rdquo;, laid out like a database: one tab per table, an id column
        first, and a Tables tab listing them all. A &ldquo;VantageFRC - Team index&rdquo; spreadsheet links every
        team. It is created when the team is and updates by itself while people use Vantage. It stays private to this
        Google account; teams are never told where their data is copied.
      </p>

      {error ? <p role="alert">{error}</p> : null}
      {connectNote && !error ? (
        <p role="status" className="sheets-hub-ok">
          {connectNote}
        </p>
      ) : null}
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
                    ? "Almost there. Deploy the script below, then open it once and press Connect to Vantage."
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

          {working && status.check?.updateAvailable ? (
            <p className="app-muted">
              A newer script is ready: it lays each team&rsquo;s spreadsheet out as a database and keeps the team index.
              Paste it over the old one and deploy a new version (Deploy → Manage deployments → Edit → New version), so
              the address stays the same.
            </p>
          ) : null}

          {(!working || status.check?.updateAvailable) && status.script ? (
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
                Open the web app address once (it ends in <code>/exec</code>) and press{" "}
                <strong>Connect to Vantage</strong>. It brings you back here, connected.
              </li>
            </ol>
          ) : null}

          {(!working || status.check?.updateAvailable) && status.script ? (
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
