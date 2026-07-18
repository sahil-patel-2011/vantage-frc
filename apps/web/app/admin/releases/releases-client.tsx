"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../../components/ui";
import { adminRelatedLinks } from "../../../lib/admin";
import "../admin-flow.css";

type Release = {
  id: string;
  slug: string;
  title: string;
  versionLabel: string | null;
  notesMarkdown: string;
  audienceType: "all" | "paid" | "max" | "plan_codes";
  audiencePlanCodes: string[];
  minPlan: string | null;
  featureFlags: Record<string, boolean>;
  status: "draft" | "scheduled" | "published" | "cancelled";
  scheduledAt: string | null;
  publishedAt: string | null;
  notifyEmail: boolean;
  notifyInApp: boolean;
};

type Delivery = { status: "available" | "setup_required"; detail: string };

const PLAN_OPTIONS = [
  "free",
  "access",
  "individual_pro",
  "individual_max",
  "team_pro",
  "team_max",
] as const;

const emptyForm = {
  slug: "",
  title: "",
  versionLabel: "",
  notesMarkdown: "",
  audienceType: "all" as Release["audienceType"],
  audiencePlanCodes: "" as string,
  minPlan: "",
  featureFlags: "",
  status: "draft" as Release["status"],
  scheduledAt: "",
  notifyEmail: true,
  notifyInApp: true,
};

function parseFlags(raw: string): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const part of raw.split(/[\n,]+/)) {
    const key = part.trim();
    if (key) flags[key] = true;
  }
  return flags;
}

export default function AdminReleasesClient() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/releases");
      const data = (await response.json()) as {
        releases?: Release[];
        delivery?: Delivery;
        error?: string;
      };
      if (!response.ok) {
        setMessage(data.error ?? "Could not load releases.");
        setOk(false);
        setReleases([]);
        return;
      }
      setMessage("");
      setReleases(data.releases ?? []);
      setDelivery(data.delivery ?? null);
    } catch {
      setMessage("Network error loading releases.");
      setOk(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createRelease(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const payload = {
      slug: form.slug,
      title: form.title,
      versionLabel: form.versionLabel.trim() || null,
      notesMarkdown: form.notesMarkdown,
      audienceType: form.audienceType,
      audiencePlanCodes:
        form.audienceType === "plan_codes"
          ? form.audiencePlanCodes
              .split(/[\n,]+/)
              .map((c) => c.trim())
              .filter(Boolean)
          : [],
      minPlan: form.minPlan.trim() || null,
      featureFlags: parseFlags(form.featureFlags),
      status: form.status,
      scheduledAt: form.status === "scheduled" && form.scheduledAt ? new Date(form.scheduledAt).toISOString() : null,
      notifyEmail: form.notifyEmail,
      notifyInApp: form.notifyInApp,
    };
    const response = await fetch("/api/admin/releases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setOk(response.ok && data.status !== "setup_required");
    setMessage(
      response.ok
        ? data.status === "setup_required"
          ? `Release saved, but email is setup-required: ${data.error}`
          : `Release “${data.release?.title ?? form.title}” saved.`
        : (data.error ?? "Create failed"),
    );
    if (response.ok) {
      setForm(emptyForm);
      await load();
    }
    setBusy(false);
  }

  async function publishRelease(id: string) {
    if (!confirm("Publish this release and notify matching users?")) return;
    setBusy(true);
    const response = await fetch("/api/admin/releases", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, publish: true, notify: true }),
    });
    const data = await response.json();
    setOk(response.ok && data.status !== "setup_required");
    setMessage(
      response.ok
        ? data.status === "setup_required"
          ? `Published, but email is setup-required: ${data.error}`
          : `Published. Emails ${data.notify?.emailsSent ?? 0}, inbox ${data.notify?.inAppSent ?? 0}.`
        : (data.error ?? "Publish failed"),
    );
    if (response.ok) await load();
    setBusy(false);
  }

  return (
    <main className="module-page admin-control">
      <PageHeader
        breadcrumbs="Platform / Releases"
        title="Product releases"
        description="Stage feature flags and release notes by audience (all, paid, Max, or specific plan codes). Publishing emails users with product-update prefs on (default) and posts to the inbox — never a DEMO changelog."
      >
        <nav className="settings-inline-links admin-related" aria-label="Platform shortcuts">
          {adminRelatedLinks({
            active: "releases",
            include: ["teams", "plans", "support", "waitlist"],
          }).map((link) => (
            <a key={link.id} href={link.href}>
              {link.label}
            </a>
          ))}
          <a href="/whats-new">What’s new</a>
        </nav>
      </PageHeader>

      {delivery?.status === "setup_required" ? (
        <Panel className="admin-plans-wiring">
          <span className="eyebrow">Email delivery</span>
          <p>{delivery.detail}</p>
        </Panel>
      ) : null}

      {message ? <p className={`admin-plans-message${ok ? "" : ""}`}>{message}</p> : null}

      <Panel>
        <span className="eyebrow">New release</span>
        <form className="admin-plans-filters" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.75rem" }} onSubmit={(e) => void createRelease(e)}>
          <label>
            Title
            <input
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Strategy Engine 2.0"
              required
            />
          </label>
          <label>
            Slug
            <input
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              placeholder="strategy-engine-2"
              required
            />
          </label>
          <label>
            Version label
            <input
              value={form.versionLabel}
              onChange={(e) => setForm((f) => ({ ...f, versionLabel: e.target.value }))}
              placeholder="2.0"
            />
          </label>
          <label>
            Release notes (markdown)
            <textarea
              value={form.notesMarkdown}
              onChange={(e) => setForm((f) => ({ ...f, notesMarkdown: e.target.value }))}
              rows={8}
              required
              placeholder={"## What's new\n\n- …"}
            />
          </label>
          <label>
            Audience
            <select
              value={form.audienceType}
              onChange={(e) =>
                setForm((f) => ({ ...f, audienceType: e.target.value as Release["audienceType"] }))
              }
            >
              <option value="all">All teams</option>
              <option value="paid">Paid only</option>
              <option value="max">Max tiers only</option>
              <option value="plan_codes">Specific plan codes</option>
            </select>
          </label>
          {form.audienceType === "plan_codes" ? (
            <label>
              Plan codes (comma-separated)
              <input
                value={form.audiencePlanCodes}
                onChange={(e) => setForm((f) => ({ ...f, audiencePlanCodes: e.target.value }))}
                placeholder="team_pro, team_max"
              />
            </label>
          ) : null}
          <label>
            Min plan (optional gate)
            <select value={form.minPlan} onChange={(e) => setForm((f) => ({ ...f, minPlan: e.target.value }))}>
              <option value="">None</option>
              {PLAN_OPTIONS.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Feature flags unlocked (comma-separated)
            <input
              value={form.featureFlags}
              onChange={(e) => setForm((f) => ({ ...f, featureFlags: e.target.value }))}
              placeholder="strategy_engine_v2, scenario_sweeps"
            />
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Release["status"] }))}
            >
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="published">Publish now</option>
            </select>
          </label>
          {form.status === "scheduled" ? (
            <label>
              Schedule (local)
              <input
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
                required
              />
            </label>
          ) : null}
          <label className="soft-check">
            <input
              type="checkbox"
              checked={form.notifyEmail}
              onChange={(e) => setForm((f) => ({ ...f, notifyEmail: e.target.checked }))}
            />
            Email product-update recipients
          </label>
          <label className="soft-check">
            <input
              type="checkbox"
              checked={form.notifyInApp}
              onChange={(e) => setForm((f) => ({ ...f, notifyInApp: e.target.checked }))}
            />
            In-app inbox notification
          </label>
          <button type="submit" className="app-button" disabled={busy}>
            {busy ? "Saving…" : "Create release"}
          </button>
        </form>
      </Panel>

      <Panel>
        <span className="eyebrow">Catalog</span>
        {loading ? (
          <p className="admin-empty">Loading releases…</p>
        ) : releases.length === 0 ? (
          <EmptyState title="No releases yet" description="Create a draft or publish your first staged release." />
        ) : (
          <div className="admin-plans-table-wrap">
            <table className="admin-plans-table">
              <thead>
                <tr>
                  <th>Release</th>
                  <th>Audience</th>
                  <th>Flags</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {releases.map((release) => (
                  <tr key={release.id}>
                    <td>
                      <strong>{release.title}</strong>
                      <small>
                        {release.versionLabel ? `${release.versionLabel} · ` : ""}
                        {release.slug}
                      </small>
                    </td>
                    <td>
                      <strong>{release.audienceType}</strong>
                      <small>
                        {release.minPlan ? `min ${release.minPlan}` : "no min plan"}
                        {release.audiencePlanCodes.length
                          ? ` · ${release.audiencePlanCodes.join(", ")}`
                          : ""}
                      </small>
                    </td>
                    <td>
                      <small>
                        {Object.keys(release.featureFlags).filter((k) => release.featureFlags[k]).join(", ") ||
                          "—"}
                      </small>
                    </td>
                    <td>
                      <strong>{release.status}</strong>
                      <small>
                        {release.publishedAt
                          ? new Date(release.publishedAt).toLocaleString()
                          : release.scheduledAt
                            ? `sched ${new Date(release.scheduledAt).toLocaleString()}`
                            : "—"}
                      </small>
                    </td>
                    <td>
                      {release.status !== "published" && release.status !== "cancelled" ? (
                        <button
                          type="button"
                          className="app-button secondary"
                          disabled={busy}
                          onClick={() => void publishRelease(release.id)}
                        >
                          Publish
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </main>
  );
}
