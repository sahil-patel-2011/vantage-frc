"use client";

import { useEffect, useState } from "react";
import { Button } from "../../components/ui";
import {
  readPushClientState,
  subscribeToPush,
  unsubscribeFromPush,
  type PushClientState,
} from "../../lib/push/client";

/**
 * Web-push registration for THIS browser. Rendered by state, never as a single
 * hopeful button: unsupported / iOS-not-installed / denied / server-unconfigured
 * each show their honest reason as text instead of a dead control.
 */
export function PushDevicePanel({ orgId }: { orgId: string | null }) {
  const [push, setPush] = useState<PushClientState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void readPushClientState().then((state) => {
      if (!cancelled) setPush(state);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    setPush(await readPushClientState());
  }

  async function enable() {
    setPushBusy(true);
    setPushError("");
    try {
      const result = await subscribeToPush(orgId ?? undefined);
      if (!result.ok) setPushError(result.reason);
    } finally {
      await refresh();
      setPushBusy(false);
    }
  }

  async function disable() {
    setPushBusy(true);
    setPushError("");
    try {
      await unsubscribeFromPush();
    } finally {
      await refresh();
      setPushBusy(false);
    }
  }

  return (
    <>
      <h2 className="account-prefs-heading">This device</h2>
      <p className="app-muted">
        Push notifications reach this browser even when the tab is closed. Each device is registered
        separately.
      </p>
      {push === null ? <p className="app-muted">Checking this browser…</p> : null}
      {push && (push.state === "unsupported" || push.state === "ios_needs_home_screen" || push.state === "denied" || push.state === "setup_required") ? (
        <p className="app-muted">{push.reason}</p>
      ) : null}
      {push?.state === "available" ? (
        <div className="account-actions">
          <Button variant="primary" type="button" disabled={pushBusy} onClick={() => void enable()}>
            Turn on push for this device
          </Button>
        </div>
      ) : null}
      {push?.state === "subscribed" ? (
        <div className="account-actions">
          <p style={{ margin: 0 }}>Push is on for this device.</p>
          <Button variant="secondary" type="button" disabled={pushBusy} onClick={() => void disable()}>
            Turn off
          </Button>
        </div>
      ) : null}
      {pushError ? (
        <p className="app-muted" role="alert">
          {pushError}
        </p>
      ) : null}
    </>
  );
}
