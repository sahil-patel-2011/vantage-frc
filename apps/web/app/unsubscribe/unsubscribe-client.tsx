"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";

type Status = "loading" | "ok" | "error";

export default function UnsubscribeClient({
  token,
  category,
}: {
  token: string;
  category: string;
}) {
  const [status, setStatus] = useState<Status>(token ? "loading" : "error");
  const [message, setMessage] = useState(token ? "Updating your email preferences…" : "Missing unsubscribe token.");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/notifications/unsubscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, category: category || "all" }),
      });
      const data = (await response.json()) as { error?: string; category?: string };
      if (cancelled) return;
      if (!response.ok) {
        setStatus("error");
        setMessage(data.error ?? "Could not unsubscribe.");
        return;
      }
      setStatus("ok");
      setMessage(
        data.category === "all"
          ? "You are unsubscribed from all Vantage opt-in emails."
          : `You are unsubscribed from ${String(data.category).replaceAll("_", " ")} emails.`,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [token, category]);

  return (
    <main className="module-page unsubscribe-page">
      <PageHeader
        breadcrumbs="Account / Email"
        title="Email preferences"
        description="One-click unsubscribe for opt-in Vantage emails. Auth and security messages are never controlled here."
      />

      <Panel className="account-panel">
        {status === "loading" ? (
          <EmptyState soft title="Working…" description={message} aria-busy />
        ) : (
          <EmptyState
            soft
            badge={status === "ok" ? "Updated" : "Error"}
            badgeTone={status === "ok" ? "good" : "setup"}
            title={status === "ok" ? "Preferences updated" : "Could not unsubscribe"}
            description={message}
          >
            <div className="settings-inline-links">
              <a className="app-button secondary" href="/notifications/preferences">
                Manage email opt-ins
              </a>
              <a className="app-button secondary" href="/account?tab=notifications">
                Account alerts
              </a>
            </div>
          </EmptyState>
        )}
      </Panel>
    </main>
  );
}
