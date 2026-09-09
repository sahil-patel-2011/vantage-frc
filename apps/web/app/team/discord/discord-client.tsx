"use client";

import { FormEvent, useEffect, useState } from "react";
import { EmptyState, PageHeader } from "../../../components/ui";
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
          <a key={link.id} className="app-button secondary" href={link.href}>
            {link.label}
          </a>
        ))}
      </nav>
      <nav className="product-hub-related team-discord-connections" aria-label="Related connection tools">
        {connectionLinks.map((link) => (
          <a key={link.id} className="app-button secondary" href={link.href}>
            {link.label}
          </a>
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
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

  async function load() {
    setFetchFailed(false);
    const response = await fetch(`/api/team/discord?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (!response.ok) {
      setOk(false);
      setStatus(data.error ?? "Unable to load Discord settings");
      setErrorStatus(response.status);
      setView(null);
      setFetchFailed(true);
      return;
    }
    setErrorStatus(null);
    setView(data as DiscordView);
    setForm({
      webhookUrl: "",
      channelLabel: data.channelLabel ?? "",
      guildId: data.guildId ?? "",
      guildName: data.guildName ?? "",
      channelId: data.channelId ?? "",
      enabled: data.enabled ?? true,
      chatBridgeEnabled: data.chatBridgeEnabled ?? false,
    });
    setOk(true);
    setStatus("");
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function run(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    const response = await fetch("/api/team/discord", {
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

  if (fetchFailed || view == null) {
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
        <EmptyState
          soft
          title={failure ? failure.title : "Loading Discord…"}
          description={failure ? failure.description : "Checking your workspace connection."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          ) : null}
          {failure?.showRetry ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
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
        description="Link a guild and channel, post announcements, and optionally bridge object-linked Team Messages — never invented sync stats."
      >
        <div className="team-discord-header-actions">
          <a className="app-button secondary" href={withOrgHref("/team?tab=messages", orgId)}>
            Messages
          </a>
          <a className="app-button secondary" href={withOrgHref("/team", orgId)}>
            Team
          </a>
        </div>
      </PageHeader>
      <TeamOpsNav orgId={orgId} active="admin" />
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
            Paste a channel webhook below, or set guild + channel snowflake IDs once a bot token is on the server.
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
          <ol className="team-discord-setup-steps">
            <li>
              <div>
                <strong>Add a channel webhook</strong>
                <span>Server Settings → Integrations → Webhooks — works without a bot token.</span>
              </div>
            </li>
            <li>
              <div>
                <strong>Or configure the bot</strong>
                <span>
                  Set <code>DISCORD_BOT_TOKEN</code>
                  {view.inviteUrl ? " and invite the bot" : ""} with a channel id for bot posts.
                </span>
              </div>
              {view.inviteUrl ? (
                <a className="app-button secondary" href={view.inviteUrl} target="_blank" rel="noreferrer">
                  Open bot invite
                </a>
              ) : null}
            </li>
            <li>
              <div>
                <strong>Mirror object-linked Messages</strong>
                <span>Enable the chat bridge after posting works — only linked objects post.</span>
              </div>
              <a className="app-button secondary" href={withOrgHref("/team?tab=messages", orgId)}>
                Messages
              </a>
            </li>
          </ol>
        </EmptyState>
      ) : null}

      {!view.platformConfigured && view.status === "live" ? (
        <section className="app-card soft-panel team-discord-banner">
          <span className="eyebrow">BOT OPTIONAL</span>
          <h2>Platform Discord bot not configured</h2>
          <p className="app-muted">
            Webhook posting works. Set <code>DISCORD_BOT_TOKEN</code> (and optionally{" "}
            <code>DISCORD_CLIENT_ID</code>) if you want bot posts by channel id.
          </p>
          {view.inviteUrl ? (
            <a className="app-button secondary" href={view.inviteUrl} target="_blank" rel="noreferrer">
              Open bot invite
            </a>
          ) : null}
        </section>
      ) : null}

      <NextActions orgId={orgId} view={view} />

      <div className="team-discord-layout">
        <form className="app-card soft-panel team-discord-panel" onSubmit={onSave}>
          <span className="eyebrow">GUILD &amp; CHANNEL</span>
          <h2>{view.configured ? "Update connection" : "Link Discord"}</h2>
          <p className="app-muted">
            Paste a channel webhook and/or guild + channel snowflake IDs (Developer Mode in Discord).
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
            <button
              type="button"
              className="app-button secondary"
              disabled={busy || !view.canPost}
              onClick={() => void run("set-bridge", { chatBridgeEnabled: !view.chatBridgeEnabled })}
            >
              {view.chatBridgeEnabled ? "Disable chat bridge" : "Enable chat bridge"}
            </button>
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
