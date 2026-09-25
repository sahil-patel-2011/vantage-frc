"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import "../discord/discord.css";

type SlackView = {
  status: "empty" | "setup_required" | "live";
  orgId: string;
  configured: boolean;
  canPost: boolean;
  inboundReady: boolean;
  /** Absolute Request URL to register in Slack → Event Subscriptions. */
  eventsUrl: string;
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

function isSlackView(value: unknown): value is SlackView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "empty" || status === "setup_required" || status === "live";
}

async function persistSlackSnapshot(orgId: string, data: SlackView): Promise<void> {
  const cacheOrg = data.orgId.trim() || orgId;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("slack", cacheOrg, data);
  } catch {
    // Live Slack already painted; IndexedDB is best-effort.
  }
}

function formFromView(data: SlackView) {
  return {
    webhookUrl: "",
    signingSecret: "",
    channelLabel: data.channelLabel ?? "",
    workspaceId: data.workspaceId ?? "",
    workspaceName: data.workspaceName ?? "",
    channelId: data.channelId ?? "",
    enabled: data.enabled ?? true,
    chatBridgeEnabled: data.chatBridgeEnabled ?? true,
  };
}

export default function TeamSlackClient({ orgId }: { orgId: string }) {
  const [view, setView] = useState<SlackView | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<SlackView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<SlackView>("slack", orgId);
      if (!viewRef.current && cached?.data && isSlackView(cached.data)) {
        setView(cached.data);
        setForm(formFromView(cached.data));
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      const response = await fetch(`/api/team/slack?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      const errorMessage =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "";
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setOk(false);
        setStatus(errorMessage || "Unable to load Slack settings");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      if (!response.ok || !isSlackView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setOk(false);
          setStatus("Could not refresh Slack. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setOk(false);
        setStatus(errorMessage || "Unable to load Slack settings");
        setErrorStatus(response.status);
        setView(null);
        setFetchFailed(true);
        return;
      }
      setErrorStatus(null);
      setView(data);
      setForm(formFromView(data));
      setFromCache(false);
      setCachedAt(null);
      setOk(true);
      setStatus("");
      await persistSlackSnapshot(orgId, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setOk(false);
        setStatus("Could not refresh Slack. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setOk(false);
      setStatus("Unable to load Slack settings");
      setView(null);
      setFetchFailed(true);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const response = await fetch("/api/team/slack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action, ...extra }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
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
        ? "Saved. Press Send test to check it."
        : action === "test"
          ? "Test message sent. Check the channel in Slack."
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

  const channelName = view?.channelLabel || view?.workspaceName || "your Slack channel";

  // Laid out like Discord: one card with numbered steps and one field. The page had three rows
  // of links, a "Slack is optional" card whose only button left, and a bare 23px input.
  const connectForm = view ? (
    <form className="team-discord-connect" onSubmit={onSave}>
      <ol className="team-discord-steps">
        <li>
          In Slack, open{" "}
          <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">
            api.slack.com/apps
          </a>{" "}
          and press <strong>Create New App → From scratch</strong>. Pick your team&apos;s workspace.
        </li>
        <li>
          Choose <strong>Incoming Webhooks</strong>, turn it on, press <strong>Add New Webhook</strong> and pick the
          channel.
        </li>
        <li>Copy the webhook URL, paste it below and press Save.</li>
      </ol>
      <label>
        Channel webhook link
        <input
          type="url"
          autoComplete="off"
          value={form.webhookUrl}
          onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })}
          placeholder={view.hasWebhook ? "Saved — paste a new link to change it" : "e.g. https://hooks.slack.com/services/…"}
          required={!view.hasWebhook}
        />
      </label>
      <label>
        Channel name (optional)
        <input
          value={form.channelLabel}
          onChange={(event) => setForm({ ...form, channelLabel: event.target.value })}
          placeholder="e.g. #team-chat"
        />
      </label>
      <details className="team-discord-advanced">
        <summary>More options</summary>
        <label className="soft-form-row check-field">
          <input
            type="checkbox"
            checked={form.chatBridgeEnabled}
            onChange={(event) => setForm({ ...form, chatBridgeEnabled: event.target.checked })}
          />
          Copy team chat to Slack, and Slack replies back to team chat
        </label>
        <p className="app-muted">
          Replies from Slack need a little more from whoever made the Slack app: the ids and signing secret below, and
          Event Subscriptions pointed at <code className="slack-events-url">{view.eventsUrl ?? "…"}</code> with{" "}
          <code>message.channels</code>.
        </p>
        <label>
          Workspace id (starts with T)
          <input
            value={form.workspaceId}
            onChange={(event) => setForm({ ...form, workspaceId: event.target.value })}
            placeholder="e.g. T012ABCDEF"
          />
        </label>
        <label>
          Channel id (starts with C)
          <input
            value={form.channelId}
            onChange={(event) => setForm({ ...form, channelId: event.target.value })}
            placeholder="e.g. C012ABCDEF"
          />
        </label>
        <label>
          Signing secret
          <input
            type="password"
            autoComplete="off"
            value={form.signingSecret}
            onChange={(event) => setForm({ ...form, signingSecret: event.target.value })}
            placeholder={view.hasSigningSecret ? "Saved — paste to replace" : "From the Slack app's Basic Information"}
          />
        </label>
        {view.bridgePostLabel ? <p className="app-muted">Copied so far: {view.bridgePostLabel}</p> : null}
      </details>
      <div className="team-discord-actions">
        <Button variant={view.configured ? "secondary" : "primary"} type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  ) : null;

  return (
    <main className="module-page team-discord-page">
      <PageHeader
        breadcrumbs="Team / Slack"
        title="Slack"
        description="Post team announcements and chat to a Slack channel."
      >
        <nav className="team-admin-settings-links" aria-label="Related team tools">
          <a href={withOrgHref("/connectors", orgId)}>‹ Connectors</a>
          <a href={withOrgHref("/team?tab=messages", orgId)}>Team chat</a>
        </nav>
      </PageHeader>
      <OfflineBanner feature="Slack" fromCache={fromCache} cachedAt={cachedAt} />

      {status ? (
        <p className={ok ? "team-discord-status ok" : "team-discord-status err"} role="status">
          {status}
        </p>
      ) : null}

      {failure && !view ? (
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
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      ) : null}

      {!view && !fetchFailed ? <p className="app-muted">Loading Slack settings…</p> : null}

      {view?.configured ? (
        <section className="app-card soft-panel team-discord-panel">
          <h2>
            {view.canPost && view.enabled
              ? `Posting to ${channelName}`
              : view.canPost
                ? `Connected to ${channelName} — posting is paused`
                : `Saved, but Slack can't post to ${channelName} yet`}
          </h2>
          {!view.canPost ? <p className="app-muted">Paste the channel&apos;s webhook link below to finish.</p> : null}
          <div className="team-discord-actions">
            <Button variant="secondary" type="button" disabled={busy || !view.hasWebhook} onClick={() => void run("test")}>
              Send test
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Disconnect Slack? Vantage stops posting to the channel.")) void run("disconnect");
              }}
            >
              Disconnect
            </Button>
          </div>
        </section>
      ) : null}

      {view?.configured ? (
        <details className="app-card soft-panel team-discord-panel team-discord-change" open={!view.canPost}>
          <summary>Change channel or settings</summary>
          {connectForm}
        </details>
      ) : view ? (
        <section className="app-card soft-panel team-discord-panel">
          <h2>Connect a Slack channel</h2>
          <p className="app-muted">
            Optional: team chat works without it. Takes about two minutes, and you need to be able to add apps to your
            Slack workspace.
          </p>
          {connectForm}
        </section>
      ) : null}
    </main>
  );
}
