"use client";

import { useEffect, useState } from "react";

/**
 * Asks for an optional model note after the statistical card is already on screen.
 * When `enabled` is false this renders nothing and does not fetch.
 */
export function PredictionFollowup({
  enabled,
  orgId,
  matchKey,
}: {
  enabled: boolean;
  orgId?: string;
  matchKey?: string;
}) {
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !orgId || !matchKey) return;
    const controller = new AbortController();
    const handle = window.setTimeout(() => {
      void fetch("/api/strategy/prediction-note", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, matchKey }),
        signal: controller.signal,
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { note?: unknown } | null) => {
          if (typeof body?.note === "string" && body.note.trim()) setNote(body.note.trim());
        })
        .catch(() => undefined);
    }, 0);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [enabled, orgId, matchKey]);

  if (!note) return null;
  return <p className="app-muted">{note}</p>;
}
