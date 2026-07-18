"use client";

import { useEffect, useState } from "react";

type Alum = {
  id: string;
  fullName: string;
  gradYear: number | null;
  currentRole: string | null;
  email: string | null;
  discordHandle: string | null;
  linkedinUrl: string | null;
  note: string | null;
  addedBy: string;
  createdAt: string;
};

type DiscordConfig = { configured: boolean; channelLabel: string | null; enabled: boolean; updatedAt: string | null };

const blankForm = {
  fullName: "",
  gradYear: "",
  currentRole: "",
  email: "",
  discordHandle: "",
  linkedinUrl: "",
  note: "",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "12px",
};

export default function AlumniClient({ orgId }: { orgId: string }) {
  const [alumni, setAlumni] = useState<Alum[]>([]);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...blankForm });
  const [isAdmin, setIsAdmin] = useState(false);
  const [discord, setDiscord] = useState<DiscordConfig | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [channelLabel, setChannelLabel] = useState("");
  const [announce, setAnnounce] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const alumniResponse = await fetch(`/api/team/alumni?orgId=${orgId}`);
    const alumniData = await alumniResponse.json();
    if (alumniResponse.ok) {
      setAlumni(alumniData.alumni ?? []);
      setViewerId(alumniData.viewerId ?? null);
    } else {
      setMessage(alumniData.error ?? "Unable to load alumni");
    }
    // Discord GET returns 200 only for admins — use it as the admin signal.
    const discordResponse = await fetch(`/api/team/discord?orgId=${orgId}`);
    if (discordResponse.ok) {
      setIsAdmin(true);
      setDiscord(await discordResponse.json());
    } else {
      setIsAdmin(false);
      setDiscord(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, [orgId]);

  async function addAlum(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/team/alumni", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...form }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Alum added to the network." : data.error);
    if (response.ok) {
      setForm({ ...blankForm });
      await load();
    }
  }

  async function removeAlum(id: string) {
    if (!confirm("Remove this alum from the network?")) return;
    const response = await fetch(`/api/team/alumni?orgId=${orgId}&id=${id}`, { method: "DELETE" });
    const data = await response.json();
    setMessage(response.ok ? "Removed." : data.error);
    if (response.ok) await load();
  }

  async function discordAction(action: "save" | "test" | "announce" | "digest") {
    const payload: Record<string, unknown> = { orgId, action };
    if (action === "save") {
      payload.webhookUrl = webhookUrl;
      payload.channelLabel = channelLabel;
      payload.enabled = true;
    }
    if (action === "announce") payload.message = announce;
    const response = await fetch("/api/team/discord", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setMessage(
      response.ok
        ? action === "save"
          ? "Discord connected."
          : action === "test"
            ? "Test message posted to Discord."
            : action === "digest"
              ? "Alumni digest posted to Discord."
              : "Announcement posted to Discord."
        : data.error,
    );
    if (response.ok) {
      if (action === "save") setWebhookUrl("");
      if (action === "announce") setAnnounce("");
      await load();
    }
  }

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / ALUMNI NETWORK</span>
          <h1>Keep your alumni connected</h1>
          <p className="app-muted">
            A shared directory of team alumni — where they are now and how to reach them — plus a one-click
            connection to your team&apos;s Discord so you can rally the network with an announcement.
          </p>
        </div>
        <nav className="intel-actions" aria-label="Team links">
          <a href={`/team?orgId=${orgId}`}>Team admin</a>
          <a href={`/team/knowledge?orgId=${orgId}`}>Team knowledge</a>
        </nav>
      </header>

      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading alumni network…</p>}

      {!loading && (
        <section className="admin-grid">
          <form className="intel-panel" onSubmit={addAlum}>
            <span className="eyebrow">ADD AN ALUM</span>
            <label>
              Full name
              <input
                required
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </label>
            <label>
              Graduation year
              <input
                inputMode="numeric"
                placeholder="2024"
                value={form.gradYear}
                onChange={(e) => setForm({ ...form, gradYear: e.target.value.replace(/\D/g, "").slice(0, 4) })}
              />
            </label>
            <label>
              Now doing (school / job)
              <input value={form.currentRole} onChange={(e) => setForm({ ...form, currentRole: e.target.value })} />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
            <label>
              Discord handle
              <input
                placeholder="username"
                value={form.discordHandle}
                onChange={(e) => setForm({ ...form, discordHandle: e.target.value })}
              />
            </label>
            <label>
              LinkedIn URL
              <input
                type="url"
                value={form.linkedinUrl}
                onChange={(e) => setForm({ ...form, linkedinUrl: e.target.value })}
              />
            </label>
            <label>
              Note
              <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </label>
            <button className="primary-action" type="submit">
              Add to network
            </button>
          </form>

          <section className="intel-panel">
            <span className="eyebrow">ALUMNI · {alumni.length}</span>
            {!alumni.length && <p className="app-muted">No alumni yet. Add the first from the form.</p>}
            {alumni.map((alum) => (
              <article className="admin-org" style={rowStyle} key={alum.id}>
                <div>
                  <strong>
                    {alum.fullName}
                    {alum.gradYear ? ` · ’${String(alum.gradYear).slice(2)}` : ""}
                  </strong>
                  <small>
                    {[
                      alum.currentRole,
                      alum.discordHandle ? `Discord ${alum.discordHandle}` : null,
                      alum.email,
                      alum.note,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No details yet"}
                    {alum.linkedinUrl ? (
                      <>
                        {" · "}
                        <a href={alum.linkedinUrl} target="_blank" rel="noreferrer noopener">
                          LinkedIn
                        </a>
                      </>
                    ) : null}
                  </small>
                </div>
                {(isAdmin || alum.addedBy === viewerId) && (
                  <button type="button" onClick={() => void removeAlum(alum.id)}>
                    Remove
                  </button>
                )}
              </article>
            ))}
          </section>
        </section>
      )}

      {!loading && isAdmin && (
        <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
          <span className="eyebrow">
            DISCORD CONNECTION {discord?.configured ? `· ${discord.enabled ? "active" : "off"}` : "· not connected"}
          </span>
          <h2>Post to your team&apos;s Discord</h2>
          <p className="app-muted">
            In Discord: <strong>Server Settings → Integrations → Webhooks → New Webhook</strong>, pick the
            channel, copy the URL, and paste it here. The URL is stored securely and never shown again.
          </p>
          <div className="admin-grid">
            <div>
              <label>
                Webhook URL
                <input
                  type="url"
                  placeholder="https://discord.com/api/webhooks/…"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
              </label>
              <label>
                Channel label (optional)
                <input
                  placeholder="#alumni"
                  value={channelLabel}
                  onChange={(e) => setChannelLabel(e.target.value)}
                />
              </label>
              <div className="intel-actions" style={{ marginTop: "0.5rem" }}>
                <button type="button" className="primary-action" disabled={!webhookUrl} onClick={() => void discordAction("save")}>
                  {discord?.configured ? "Update connection" : "Connect Discord"}
                </button>
                {discord?.configured && (
                  <button type="button" onClick={() => void discordAction("test")}>
                    Send test message
                  </button>
                )}
                {discord?.configured && alumni.length > 0 && (
                  <button type="button" onClick={() => void discordAction("digest")}>
                    Post alumni digest
                  </button>
                )}
              </div>
            </div>
            {discord?.configured && (
              <div>
                <label>
                  Announce to the alumni channel
                  <textarea
                    value={announce}
                    onChange={(e) => setAnnounce(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder="Alumni mixer this Saturday at the shop — come say hi!"
                    style={{
                      width: "100%",
                      padding: "12px",
                      color: "#edf3f5",
                      background: "#091014",
                      border: "1px solid #3a4b54",
                      font: "inherit",
                      resize: "vertical",
                    }}
                  />
                </label>
                <button type="button" className="primary-action" disabled={!announce.trim()} onClick={() => void discordAction("announce")}>
                  Post announcement
                </button>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
