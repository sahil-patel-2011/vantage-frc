"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, TextField, TextareaField } from "../../components/ui";
import {
  appsScriptSource,
  isAppsScriptSecret,
  isAppsScriptUrl,
  newAppsScriptSecret,
} from "../../lib/google-sheets/apps-script-source";

/**
 * Connect the Google Sheets copy with no Google Cloud project: the owner pastes a small
 * script into their own spreadsheet, deploys it as a web app, and gives Vantage its address
 * and secret. The script (and a fresh secret) is built here in the browser; the secret only
 * reaches the server when the owner presses Connect, and is stored encrypted.
 */
export default function AppsScriptConnect({
  orgId,
  open,
  mode = "connect",
  onConnected,
}: {
  orgId: string;
  open?: boolean;
  /** "update": an already-connected team gets the newest script with its current secret. */
  mode?: "connect" | "update";
  onConnected: (text: string) => void;
}) {
  const [secret, setSecret] = useState("");
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  // Keep signing credentials only in this mounted form. Remove the old browser
  // copy without reading it; existing encrypted server connections stay intact.
  useEffect(() => {
    try {
      window.localStorage.removeItem(`vantage.appsScriptSecret.${orgId}`);
    } catch { /* Storage can be blocked. */ }
    setSecret(mode === "update" ? "" : newAppsScriptSecret());
    setUrl(""); setCopied(false); setError(null);
  }, [orgId, mode]);

  const cleanSecret = secret.trim().toLowerCase();
  const secretOk = isAppsScriptSecret(cleanSecret);
  const urlOk = isAppsScriptUrl(url);
  const source = useMemo(() => (secretOk ? appsScriptSource(cleanSecret) : ""), [secretOk, cleanSecret]);

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Could not copy automatically. Select the script text and copy it.");
    }
  }

  async function connect() {
    if (submitting.current || !urlOk || !secretOk) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/google/apps-script", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, url: url.trim(), secret: cleanSecret }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; name?: string | null };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "Could not connect the Apps Script. Try again.");
      } else {
        onConnected(`Connected to ${data.name ? `“${data.name}”` : "your spreadsheet"} through Apps Script. Sync to fill it.`);
      }
    } catch {
      setError("Could not reach Vantage. Check your connection and try again.");
    }
    submitting.current = false;
    setBusy(false);
  }

  if (mode === "update") {
    return (
      <details className="mirror-setup apps-script-connect" open={open}>
        <summary>Get the latest script (adds photos and videos)</summary>
        <ol>
          <li>Check the secret below matches the one at the top of your script (paste it in if this box is empty).</li>
          <li>Copy the script, open your spreadsheet&apos;s Extensions → Apps Script, replace everything and save.</li>
          <li>
            <strong>Deploy → Manage deployments</strong>, press the pencil, set Version to <strong>New version</strong>, then
            Deploy. Google asks once to allow Drive. The web app address stays the same.
          </li>
        </ol>
        <div className="apps-script-fields">
          <TextField
            label="Secret"
            help="The secret at the top of your current script."
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            error={secret && !secretOk ? "The secret is 64 letters and digits (0–9, a–f)." : undefined}
            spellCheck={false}
            autoComplete="off"
            wide
          />
          <TextareaField
            label="Script"
            value={source}
            readOnly
            rows={6}
            spellCheck={false}
            onFocus={(event) => event.currentTarget.select()}
            wide
          />
          <div className="connector-actions">
            <Button variant="secondary" size="sm" type="button" disabled={!source} onClick={() => void copyScript()}>
              {copied ? "Copied" : "Copy script"}
            </Button>
          </div>
        </div>
        {error ? (
          <p className="connector-message" role="alert">
            {error}
          </p>
        ) : null}
      </details>
    );
  }

  return (
    <details className="mirror-setup apps-script-connect" open={open}>
      {/* The card is already titled Google Sheets; this says how, and how long. */}
      <summary>Connect with Apps Script (about 5 minutes)</summary>
      <ol className="apps-script-steps">
        <li>
          Open the Google spreadsheet to keep up to date (or make a new one), then choose{" "}
          <strong>Extensions → Apps Script</strong>.
        </li>
        <li>
          Press <strong>Copy script</strong> below, replace everything in the Apps Script editor with it, and save.
          <div className="connector-actions">
            <Button variant="secondary" size="sm" type="button" disabled={!source} onClick={() => void copyScript()}>
              {copied ? "Copied" : "Copy script"}
            </Button>
          </div>
        </li>
        <li>
          Choose <strong>Deploy → New deployment</strong>. Set the type to <strong>Web app</strong>, Execute as{" "}
          <strong>Me</strong>, and Who has access to <strong>Anyone</strong>. Press Deploy and allow access.
        </li>
        <li>
          Copy the <strong>Web app URL</strong> Google shows (it ends in <code>/exec</code>), paste it below and press
          Connect.
        </li>
      </ol>
      <div className="apps-script-fields">
        <p className="app-muted">This draft secret lasts while this page is open. If you already copied a script, paste its secret under Advanced before connecting.</p>
        <TextField
          label="Web app URL"
          placeholder="e.g. https://script.google.com/macros/s/…/exec"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          error={url && !urlOk ? "Use the address that starts with https://script.google.com/macros/s/ and ends with /exec." : undefined}
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          wide
        />
      </div>
      {error ? (
        <p className="connector-message" role="alert">
          {error}
        </p>
      ) : null}
      <div className="connector-actions">
        <Button variant="primary" size="sm" type="button" disabled={busy || !urlOk || !secretOk} onClick={() => void connect()}>
          {busy ? "Checking the script…" : "Connect"}
        </Button>
      </div>
      {/* The secret is built into the copied script; most people never need to see it. */}
      <details className="apps-script-advanced">
        <summary data-disclosure>Advanced: script text and secret</summary>
        <p className="app-muted">
          &quot;Anyone&quot; only lets the address be called: the script refuses every request that isn&apos;t signed
          with this secret, and it only touches this spreadsheet and your team&apos;s media folder.
        </p>
        <TextField
          label="Secret"
          help="Already set up the script before? Paste the secret from the top of it instead."
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          error={secret && !secretOk ? "The secret is 64 letters and digits (0–9, a–f)." : undefined}
          spellCheck={false}
          autoComplete="off"
          wide
        />
        <TextareaField
          label="Script"
          value={source}
          readOnly
          rows={6}
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          wide
        />
      </details>
    </details>
  );
}
