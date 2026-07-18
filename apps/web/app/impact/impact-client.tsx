"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BusinessRelated } from "../../components/business-related";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { IMPACT_RELATED_INCLUDE } from "../../lib/business/business-related";
import { impactNextActions } from "../../lib/business/impact-next-actions";
import { impactAudienceLabel, impactCategoryLabel } from "../../lib/impact";
import {
  IMPACT_AUDIENCES,
  IMPACT_AWARD_TAGS,
  IMPACT_CATEGORIES,
  type ImpactView,
} from "../../lib/impact/compute-impact";
import type { ImpactAudience, ImpactAwardTag, ImpactCategory, ImpactTier } from "../../lib/impact/types";
import "./impact.css";

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

function ImpactNextActions({
  actions,
}: {
  actions: ReturnType<typeof impactNextActions>;
}) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions impact-next-actions" aria-label="Next actions">
      <header>
        <span className="biz-overline">Next actions</span>
        <h2>Build award evidence from real outreach</h2>
        <p>Hours, reach, and readiness use logged activities only — never DEMO community metrics.</p>
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

  const nextActions = useMemo(() => {
    if (view?.status === "setup_required") {
      return impactNextActions({ orgId: view.orgId ?? null, activityCount: 0 });
    }
    if (view?.status !== "live") {
      return impactNextActions({ orgId: orgId ?? null, activityCount: 0 });
    }
    return impactNextActions({
      orgId: view.orgId,
      activityCount: view.summary.totalEvents,
      totalHours: view.summary.totalHours,
      readinessScore: view.readiness.score,
      seasonYear: view.seasonYear,
    });
  }, [view, orgId]);

  const relatedOrg = orgId ?? (view?.status === "setup_required" ? view.orgId : null) ?? null;

  return (
    <main className="module-page impact-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={relatedOrg ? `/business?orgId=${encodeURIComponent(relatedOrg)}` : "/business"}>Business</a>
            {" / Community Impact"}
          </>
        }
        title="Community Impact"
        description="Log outreach, STEM demos, and mentoring — the evidence trail for Impact and Engineering Inspiration. Readiness uses only what you record."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
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
        </div>
      </PageHeader>

      {relatedOrg ? (
        <BusinessRelated
          orgId={relatedOrg}
          active="impact"
          include={IMPACT_RELATED_INCLUDE}
          ariaLabel="Related impact and awards tools"
        />
      ) : null}

      {error ? (
        <p className="impact-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          soft
          title="Could not load Community Impact"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState soft title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <>
          <ImpactNextActions actions={nextActions} />
          <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message}>
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
            {relatedOrg ? (
              <BusinessRelated
                orgId={relatedOrg}
                include={["awards", "grants", "sponsors"]}
                ariaLabel="Setup impact related links"
              />
            ) : null}
          </EmptyState>
        </>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <ImpactNextActions actions={nextActions} />
          <ReadinessPanel view={view} />
          <SummaryTiles view={view} />
          <LogActivityForm busy={busy} mutate={mutate} />
          {view.summary.totalEvents > 0 ? <Breakdowns view={view} /> : null}
          <RecentActivities view={view} busy={busy} mutate={mutate} relatedOrg={relatedOrg} />
        </div>
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  const components = Object.entries(readiness.components) as Array<[string, number]>;
  return (
    <section className="app-card soft-panel impact-readiness" aria-label="Impact award readiness">
      <div className="impact-readiness-head">
        <div>
          <span className={`app-badge ${tierTone(readiness.tier)}`}>{readiness.tier.toUpperCase()}</span>
          <h2 style={{ marginTop: 6 }}>Impact-award evidence readiness</h2>
          <small className="app-muted">
            Active in {readiness.monthsActive} month(s) · {readiness.audiencesReached} audience group(s) reached — from
            logged activities only
          </small>
        </div>
        <strong className="impact-score">{pct(readiness.score)}</strong>
      </div>
      <div className="impact-components">
        {components.map(([key, value]) => (
          <div key={key} className="impact-component">
            <span className="app-muted">{COMPONENT_LABEL[key] ?? key}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, value * 100)}%` }} />
            </span>
            <small>{pct(value)}</small>
          </div>
        ))}
      </div>
      {readiness.recommendations.length > 0 ? (
        <div>
          <strong className="app-muted">Next steps</strong>
          <ul className="impact-recs">
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
  if (summary.totalEvents === 0) {
    return (
      <section className="app-card soft-panel impact-stats" aria-label="Season impact summary">
        <header className="biz-card-head">
          <div>
            <span className="biz-overline">Season totals</span>
            <h2 style={{ margin: 0, fontSize: 16 }}>No activities recorded yet</h2>
          </div>
        </header>
        <p className="app-muted" style={{ margin: 0, fontSize: 13 }}>
          Hours, people reached, and readiness stay blank until you log real outreach — never DEMO community metrics.
        </p>
      </section>
    );
  }
  return (
    <section className="app-card soft-panel impact-stats" aria-label="Season impact summary">
      <header className="biz-card-head">
        <div>
          <span className="biz-overline">Season totals</span>
          <h2 style={{ margin: 0, fontSize: 16 }}>From logged activities only</h2>
        </div>
      </header>
      <div className="soft-snapshot-grid">
        <div>
          <strong>{summary.totalEvents}</strong>
          <span>activities</span>
        </div>
        <div>
          <strong>{summary.totalHours}</strong>
          <span>hours</span>
        </div>
        <div>
          <strong>{summary.totalPeopleReached.toLocaleString()}</strong>
          <span>people reached</span>
        </div>
        <div>
          <strong>{summary.totalParticipants}</strong>
          <span>member-participations</span>
        </div>
        <div>
          <strong className="accent">{pct(summary.impactSignal)}</strong>
          <span>impact signal</span>
        </div>
      </div>
    </section>
  );
}

function Breakdowns({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <section className="app-card soft-panel impact-breakdowns" aria-label="Impact breakdowns">
      <div>
        <h2>By category</h2>
        <ul>
          {summary.byCategory.map((row) => (
            <li key={row.category}>
              <span>{impactCategoryLabel(row.category)}</span>
              <small>
                {row.events} · {row.hours}h · {row.peopleReached.toLocaleString()}
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2>By audience</h2>
        <ul>
          {summary.byAudience.map((row) => (
            <li key={row.audience}>
              <span>{impactAudienceLabel(row.audience)}</span>
              <small>
                {row.events} · {row.peopleReached.toLocaleString()} reached
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2>By month</h2>
        <ul>
          {summary.byMonth.map((row) => (
            <li key={row.month}>
              <span>{row.month}</span>
              <small>
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
  relatedOrg,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  relatedOrg: string | null;
}) {
  if (view.summary.totalEvents === 0) {
    return (
      <EmptyState
        soft
        badge="No activities yet"
        badgeTone="setup"
        title="Log your first community-impact activity"
        description="STEM demos, mentoring, and community events build the Impact and Engineering Inspiration narratives — empty means nothing logged, not a placeholder scoreboard."
      >
        {relatedOrg ? (
          <BusinessRelated
            orgId={relatedOrg}
            include={["awards", "grants", "sponsors"]}
            ariaLabel="Empty impact related links"
          />
        ) : null}
      </EmptyState>
    );
  }
  return (
    <section className="app-card soft-panel impact-list" aria-label="Recent activities">
      <h2>Recent activities</h2>
      <ul className="impact-activity-list">
        {view.activities.slice(0, 20).map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.title}</strong>
              <span>
                {item.occurredOn} · {impactCategoryLabel(item.category)} · {impactAudienceLabel(item.audience)}
                {item.location ? ` · ${item.location}` : ""}
              </span>
              <small>
                {Math.round(item.durationMinutes / 6) / 10}h · {item.participantCount} member(s) ·{" "}
                {item.peopleReached.toLocaleString()} reached
                {item.evidenceAwards.length
                  ? ` · evidence for ${item.evidenceAwards.map((t) => TAG_LABEL[t]).join(", ")}`
                  : ""}
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
    <Panel
      as="form"
      className="impact-form"
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
      <span className="biz-overline">Record outreach</span>
      <h2>Log activity</h2>
      <FormGrid min={160}>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Elementary STEM night" required />
        </FormRow>
        <FormRow label="Date">
          <input type="date" value={form.occurredOn} onChange={set("occurredOn")} required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {IMPACT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {impactCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Audience">
          <select value={form.audience} onChange={set("audience")}>
            {IMPACT_AUDIENCES.map((audience) => (
              <option key={audience} value={audience}>
                {impactAudienceLabel(audience)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Duration (min)">
          <input type="number" min={0} value={form.durationMinutes} onChange={set("durationMinutes")} />
        </FormRow>
        <FormRow label="Team members">
          <input type="number" min={0} value={form.participantCount} onChange={set("participantCount")} />
        </FormRow>
        <FormRow label="People reached">
          <input type="number" min={0} value={form.peopleReached} onChange={set("peopleReached")} />
        </FormRow>
        <FormRow label="Location (optional)">
          <input value={form.location} onChange={set("location")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.description} onChange={set("description")} rows={2} />
      </FormRow>
      <fieldset className="impact-tag-row">
        <span className="app-muted">Evidence for:</span>
        {IMPACT_AWARD_TAGS.map((tag) => (
          <label key={tag}>
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
    </Panel>
  );
}
