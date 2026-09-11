"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import {
  CONNECTIONS_RELATED_INCLUDE,
  connectionsRelatedLinks,
} from "../../../lib/account";
import {
  DISCORD_RELATED_INCLUDE,
  discordNextActions,
  discordRelatedLinks,
  formatBridgePostCount,
} from "../../../lib/discord-related";
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

function DiscordRelated({ orgId }: { orgId: string }) {
  const links = discordRelatedLinks(orgId, { include: [...DISCORD_RELATED_INCLUDE] });
  const connectionLinks = connectionsRelatedLinks(orgId, {
    active: "discord",
    include: [...CONNECTIONS_RELATED_INCLUDE],
  });
  return (
    <>
      <nav className="product-hub-related team-discord-related" aria-label="Related team tools">
        {links.map((link) => (
          <Button as="a" variant="secondary" key={link.id} href={link.href}>
            {link.label}
          </Button>
        ))}
      </nav>
      <nav className="product-hub-related team-discord-connections" aria-label="Related connection tools">
        {connectionLinks.map((link) => (
          <Button as="a" variant="secondary" key={link.id} href={link.href}>
            {link.label}
          </Button>
        ))}
      </nav>
    </>
  );
}

function NextActions({
  orgId,
  view,
}: {
  orgId: string;
  view: Pick<
    DiscordView,
    | "configured"
    | "hasWebhook"
    | "channelId"
    | "platformConfigured"
    | "chatBridgeEnabled"
    | "bridgePosts"
  > | null;
}) {
  const actions = discordNextActions({
    orgId,
    configured: view?.configured,
    hasWebhook: view?.hasWebhook,
    channelId: view?.channelId,
    platformConfigured: view?.platformConfigured,
    chatBridgeEnabled: view?.chatBridgeEnabled,
    bridgePostedCount: view?.bridgePosts?.posted ?? null,
  });
  return (
    <section className="team-discord-next-actions app-card soft-panel" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>From real Discord connection and bridge posts only — sync counts stay blank until messages post.</p>
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
  );
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
        ? "Discord connection saved."
        : action === "test"
          ? "Test message posted to Discord."
          : action === "announce"
            ? "Announcement posted to Discord."
            : action === "disconnect"
              ? "Discord disconnected."
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
          description="Link a guild and channel, post announcements, and optionally bridge object-linked team messages."
        />
        <TeamOpsNav orgId={orgId} active="admin" />
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
  const showEmptyShell = view.status === "empty";
  const showSetupShell = view.status === "setup_required";

  return (
    <main className="module-page team-discord-page">
      <PageHeader
        breadcrumbs="Team / Discord"
        title="Discord"
        description="Link a server and channel, post announcements, and optionally mirror Team Messages into Discord."
      >
        <div className="team-discord-header-actions">
          <Button as="a" variant="secondary" href={withOrgHref("/team?tab=messages", orgId)}>
            Messages
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/team", orgId)}>
            Team
          </Button>
        </div>
      </PageHeader>
      <TeamOpsNav orgId={orgId} active="admin" />
      <OfflineBanner feature="Discord" fromCache={fromCache} cachedAt={cachedAt} />
      <DiscordRelated orgId={orgId} />

      {showEmptyShell ? (
        <EmptyState
          soft
          badge="Empty"
          badgeTone="setup"
          title="No Discord channel linked"
          description={view.emptyReason ?? view.message}
        >
          <p className="app-muted">
            Paste a channel webhook below, or set the server and channel IDs once a mentor has added the bot.
            Bridge counts stay blank until a linked Team Message actually posts.
          </p>
        </EmptyState>
      ) : null}

      {showSetupShell ? (
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="Posting path incomplete"
          description={view.message}
        >
          {view.inviteUrl ? (
            <Button as="a" variant="primary" href={view.inviteUrl} target="_blank" rel="noreferrer">
              Open bot invite
            </Button>
          ) : (
            <Button as="a" variant="primary" href={withOrgHref("/team?tab=messages", orgId)}>
              Open Messages
            </Button>
          )}
        </EmptyState>
      ) : null}

      {!view.platformConfigured && view.status === "live" ? (
        <section className="app-card soft-panel team-discord-banner">
          <span className="eyebrow">BOT OPTIONAL</span>
          <h2>Platform Discord bot not configured</h2>
          <p className="app-muted">
            Webhook posting works. Ask a mentor to add the Discord bot on this deployment if you want
            posts by channel id.
          </p>
          {view.inviteUrl ? (
            <Button as="a" variant="secondary" href={view.inviteUrl} target="_blank" rel="noreferrer">
              Open bot invite
            </Button>
          ) : null}
        </section>
      ) : null}

      {view.status === "live" ? <NextActions orgId={orgId} view={view} /> : null}

      <div className="team-discord-layout">
        <form className="app-card soft-panel team-discord-panel" onSubmit={onSave}>
          <span className="eyebrow">GUILD &amp; CHANNEL</span>
          <h2>{view.configured ? "Update connection" : "Link Discord"}</h2>
          <p className="app-muted">
            Paste a channel webhook and/or server and channel IDs (Developer Mode in Discord).
          </p>
          <label>
            Guild (server) id
            <input
              value={form.guildId}
              onChange={(e) => setForm({ ...form, guildId: e.target.value })}
              placeholder="123456789012345678"
              inputMode="numeric"
            />
          </label>
          <label>
            Guild name
            <input
              value={form.guildName}
              onChange={(e) => setForm({ ...form, guildName: e.target.value })}
              placeholder="Team 254"
            />
          </label>
          <label>
            Channel id
            <input
              value={form.channelId}
              onChange={(e) => setForm({ ...form, channelId: e.target.value })}
              placeholder="987654321098765432"
              inputMode="numeric"
            />
          </label>
          <label>
            Channel label
            <input
              value={form.channelLabel}
              onChange={(e) => setForm({ ...form, channelLabel: e.target.value })}
              placeholder="#announcements"
            />
          </label>
          <label>
            Channel webhook URL {view.hasWebhook ? "(leave blank to keep current)" : ""}
            <input
              type="url"
              value={form.webhookUrl}
              onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
              placeholder="https://discord.com/api/webhooks/…"
              autoComplete="off"
            />
          </label>
          <label className="soft-form-row check-field">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            Posting enabled
          </label>
          <label className="soft-form-row check-field">
            <input
              type="checkbox"
              checked={form.chatBridgeEnabled}
              onChange={(e) => setForm({ ...form, chatBridgeEnabled: e.target.checked })}
            />
            Bridge object-linked Team Messages to Discord
          </label>
          <small className="app-muted">
            Only messages with an object link (task, CAD, inventory, …) are mirrored — not a full chat dump.
          </small>
          <div className="team-discord-actions">
            <button className="primary-action" type="submit" disabled={busy}>
              {view.configured ? "Save connection" : "Connect Discord"}
            </button>
            {view.configured ? (
              <>
                <button type="button" disabled={busy || !view.canPost} onClick={() => void run("test")}>
                  Send test
                </button>
                <button type="button" disabled={busy} onClick={() => void run("disconnect")}>
                  Disconnect
                </button>
              </>
            ) : null}
          </div>
        </form>

        <section className="app-card soft-panel team-discord-panel">
          <span className="eyebrow">STATUS</span>
          <h2>
            {view.configured
              ? `${view.guildName || view.channelLabel || "Connected"} · ${view.enabled ? "active" : "off"}`
              : "Not connected"}
          </h2>
          {view.emptyReason && !view.configured ? <p className="app-muted">{view.emptyReason}</p> : null}
          <ul className="team-discord-meta">
            <li>
              <span>Posting path</span>
              <strong>{view.canPost ? "ready" : "setup required"}</strong>
            </li>
            <li>
              <span>Platform bot</span>
              <strong>{view.platformConfigured ? "configured" : "optional / unset"}</strong>
            </li>
            <li>
              <span>Webhook</span>
              <strong>{view.hasWebhook ? "saved" : "none"}</strong>
            </li>
            <li>
              <span>Channel id</span>
              <strong>{view.channelId || "—"}</strong>
            </li>
            <li>
              <span>Chat bridge</span>
              <strong>{view.chatBridgeEnabled ? "on" : "off"}</strong>
            </li>
            <li>
              <span>Bridge posts (real)</span>
              <strong>{formatBridgePostCount(postedCount)}</strong>
            </li>
            <li>
              <span>Bridge failures (real)</span>
              <strong>{formatBridgePostCount(failedCount)}</strong>
            </li>
          </ul>
          {view.configured ? (
            <Button variant="secondary" type="button" disabled={busy || !view.canPost} onClick={() => void run("set-bridge", { chatBridgeEnabled: !view.chatBridgeEnabled })}>
              {view.chatBridgeEnabled ? "Disable chat bridge" : "Enable chat bridge"}
            </Button>
          ) : null}

          <div className="team-discord-announce">
            <span className="eyebrow">POST ANNOUNCEMENT</span>
            <label>
              Title
              <input
                value={announceTitle}
                onChange={(e) => setAnnounceTitle(e.target.value)}
                placeholder="Practice tonight"
              />
            </label>
            <label>
              Message
              <textarea
                value={announceBody}
                onChange={(e) => setAnnounceBody(e.target.value)}
                rows={4}
                placeholder="Shop opens at 5 — bring safety glasses."
              />
            </label>
            <button
              type="button"
              className="primary-action"
              disabled={busy || !announceBody.trim() || !view.configured || !view.canPost}
              onClick={() =>
                void run("announce", { title: announceTitle || "Announcement", message: announceBody }).then(() => {
                  setAnnounceTitle("");
                  setAnnounceBody("");
                })
              }
            >
              Post to Discord
            </button>
          </div>
        </section>
      </div>

      {status ? (
        <p className={ok ? "team-discord-status ok" : "team-discord-status err"} role="status">
          {status}
        </p>
      ) : null}
    </main>
  );
}
