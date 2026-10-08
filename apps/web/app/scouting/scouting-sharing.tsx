"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import "./scouting-sharing.css";

type Settings = { enabled: boolean; canManage: boolean };
export function ScoutingSharing({ orgId }: { orgId: string }) {
  return <TeamScoutingSharing key={orgId} orgId={orgId} />;
}

function TeamScoutingSharing({ orgId }: { orgId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setSettings(null);
    setError("");
    void fetch("/api/scouting/sharing?orgId=" + encodeURIComponent(orgId), {
      cache: "no-store",
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load scouting sharing.");
        return response.json() as Promise<Settings>;
      })
      .then((value) => {
        if (!cancelled) setSettings(value);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "Could not load scouting sharing. Connect and retry to check its current status.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, reload]);
  async function toggle() {
    if (!settings || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/scouting/sharing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, enabled: !settings.enabled }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error();
      setSettings((await response.json()) as Settings);
    } catch {
      setSettings(null);
      setError(
        "Could not confirm the change. Retry to check the server before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="scout-sharing-card" aria-label="Scouting sharing">
      <div>
        <h3>Scouting network</h3>
        <p>
          {settings
            ? settings.enabled
              ? "Sharing is on for your team."
              : "Sharing is off for your team."
            : error ? "Sharing status could not be confirmed." : "Checking your team’s sharing setting…"}
        </p>
        <details>
          <summary data-disclosure>What is shared?</summary>
          <p className="app-muted">
            Past and new match observations are available to other signed-in
            Vantage teams while sharing is on. Scout identities, free text,
            private notes, and action histories stay with your team. Team owners,
            admins, and members with scouting management access can change this setting.
          </p>
        </details>
      </div>
      {settings?.canManage ? (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => void toggle()}
        >
          {busy
            ? "Saving…"
            : settings.enabled
              ? "Turn sharing off"
              : "Turn sharing on"}
        </Button>
      ) : null}
      {error ? (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            Retry
          </button>
        </p>
      ) : null}
    </section>
  );
}
