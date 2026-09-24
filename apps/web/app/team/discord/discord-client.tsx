"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { formatBridgePostCount } from "../../../lib/discord-related";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import "./discord.css";

type BridgePosts = { posted: number; failed: number } | null;

type DiscordView = {
  status: "empty" | "setup_required" | "live";
  orgId: string;
  setupRequired: boolean;
  platformConfigured: boolean;
  configured: boolean;
  canPost: boolean;
  message: string;
  inviteUrl: string | null;
  channelLabel: string | null;
  enabled: boolean;
  guildId: string | null;
  guildName: string | null;
  channelId: string | null;
  chatBridgeEnabled: boolean;
  hasWebhook: boolean;
  emptyReason: string | null;
  bridgePosts: BridgePosts;
};

const emptyForm = {
  webhookUrl: "",
  channelLabel: "",
  guildId: "",
  guildName: "",
  channelId: "",
  enabled: true,
  chatBridgeEnabled: false,
};

function isDiscordView(value: unknown): value is DiscordView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "empty" || status === "setup_required" || status === "live";
}

function applyDiscordForm(data: DiscordView) {
  return {
    webhookUrl: "",
    channelLabel: data.channelLabel ?? "",
    guildId: data.guildId ?? "",
    guildName: data.guildName ?? "",
    channelId: data.channelId ?? "",
    enabled: data.enabled ?? true,
    chatBridgeEnabled: data.chatBridgeEnabled ?? false,
  };
}

async function persistDiscordSnapshot(orgId: string, data: DiscordView): Promise<void> {
  const cacheOrg = data.orgId.trim() || orgId;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("discord", cacheOrg, data);
  } catch {
    // Live Discord already painted; IndexedDB is best-effort.
  }
}

export default function TeamDiscordClient({ orgId }: { orgId: string }) {
  const [view, setView] = useState<DiscordView | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [announceTitle, setAnnounceTitle] = useState("");
  const [announceBody, setAnnounceBody] = useState("");
  const [status, setStatus] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<DiscordView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<DiscordView>("discord", orgId);
      if (!viewRef.current && cached?.data && isDiscordView(cached.data)) {
        setView(cached.data);
        setForm(applyDiscordForm(cached.data));
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
      const response = await fetch(`/api/team/discord?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setOk(false);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setStatus(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Unable to load Discord settings",
        );
        return;
      }
      if (!response.ok || !isDiscordView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setOk(false);
          setStatus("Could not refresh Discord. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setOk(false);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setStatus(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Unable to load Discord settings",
        );
        return;
      }
      setErrorStatus(null);
      setView(data);
      setForm(applyDiscordForm(data));
      setFromCache(false);
      setCachedAt(null);
      setOk(true);
      setStatus("");
      await persistDiscordSnapshot(orgId, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setOk(false);
        setStatus("Could not refresh Discord. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setOk(false);
      setFetchFailed(true);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const response = await fetch("/api/team/discord", {
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
          ? "Test message sent. Check the channel in Discord."
          : action === "announce"
            ? "Announcement posted to Discord."
            : action === "disconnect"
              ? "Discord disconnected."
              : action === "set-bridge"
                ? extra.chatBridgeEnabled
                  ? "Team chat copying is on."
                  : "Team chat copying is off."
                : "Done.",
    );
    await load();
  }

  function onSave(event: FormEvent) {
    event.preventDefault();
    void run("save", {
      webhookUrl: form.webhookUrl.trim() || undefined,
      channelLabel: form.channelLabel,
      guildId: form.guildId,
      guildName: form.guildName,
      channelId: form.channelId,
      enabled: form.enabled,
      chatBridgeEnabled: form.chatBridgeEnabled,
    });
  }

  if (!view) {
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
            message: status,
          },
        )
      : null;
    return (
      <main className="module-page team-discord-page">
        <PageHeader
          breadcrumbs="Team / Discord"
          title="Discord"
          description="Post team announcements to a Discord channel."
        />
        <OfflineBanner feature="Discord" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading Discord…"}
          description={failure ? failure.description : "Checking your team connection."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  const postedCount = view.bridgePosts?.posted ?? null;
  const failedCount = view.bridgePosts?.failed ?? null;
  const channelName = view.channelLabel || view.guildName || "your Discord channel";

  // One path: paste the channel's webhook link. Server/channel ids and the bot are under Advanced.
  const connectForm = (
    <form className="team-discord-connect" onSubmit={onSave}>
      <ol className="team-discord-steps">
        <li>In Discord, open the channel&apos;s settings (the gear next to its name).</li>
        <li>
          Choose <strong>Integrations → Webhooks → New Webhook</strong>, then press <strong>Copy Webhook URL</strong>.
        </li>
        <li>Paste the link below and press Save.</li>
      </ol>
      <label>
        Channel webhook link
        <input
          type="url"
          value={form.webhookUrl}
          onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
          placeholder={view.hasWebhook ? "Saved — paste a new link to change it" : "e.g. https://discord.com/api/webhooks/…"}
          autoComplete="off"
          required={!view.hasWebhook && !form.channelId}
        />
      </label>
      <label>
        Channel name (optional)
        <input
          value={form.channelLabel}
          onChange={(e) => setForm({ ...form, channelLabel: e.target.value })}
          placeholder="e.g. #announcements"
        />
      </label>
      <details className="team-discord-advanced">
        <summary>Advanced</summary>
        <p className="app-muted">
          Only needed if a mentor added the Vantage bot to your server instead of using a webhook. Turn on Developer
          Mode in Discord to copy these numbers.
        </p>
        <label>
          Server ID
          <input
            value={form.guildId}
            onChange={(e) => setForm({ ...form, guildId: e.target.value })}
            placeholder="e.g. 123456789012345678"
            inputMode="numeric"
          />
        </label>
        <label>
          Server name
          <input
            value={form.guildName}
            onChange={(e) => setForm({ ...form, guildName: e.target.value })}
            placeholder="e.g. Team 254"
          />
        </label>
        <label>
          Channel ID
          <input
            value={form.channelId}
            onChange={(e) => setForm({ ...form, channelId: e.target.value })}
            placeholder="e.g. 987654321098765432"
            inputMode="numeric"
          />
        </label>
        <label className="soft-form-row check-field">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
          />
          Posting is on
        </label>
        <label className="soft-form-row check-field">
          <input
            type="checkbox"
            checked={form.chatBridgeEnabled}
            onChange={(e) => setForm({ ...form, chatBridgeEnabled: e.target.checked })}
          />
          Also copy team chat messages that link to a task, part or file
        </label>
        {view.chatBridgeEnabled && postedCount != null ? (
          <p className="app-muted">
            Copied so far: {formatBridgePostCount(postedCount)}
            {failedCount ? ` · didn't send: ${formatBridgePostCount(failedCount)}` : ""}
          </p>
        ) : null}
        {view.inviteUrl ? (
          <p>
            <a href={view.inviteUrl} target="_blank" rel="noreferrer">
              Add the Vantage bot to your server
            </a>
          </p>
        ) : null}
      </details>
      <div className="team-discord-actions">
        <Button variant={view.configured ? "secondary" : "primary"} type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );

  return (
    <main className="module-page team-discord-page">
      <PageHeader
        breadcrumbs="Team / Discord"
        title="Discord"
        description="Post team announcements to a Discord channel."
      >
        <nav className="team-admin-settings-links" aria-label="Related team tools">
          <a href={withOrgHref("/connectors", orgId)}>‹ Connectors</a>
          <a href={withOrgHref("/team?tab=messages", orgId)}>Team chat</a>
        </nav>
      </PageHeader>
      <OfflineBanner feature="Discord" fromCache={fromCache} cachedAt={cachedAt} />

      {status ? (
        <p className={ok ? "team-discord-status ok" : "team-discord-status err"} role="status">
          {status}
        </p>
      ) : null}

      {view.configured ? (
        <section className="app-card soft-panel team-discord-panel">
          {/* One sentence instead of a status table. */}
          <h2>
            {view.canPost && view.enabled
              ? `Posting to ${channelName}`
              : view.canPost
                ? `Connected to ${channelName} — posting is paused`
                : `Saved, but Discord can't post to ${channelName} yet`}
          </h2>
          {!view.canPost ? (
            <p className="app-muted">Paste the channel&apos;s webhook link below to finish.</p>
          ) : null}
          <div className="team-discord-actions">
            <Button variant="secondary" type="button" disabled={busy || !view.canPost} onClick={() => void run("test")}>
              Send test
            </Button>
            <Button variant="ghost" type="button" disabled={busy} onClick={() => void run("disconnect")}>
              Disconnect
            </Button>
          </div>

          <div className="team-discord-announce">
            <h3>Post an announcement</h3>
            <label>
              Title
              <input
                value={announceTitle}
                onChange={(e) => setAnnounceTitle(e.target.value)}
                placeholder="e.g. Practice tonight"
              />
            </label>
            <label>
              Message
              <textarea
                value={announceBody}
                onChange={(e) => setAnnounceBody(e.target.value)}
                rows={4}
                placeholder="e.g. Shop opens at 5 — bring safety glasses."
              />
            </label>
            <Button
              variant="primary"
              type="button"
              disabled={busy || !announceBody.trim() || !view.canPost}
              onClick={() =>
                void run("announce", { title: announceTitle || "Announcement", message: announceBody }).then(() => {
                  setAnnounceTitle("");
                  setAnnounceBody("");
                })
              }
            >
              Post to Discord
            </Button>
          </div>
        </section>
      ) : null}

      {view.configured ? (
        <details className="app-card soft-panel team-discord-panel team-discord-change" open={!view.canPost}>
          <summary>Change channel or settings</summary>
          {connectForm}
        </details>
      ) : (
        <section className="app-card soft-panel team-discord-panel">
          <h2>Connect a Discord channel</h2>
          <p className="app-muted">Takes about a minute. You need to be able to edit the channel in Discord.</p>
          {connectForm}
        </section>
      )}
    </main>
  );
}
