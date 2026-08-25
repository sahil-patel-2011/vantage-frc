"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { VantageLogo } from "../../components/brand";
import "./desktop-link.css";

type PreviewResponse = {
  status?: "pending" | "approved" | "expired" | "unknown";
  machineName?: string;
  expiresAt?: string;
  error?: string;
};

type Phase =
  | { kind: "enter" } // no / unusable code yet — manual entry
  | { kind: "loading" }
  | { kind: "ready"; machineName: string; expiresAt: string | null }
  | { kind: "already-approved"; machineName: string | null }
  | { kind: "expired" }
  | { kind: "unknown" }
  | { kind: "approving"; machineName: string }
  | { kind: "done"; machineName: string }
  | { kind: "error"; message: string };

function formatCodeInput(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return cleaned.length > 4 ? `${cleaned.slice(0, 4)}-${cleaned.slice(4)}` : cleaned;
}

function Countdown({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");
  return (
    <p className="desktop-link-countdown" role="timer">
      {remaining > 0 ? `Code expires in ${minutes}:${seconds}` : "This code has expired."}
    </p>
  );
}

export default function DesktopLinkClient() {
  const params = useSearchParams();
  const urlCode = params.get("code")?.trim() ?? "";
  const [code, setCode] = useState(() => formatCodeInput(urlCode));
  const [input, setInput] = useState(() => formatCodeInput(urlCode));
  const [phase, setPhase] = useState<Phase>({ kind: urlCode ? "loading" : "enter" });

  const lookup = useCallback(async (candidate: string) => {
    setPhase({ kind: "loading" });
    try {
      const response = await fetch("/api/desktop/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: candidate }),
      });
      const data = (await response.json()) as PreviewResponse;
      if (!response.ok) {
        setPhase({ kind: "error", message: data.error ?? "Could not check that code. Try again." });
        return;
      }
      if (data.status === "pending" && data.machineName) {
        setPhase({ kind: "ready", machineName: data.machineName, expiresAt: data.expiresAt ?? null });
      } else if (data.status === "approved") {
        setPhase({ kind: "already-approved", machineName: data.machineName ?? null });
      } else if (data.status === "expired") {
        setPhase({ kind: "expired" });
      } else {
        setPhase({ kind: "unknown" });
      }
    } catch {
      setPhase({ kind: "error", message: "Could not check that code. Check your connection and try again." });
    }
  }, []);

  useEffect(() => {
    if (code) void lookup(code);
  }, [code, lookup]);

  async function approve(machineName: string) {
    setPhase({ kind: "approving", machineName });
    try {
      const response = await fetch("/api/desktop/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = (await response.json()) as { success?: boolean; machineName?: string; error?: string };
      if (!response.ok || !data.success) {
        setPhase({ kind: "error", message: data.error ?? "Approval failed. Start again from the desktop app." });
        return;
      }
      setPhase({ kind: "done", machineName: data.machineName ?? machineName });
    } catch {
      setPhase({ kind: "error", message: "Approval failed. Check your connection and try again." });
    }
  }

  const showEntry =
    phase.kind === "enter" || phase.kind === "unknown" || phase.kind === "expired" || phase.kind === "error";

  return (
    <main className="onboarding-page desktop-link-page">
      <section className="onboarding-card desktop-link-card" aria-labelledby="desktop-link-title">
        <header className="desktop-link-header">
          <div className="onboarding-brand">
            <VantageLogo />
          </div>
          <span>DESKTOP SIGN-IN</span>
          <h1 id="desktop-link-title">
            {phase.kind === "done"
              ? "Desktop approved"
              : phase.kind === "ready" || phase.kind === "approving"
                ? "Approve this computer?"
                : "Approve a desktop sign-in"}
          </h1>
        </header>

        {phase.kind === "loading" ? (
          <p className="onboarding-sub" role="status">
            Checking this code…
          </p>
        ) : null}

        {(phase.kind === "ready" || phase.kind === "approving") && (
          <>
            <div className="desktop-link-machine" aria-label="Computer requesting sign-in">
              <span>COMPUTER</span>
              <strong>{phase.machineName}</strong>
              <span>CODE</span>
              <strong className="desktop-link-code">{code}</strong>
            </div>
            {phase.kind === "ready" && phase.expiresAt ? <Countdown expiresAt={phase.expiresAt} /> : null}
            <p className="desktop-link-warning">
              Only approve if this code matches the one on that computer&apos;s screen. Approving signs the
              Vantage desktop app in as <strong>you</strong>. If you didn&apos;t request this, close this page —
              the code expires on its own.
            </p>
            <div className="desktop-link-actions">
              <button
                type="button"
                className="signin-submit"
                disabled={phase.kind === "approving"}
                onClick={() => void approve(phase.machineName)}
              >
                {phase.kind === "approving" ? "Approving…" : "Approve sign-in"}
              </button>
            </div>
          </>
        )}

        {phase.kind === "done" ? (
          <p className="desktop-link-success" role="status">
            <strong>{phase.machineName}</strong> is approved. Go back to the Vantage desktop app — it signs
            in by itself within a few seconds. You can close this tab.
          </p>
        ) : null}

        {phase.kind === "already-approved" ? (
          <p className="onboarding-sub" role="status">
            This code was already used{phase.machineName ? ` for ${phase.machineName}` : ""}. If the desktop
            app is not signed in, start again from the app.
          </p>
        ) : null}

        {phase.kind === "expired" ? (
          <p className="onboarding-sub" role="status">
            That code expired. Start again from the desktop app, then enter the new code here.
          </p>
        ) : null}

        {phase.kind === "unknown" ? (
          <p className="onboarding-sub" role="status">
            That code doesn&apos;t match a waiting desktop sign-in. Check it against the desktop app&apos;s
            screen and try again.
          </p>
        ) : null}

        {phase.kind === "error" ? (
          <p className="desktop-link-error" role="alert">
            {phase.message}
          </p>
        ) : null}

        {showEntry ? (
          <form
            className="desktop-link-entry"
            onSubmit={(event) => {
              event.preventDefault();
              const formatted = formatCodeInput(input);
              setInput(formatted);
              if (formatted.replace("-", "").length === 8) setCode(formatted);
            }}
          >
            <label htmlFor="desktop-link-code-input">Code from the desktop app</label>
            <input
              id="desktop-link-code-input"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="ABCD-EFGH"
              value={input}
              onChange={(event) => setInput(formatCodeInput(event.target.value))}
            />
            <button type="submit" className="signin-submit" disabled={input.replace("-", "").length !== 8}>
              Check code
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
