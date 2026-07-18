"use client";

import { FormEvent, useEffect, useState } from "react";
import { PageHeader } from "../../../components/ui";
import { TeamOpsNav } from "../../../components/team-ops-nav";
import "./discord.css";

type DiscordView = {
  setupRequired: boolean;
  platformConfigured: boolean;
  configured: boolean;
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

export default function TeamDiscordClient({ orgId }: { orgId: string }) {
  const [view, setView] = useState<DiscordView | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [announceTitle, setAnnounceTitle] = useState("");
  const [announceBody, setAnnounceBody] = useState("");
  const [status, setStatus] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch(`/api/team/discord?orgId=${encodeURIComponent(orgId)}`);
    const data = await response.json();
    if (!response.ok) {
      setOk(false);
      setStatus(data.error ?? "Unable to load Discord settings");
      setView(null);
      return;
    }
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

  return (
    <main className="module-page team-discord-page">
      <PageHeader
        breadcrumbs="Team / Discord"
        title="Discord"
        description="Link a guild and channel, post announcements, and optionally bridge object-linked team messages."
      />
      <TeamOpsNav orgId={orgId} active="admin" />

      {view?.setupRequired && (
        <section className="app-card soft-panel team-discord-banner">
          <span className="eyebrow">SETUP REQUIRED</span>
          <h2>Platform Discord bot not configured</h2>
          <p className="app-muted">{view.message}</p>
          <p className="app-muted">
            Set <code>DISCORD_BOT_TOKEN</code> (and optionally <code>DISCORD_CLIENT_ID</code>) on the server. You can
            still paste a channel webhook below for announcements.
          </p>
          {view.inviteUrl && (
            <a className="app-button secondary" href={view.inviteUrl} target="_blank" rel="noreferrer">
              Open bot invite
            </a>
          )}
        </section>
      )}

      <div className="team-discord-layout">
        <form className="app-card soft-panel team-discord-panel" onSubmit={onSave}>
          <span className="eyebrow">GUILD &amp; CHANNEL</span>
          <h2>{view?.configured ? "Update connection" : "Link Discord"}</h2>
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
            Channel webhook URL {view?.hasWebhook ? "(leave blank to keep current)" : ""}
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
              {view?.configured ? "Save connection" : "Connect Discord"}
            </button>
            {view?.configured && (
              <>
                <button type="button" disabled={busy} onClick={() => void run("test")}>
                  Send test
                </button>
                <button type="button" disabled={busy} onClick={() => void run("disconnect")}>
                  Disconnect
                </button>
              </>
            )}
          </div>
        </form>

        <section className="app-card soft-panel team-discord-panel">
          <span className="eyebrow">STATUS</span>
          <h2>
            {view?.configured
              ? `${view.guildName || view.channelLabel || "Connected"} · ${view.enabled ? "active" : "off"}`
              : "Not connected"}
          </h2>
          {view?.emptyReason && !view.configured && <p className="app-muted">{view.emptyReason}</p>}
          <ul className="team-discord-meta">
            <li>
              <span>Platform bot</span>
              <strong>{view?.platformConfigured ? "configured" : "setup required"}</strong>
            </li>
            <li>
              <span>Webhook</span>
              <strong>{view?.hasWebhook ? "saved" : "none"}</strong>
            </li>
            <li>
              <span>Channel id</span>
              <strong>{view?.channelId || "—"}</strong>
            </li>
            <li>
              <span>Chat bridge</span>
              <strong>{view?.chatBridgeEnabled ? "on" : "off"}</strong>
            </li>
          </ul>
          {view?.configured && (
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() => void run("set-bridge", { chatBridgeEnabled: !view.chatBridgeEnabled })}
            >
              {view.chatBridgeEnabled ? "Disable chat bridge" : "Enable chat bridge"}
            </button>
          )}

          <div className="team-discord-announce">
            <span className="eyebrow">POST ANNOUNCEMENT</span>
            <label>
              Title
              <input value={announceTitle} onChange={(e) => setAnnounceTitle(e.target.value)} placeholder="Practice tonight" />
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
              disabled={busy || !announceBody.trim() || !view?.configured}
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

      {status && (
        <p className={ok ? "team-discord-status ok" : "team-discord-status err"} role="status">
          {status}
        </p>
      )}
    </main>
  );
}
