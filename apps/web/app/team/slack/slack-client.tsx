"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import { slackNextActions, slackRelatedLinks } from "../../../lib/slack-related";
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
        description="Keep Vantage team chat and Slack on the same thread. Messages stay on this team only."
      />
      <TeamOpsNav active="admin" />
      <OfflineBanner feature="Slack" fromCache={fromCache} cachedAt={cachedAt} />
      <nav className="product-hub-related team-discord-related" aria-label="Related team tools">
        {related.map((link) => (
          <Button as="a" variant="secondary" key={link.id} href={link.href}>
            {link.label}
          </Button>
        ))}
      </nav>

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

      {view?.empty ? (
        <EmptyState
          title="Slack is optional"
          description={view.emptyReason ?? "Team chat in Vantage works on its own. Connect Slack if you want both sides synced."}
          badge="Not connected"
          badgeTone="setup"
        >
          <Button as="a" variant="primary" href={withOrgHref("/team?tab=messages", orgId)}>
            Open team chat
          </Button>
        </EmptyState>
      ) : null}

      {view ? (
        <>
      <form className="app-card team-discord-panel" onSubmit={onSave}>
        <h2>Connect Slack</h2>
        <label>
          Incoming webhook URL
          <input
            type="password"
            autoComplete="off"
            value={form.webhookUrl}
            onChange={(event) => setForm({ ...form, webhookUrl: event.target.value })}
            placeholder={view.hasWebhook ? "Saved — paste to replace" : "https://hooks.slack.com/services/…"}
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
            placeholder={view.hasSigningSecret ? "Saved — paste to replace" : "Slack app signing secret"}
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
          <Button variant="primary" type="submit" disabled={busy}>
            Save Slack
          </Button>
          <Button variant="secondary" type="button" disabled={busy || !view.hasWebhook} onClick={() => void run("test")}>
            Send test
          </Button>
          <Button variant="secondary" type="button" disabled={busy || !view.configured} onClick={() => void run("disconnect")}>
            Disconnect
          </Button>
        </div>
        {view.bridgePostLabel ? <p className="app-muted">Bridge: {view.bridgePostLabel}</p> : null}
        {status ? <p className={ok ? "team-discord-status ok" : "team-discord-status err"}>{status}</p> : null}
        {/* Was a relative path. Slack's Event Subscriptions field rejects one,
            so there was no way to finish inbound setup from what the page told
            you. The absolute URL comes from the server, which knows the
            deployment origin. */}
        <p className="app-muted">
          Event Request URL for Slack → Event Subscriptions:{" "}
          <code className="slack-events-url">{view.eventsUrl ?? "…"}</code>
          {!view.inboundReady
            ? " — inbound replies also need SLACK_SIGNING_SECRET on the deployment, or a per-team signing secret saved above."
            : null}{" "}
          Subscribe to <code>message.channels</code>; Vantage ignores bot messages so its own posts do not loop.
        </p>
      </form>

      <section className="team-discord-next-actions app-card soft-panel" aria-label="Next actions">
        <header>
          <h2>Next actions</h2>
          <p>Each one opens the page where you finish the work.</p>
        </header>
        <ol>
          {actions.map((action) => (
            <li key={action.id} className={action.primary ? "primary" : undefined}>
              <div>
                <strong>{action.label}</strong>
                <span>{action.detail}</span>
              </div>
              <Button as="a" variant="secondary" href={action.href}>
                Open
              </Button>
            </li>
          ))}
        </ol>
      </section>
        </>
      ) : null}
    </main>
  );
}
