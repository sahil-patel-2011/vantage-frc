"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { Button, EmptyState, PageHeader } from "../../../components/ui";
import {
  ALUMNI_RELATED_INCLUDE,
  alumniRelatedLinks,
  alumniShellCopy,
  classifyAlumniShell,
} from "../../../lib/alumni";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";

type Alum = {
  id: string;
  fullName: string;
  gradYear: number | null;
  currentRole: string | null;
  email: string | null;
  discordHandle: string | null;
  linkedinUrl: string | null;
  note: string | null;
  isMentor: boolean;
  mentorTopic: string | null;
  addedBy: string;
  createdAt: string;
};

type DiscordConfig = { configured: boolean; channelLabel: string | null; enabled: boolean; updatedAt: string | null };

type AlumniSnapshot = {
  alumni: Alum[];
  viewerId: string | null;
};

function isAlumniSnapshot(value: unknown): value is AlumniSnapshot {
  if (!value || typeof value !== "object") return false;
  return Array.isArray((value as AlumniSnapshot).alumni);
}

async function persistAlumniSnapshot(orgId: string, data: AlumniSnapshot): Promise<void> {
  const cacheOrg = orgId.trim();
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("alumni", cacheOrg, data);
  } catch {
    // Live Alumni already painted; IndexedDB is best-effort.
  }
}

const blankForm = {
  fullName: "",
  gradYear: "",
  currentRole: "",
  email: "",
  discordHandle: "",
  linkedinUrl: "",
  note: "",
  isMentor: false,
  mentorTopic: "",
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
  const [mentorsOnly, setMentorsOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const snapshotRef = useRef<AlumniSnapshot | null>(null);

  const load = useCallback(async () => {
    let hadCache = Boolean(snapshotRef.current);
    try {
      const cached = await getFeatureSnapshot<AlumniSnapshot>("alumni", orgId || "_");
      if (!snapshotRef.current && cached?.data && isAlumniSnapshot(cached.data)) {
        snapshotRef.current = cached.data;
        setAlumni(cached.data.alumni);
        setViewerId(cached.data.viewerId ?? null);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        setLoading(false);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    if (!snapshotRef.current) setLoading(true);
    try {
      const alumniResponse = await fetch(`/api/team/alumni?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const alumniData: unknown = await alumniResponse.json().catch(() => null);
      if (alumniResponse.status === 401 || alumniResponse.status === 403) {
        snapshotRef.current = null;
        setAlumni([]);
        setViewerId(null);
        setFromCache(false);
        setCachedAt(null);
        setMessage(
          alumniData && typeof alumniData === "object" && "error" in alumniData && typeof alumniData.error === "string"
            ? alumniData.error
            : "Unable to load alumni",
        );
        setLoading(false);
        return;
      }
      if (
        !alumniResponse.ok ||
        !alumniData ||
        typeof alumniData !== "object" ||
        !Array.isArray((alumniData as { alumni?: unknown }).alumni)
      ) {
        if (hadCache || snapshotRef.current) {
          setFromCache(true);
          setMessage("Could not refresh Alumni. Showing the last copy on this device.");
        } else {
          setMessage(
            alumniData && typeof alumniData === "object" && "error" in alumniData && typeof alumniData.error === "string"
              ? alumniData.error
              : "Unable to load alumni",
          );
        }
      } else {
        const next: AlumniSnapshot = {
          alumni: (alumniData as { alumni: Alum[] }).alumni,
          viewerId: (alumniData as { viewerId?: string | null }).viewerId ?? null,
        };
        snapshotRef.current = next;
        setAlumni(next.alumni);
        setViewerId(next.viewerId);
        setFromCache(false);
        setCachedAt(null);
        await persistAlumniSnapshot(orgId, next);
      }
    } catch {
      if (hadCache || snapshotRef.current) {
        setFromCache(true);
        setMessage("Could not refresh Alumni. Showing the last copy on this device.");
      } else {
        setMessage("Unable to load alumni");
      }
    }
    try {
      const discordResponse = await fetch(`/api/team/discord?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      if (discordResponse.ok) {
        setIsAdmin(true);
        setDiscord((await discordResponse.json()) as DiscordConfig);
      } else {
        setIsAdmin(false);
        setDiscord(null);
      }
    } catch {
      // Discord overlay is live-only; keep the alumni directory.
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const mentorCount = alumni.filter((a) => a.isMentor).length;
  const shown = mentorsOnly ? alumni.filter((a) => a.isMentor) : alumni;
  const emptyCopy = alumniShellCopy(classifyAlumniShell({ orgId, alumniCount: alumni.length }));
  const related = alumniRelatedLinks(orgId, { include: [...ALUMNI_RELATED_INCLUDE], active: "team-alumni" });

  return (
    <main className="intel-app">
      <PageHeader
        breadcrumbs={
          <>
            <a href={`/team?orgId=${orgId}`}>Team</a>
            {" / Alumni"}
          </>
        }
        title="Keep your alumni connected"
        description="A shared directory of team alumni — where they are now and how to reach them — plus a one-click connection to your team's Discord so you can rally the network with an announcement."
      >
        {related.length ? (
          <nav className="product-hub-related" aria-label="Related team tools">
            {related.map((link) => (
              <Button as="a" variant="secondary" key={link.id} href={link.href}>
                {link.label}
              </Button>
            ))}
          </nav>
        ) : null}
      </PageHeader>

      <OfflineBanner feature="Alumni" fromCache={fromCache} cachedAt={cachedAt} />

      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && !snapshotRef.current && <p className="app-muted">Loading alumni network…</p>}

      {(!loading || snapshotRef.current) && (
        <section className="admin-grid">
          <form id="alumni-add" className="intel-panel" onSubmit={addAlum}>
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
            <label className="state-control">
              <input
                type="checkbox"
                checked={form.isMentor}
                onChange={(e) => setForm({ ...form, isMentor: e.target.checked })}
              />
              <span>
                <strong>Available to mentor students</strong>
                <small>Show them in the mentors filter so current students can reach out.</small>
              </span>
            </label>
            {form.isMentor && (
              <label>
                Can help with (optional)
                <input
                  placeholder="CAD, controls, business, college apps…"
                  value={form.mentorTopic}
                  onChange={(e) => setForm({ ...form, mentorTopic: e.target.value })}
                />
              </label>
            )}
            <Button type="submit" variant="primary">
              Add to network
            </Button>
          </form>

          <section className="intel-panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
              <span className="eyebrow">
                ALUMNI · {alumni.length}
                {mentorCount ? ` · ${mentorCount} mentor${mentorCount === 1 ? "" : "s"}` : ""}
              </span>
              {mentorCount > 0 && (
                <label className="check-field" style={{ font: "12px monospace" }}>
                  <input
                    type="checkbox"
                    checked={mentorsOnly}
                    onChange={(e) => setMentorsOnly(e.target.checked)}
                  />{" "}
                  Mentors only
                </label>
              )}
            </div>
            {!shown.length &&
              (mentorsOnly ? (
                <p className="app-muted">No mentors yet.</p>
              ) : (
                <EmptyState
                  badge={emptyCopy.badge}
                  badgeTone="setup"
                  title={emptyCopy.title}
                  description={emptyCopy.description}
                />
              ))}
            {shown.map((alum) => (
              <article className="admin-org" style={rowStyle} key={alum.id}>
                <div>
                  <strong>
                    {alum.fullName}
                    {alum.gradYear ? ` · ’${String(alum.gradYear).slice(2)}` : ""}
                  </strong>
                  <small>
                    {[
                      alum.isMentor ? `Mentor${alum.mentorTopic ? ` · ${alum.mentorTopic}` : ""}` : null,
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

      {(!loading || snapshotRef.current) && isAdmin && (
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
                <Button type="button" variant="primary" disabled={!webhookUrl} onClick={() => void discordAction("save")}>
                  {discord?.configured ? "Update connection" : "Connect Discord"}
                </Button>
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
                <Button type="button" variant="primary" disabled={!announce.trim()} onClick={() => void discordAction("announce")}>
                  Post announcement
                </Button>
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}
