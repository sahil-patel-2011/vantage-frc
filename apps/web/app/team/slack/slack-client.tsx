"use client";

import { FormEvent, useEffect, useState } from "react";
import { EmptyState, PageHeader } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import { slackNextActions, slackRelatedLinks } from "../../../lib/slack-related";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import "../discord/discord.css";

type SlackView = {
  status: "empty" | "setup_required" | "live";
  orgId: string;
  configured: boolean;
  canPost: boolean;
  inboundReady: boolean;
  message: string;
  channelLabel: string | null;
  enabled: boolean;
  workspaceId: string | null;
  workspaceName: string | null;
  channelId: string | null;
  chatBridgeEnabled: boolean;
  hasWebhook: boolean;
  hasSigningSecret: boolean;
  empty: boolean;
  emptyReason: string | null;
  bridgePostLabel: string | null;
};

const emptyForm = {
  webhookUrl: "",
  signingSecret: "",
  channelLabel: "",
  workspaceId: "",
  workspaceName: "",
  channelId: "",
  enabled: true,
  chatBridgeEnabled: true,
};

export default function TeamSlackClient({ orgId }: { orgId: string }) {
  const [view, setView] = useState<SlackView | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  async function load() {
    setFetchFailed(false);
    const response = await fetch(`/api/team/slack?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (!response.ok) {
      setOk(false);
      setStatus(data.error ?? "Unable to load Slack settings");
      setErrorStatus(response.status);
      setView(null);
      setFetchFailed(true);
      return;
    }
    setErrorStatus(null);
    setView(data as SlackView);
    setForm({
      webhookUrl: "",
      signingSecret: "",
      channelLabel: data.channelLabel ?? "",
      workspaceId: data.workspaceId ?? "",
      workspaceName: data.workspaceName ?? "",
      channelId: data.channelId ?? "",
      enabled: data.enabled ?? true,
      chatBridgeEnabled: data.chatBridgeEnabled ?? true,
    });
    setOk(true);
    setStatus("");
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const response = await fetch("/api/team/slack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action, ...extra }),
    });
    const data = await response.json();
    setBusy(false);
    setOk(response.ok);
    if (!response.ok) {
      setStatus(data.error ?? "Request failed");
      return;
    }
    setStatus(
      action === "save"
        ? "Slack connection saved."
        : action === "test"
          ? "Test message posted to Slack."
          : action === "disconnect"
            ? "Slack disconnected."
            : action === "set-bridge"
              ? extra.chatBridgeEnabled
                ? "Chat bridge enabled."
                : "Chat bridge disabled."
              : "Done.",
    );
    await load();
  }

  function onSave(event: FormEvent) {
    event.preventDefault();
    void run("save", {
      webhookUrl: form.webhookUrl.trim() || undefined,
      signingSecret: form.signingSecret.trim() || undefined,
      channelLabel: form.channelLabel,
      workspaceId: form.workspaceId,
      workspaceName: form.workspaceName,
      channelId: form.channelId,
      enabled: form.enabled,
      chatBridgeEnabled: form.chatBridgeEnabled,
    });
  }

  const actions = slackNextActions({
    orgId,
    configured: view?.configured,
    hasWebhook: view?.hasWebhook,
    chatBridgeEnabled: view?.chatBridgeEnabled,
    inboundReady: view?.inboundReady,
  });
  const related = slackRelatedLinks(orgId);
  const failure = fetchFailed
    ? loadFailureCopy(
        classifyLoadFailure({
          status: errorStatus,
          message: status,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
        }),
        {
          nextPath:
            typeof window === "undefined"
              ? null
              : `${window.location.pathname}${window.location.search}`,
          message: status || "Try again from Team admin.",
        },
      )
    : null;

  return (
    <main className="module-page team-discord-page">
      <PageHeader
        breadcrumbs="Team / Slack"
        title="Slack"
        description="Keep Vantage team chat and Slack on the same thread. Messages stay in this workspace only."
      />
      <TeamOpsNav active="admin" />
      <nav className="product-hub-related team-discord-related" aria-label="Related team tools">
        {related.map((link) => (
          <a key={link.id} className="app-button secondary" href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>

      {failure ? (
        <EmptyState
          title={failure.title}
          description={failure.description}
          badge={
            failure.kind === "auth"
              ? "Signed out"
              : failure.kind === "forbidden"
                ? "No access"
                : failure.kind === "offline"
                  ? "Offline"
                  : "Error"
          }
          badgeTone="setup"
        >
          {failure.primary ? (
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          ) : null}
          {failure.showRetry ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      ) : null}

      {!view && !fetchFailed ? <p className="app-muted">Loading Slack settings…</p> : null}

      {view?.empty ? (
        <EmptyState
          title="Slack is optional"
          description={view.emptyReason ?? "Team chat in Vantage works on its own. Connect Slack if you want both sides synced."}
          badge="Not connected"
          badgeTone="setup"
        >
          <a className="app-button" href={withOrgHref("/team?tab=messages", orgId)}>
            Open team chat
          </a>
        </EmptyState>
      ) : null}

      <form className="app-card team-discord-panel" onSubmit={onSave}>
        <h2>Connect Slack</h2>
        <label>
          Incoming webhook URL
          <input
            type="password"
            autoComplete="off"
            value={form.webhookUrl}
            onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })}
            placeholder={view?.hasWebhook ? "Saved — paste to replace" : "https://hooks.slack.com/services/…"}
          />
        </label>
        <label>
          Workspace id (T…)
          <input
            value={form.workspaceId}
            onChange={(event) => setForm({ ...form, workspaceId: event.target.value })}
            placeholder="T012ABCDEF"
          />
        </label>
        <label>
          Channel id (C…)
          <input
            value={form.channelId}
            onChange={(event) => setForm({ ...form, channelId: event.target.value })}
            placeholder="C012ABCDEF"
          />
        </label>
        <label>
          Channel label
          <input
            value={form.channelLabel}
            onChange={(event) => setForm({ ...form, channelLabel: event.target.value })}
            placeholder="#team-chat"
          />
        </label>
        <label>
          Event signing secret (optional if SLACK_SIGNING_SECRET is set on the server)
          <input
            type="password"
            autoComplete="off"
            value={form.signingSecret}
            onChange={(event) => setForm({ ...form, signingSecret: event.target.value })}
            placeholder={view?.hasSigningSecret ? "Saved — paste to replace" : "Slack app signing secret"}
          />
        </label>
        <label className="account-check">
          <input
            type="checkbox"
            checked={form.chatBridgeEnabled}
            onChange={(event) => setForm({ ...form, chatBridgeEnabled: event.target.checked })}
          />
          Sync team chat both ways
        </label>
        <div className="team-discord-actions">
          <button className="app-button" type="submit" disabled={busy}>
            Save Slack
          </button>
          <button className="app-button secondary" type="button" disabled={busy || !view?.hasWebhook} onClick={() => void run("test")}>
            Send test
          </button>
          <button className="app-button secondary" type="button" disabled={busy || !view?.configured} onClick={() => void run("disconnect")}>
            Disconnect
          </button>
        </div>
        {view?.bridgePostLabel ? <p className="app-muted">Bridge: {view.bridgePostLabel}</p> : null}
        {status ? <p className={ok ? "team-discord-status ok" : "team-discord-status err"}>{status}</p> : null}
        <p className="app-muted">
          Event Request URL: <code>/api/integrations/slack/events</code>. Ignore bot messages so Vantage posts do not loop.
        </p>
      </form>

      <section className="team-discord-next-actions app-card soft-panel" aria-label="Next actions">
        <header>
          <h2>Next actions</h2>
          <p>From this team’s Slack row only — never DEMO sync counts.</p>
        </header>
        <ol>
          {actions.map((action) => (
            <li key={action.id} className={action.primary ? "primary" : undefined}>
              <div>
                <strong>{action.label}</strong>
                <span>{action.detail}</span>
              </div>
              <a className="app-button secondary" href={action.href} aria-label={action.label}>Open</a>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
