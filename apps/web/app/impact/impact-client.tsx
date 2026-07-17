"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { impactAudienceLabel, impactCategoryLabel } from "../../lib/impact";
import {
  IMPACT_AUDIENCES,
  IMPACT_AWARD_TAGS,
  IMPACT_CATEGORIES,
  type ImpactView,
} from "../../lib/impact/compute-impact";
import type { ImpactAudience, ImpactAwardTag, ImpactCategory, ImpactTier } from "../../lib/impact/types";

const TAG_LABEL: Record<ImpactAwardTag, string> = {
  impact: "Impact",
  engineering_inspiration: "Engineering Inspiration",
  rookie_all_star: "Rookie All Star",
};

const COMPONENT_LABEL: Record<string, string> = {
  volume: "Hours volume",
  reach: "People reached",
  cadence: "Season cadence",
  audienceBreadth: "Audience breadth",
  youthFocus: "K-12 focus",
};

function tierTone(tier: ImpactTier): string {
  if (tier === "strong") return "good";
  if (tier === "developing") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<ImpactView, { status: "live" }>;

export default function ImpactClient() {
  const [view, setView] = useState<ImpactView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/impact${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ImpactView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/impact", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as ImpactView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Team / Community Impact</span>
          <h1>Community Impact</h1>
          <p>
            Log outreach, STEM demos, and mentoring — the evidence trail behind the Impact and Engineering Inspiration
            awards. Readiness is computed from what you actually record; nothing is invented.
          </p>
        </div>
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                load(next);
              }}
            >
              {view.seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <section className="app-card soft-panel">
          <h2>Could not load Community Impact</h2>
          <p className="app-muted">A network or server issue prevented loading. Try again.</p>
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </section>
      ) : view == null ? (
        <section className="app-card soft-panel">
          <h2>Loading…</h2>
          <p className="app-muted">Checking your workspace.</p>
        </section>
      ) : view.status === "setup_required" ? (
        <section className="app-card soft-panel">
          <span className="app-badge setup">Setup required</span>
          <h2>{view.message}</h2>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <ReadinessPanel view={view} />
          <SummaryTiles view={view} />
          <LogActivityForm busy={busy} mutate={mutate} />
          {view.summary.totalEvents > 0 ? <Breakdowns view={view} /> : null}
          <RecentActivities view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  const components = Object.entries(readiness.components) as Array<[string, number]>;
  return (
    <section className="app-card soft-panel" aria-label="Impact award readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${tierTone(readiness.tier)}`}>{readiness.tier.toUpperCase()}</span>
          <h2 style={{ margin: "6px 0 0" }}>Impact-award evidence readiness</h2>
          <small className="app-muted">
            Active in {readiness.monthsActive} month(s) · {readiness.audiencesReached} audience group(s) reached
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(readiness.score)}</strong>
      </header>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {components.map(([key, value]) => (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "160px 1fr 48px", gap: 8, alignItems: "center" }}>
            <span className="app-muted">{COMPONENT_LABEL[key] ?? key}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, value * 100)}%` }} />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>{pct(value)}</small>
          </div>
        ))}
      </div>
      {readiness.recommendations.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Next steps</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {readiness.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Activities", value: String(summary.totalEvents) },
    { label: "Hours", value: String(summary.totalHours) },
    { label: "People reached", value: summary.totalPeopleReached.toLocaleString() },
    { label: "Member-participations", value: String(summary.totalParticipants) },
    { label: "Impact signal", value: pct(summary.impactSignal) },
  ];
  return (
    <section className="app-card soft-panel">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Breakdowns({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <section
      className="app-card soft-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}
    >
      <div>
        <h2 style={{ marginTop: 0 }}>By category</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byCategory.map((row) => (
            <li key={row.category} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{impactCategoryLabel(row.category)}</span>
              <small className="app-muted">
                {row.events} · {row.hours}h · {row.peopleReached.toLocaleString()}
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By audience</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byAudience.map((row) => (
            <li key={row.audience} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{impactAudienceLabel(row.audience)}</span>
              <small className="app-muted">
                {row.events} · {row.peopleReached.toLocaleString()} reached
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By month</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byMonth.map((row) => (
            <li key={row.month} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{row.month}</span>
              <small className="app-muted">
                {row.events} · {row.hours}h · {row.peopleReached.toLocaleString()}
              </small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RecentActivities({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalEvents === 0) {
    return (
      <section className="app-card soft-panel">
        <span className="app-badge setup">No activities yet</span>
        <h2>Log your first community-impact activity</h2>
        <p className="app-muted">
          STEM demos, mentoring, and community events build the Impact and Engineering Inspiration narratives.
        </p>
      </section>
    );
  }
  return (
    <section className="app-card soft-panel">
      <h2 style={{ marginTop: 0 }}>Recent activities</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.activities.slice(0, 20).map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.occurredOn} · {impactCategoryLabel(item.category)} · {impactAudienceLabel(item.audience)}
                {item.location ? ` · ${item.location}` : ""}
              </small>
              <small className="app-muted">
                {Math.round(item.durationMinutes / 6) / 10}h · {item.participantCount} member(s) ·{" "}
                {item.peopleReached.toLocaleString()} reached
                {item.evidenceAwards.length ? ` · evidence for ${item.evidenceAwards.map((t) => TAG_LABEL[t]).join(", ")}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${item.title}"?`)) {
                  mutate({ action: "delete-activity", activityId: item.id });
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LogActivityForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      title: "",
      occurredOn: "",
      category: "stem_demo" as ImpactCategory,
      audience: "k12" as ImpactAudience,
      durationMinutes: "",
      participantCount: "",
      peopleReached: "",
      location: "",
      description: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const [tags, setTags] = useState<ImpactAwardTag[]>([]);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const toggleTag = (tag: ImpactAwardTag) =>
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  return (
    <form
      className="app-card soft-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim() || !form.occurredOn) return;
        mutate({
          action: "log-activity",
          title: form.title,
          occurredOn: form.occurredOn,
          category: form.category,
          audience: form.audience,
          durationMinutes: Number(form.durationMinutes) || 0,
          participantCount: Number(form.participantCount) || 0,
          peopleReached: Number(form.peopleReached) || 0,
          location: form.location || undefined,
          description: form.description || undefined,
          evidenceAwards: tags,
        });
        setForm(empty);
        setTags([]);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log activity</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Title</span>
          <input value={form.title} onChange={set("title")} placeholder="Elementary STEM night" required />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Date</span>
          <input type="date" value={form.occurredOn} onChange={set("occurredOn")} required />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Category</span>
          <select value={form.category} onChange={set("category")}>
            {IMPACT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {impactCategoryLabel(category)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Audience</span>
          <select value={form.audience} onChange={set("audience")}>
            {IMPACT_AUDIENCES.map((audience) => (
              <option key={audience} value={audience}>
                {impactAudienceLabel(audience)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Duration (min)</span>
          <input type="number" min={0} value={form.durationMinutes} onChange={set("durationMinutes")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Team members</span>
          <input type="number" min={0} value={form.participantCount} onChange={set("participantCount")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">People reached</span>
          <input type="number" min={0} value={form.peopleReached} onChange={set("peopleReached")} />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Location (optional)</span>
          <input value={form.location} onChange={set("location")} />
        </label>
      </div>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Notes (optional)</span>
        <textarea value={form.description} onChange={set("description")} rows={2} />
      </label>
      <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <span className="app-muted">Evidence for:</span>
        {IMPACT_AWARD_TAGS.map((tag) => (
          <label key={tag} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={tags.includes(tag)} onChange={() => toggleTag(tag)} />
            {TAG_LABEL[tag]}
          </label>
        ))}
      </fieldset>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim() || !form.occurredOn}>
          Log activity
        </button>
      </div>
    </form>
  );
}
