"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { SPONSOR_WALL_TIERS, sponsorWallTierLabel } from "../../lib/sponsor-wall";
import type { SponsorWallView } from "../../lib/sponsor-wall/compute-sponsor-wall";
import {
  SPONSOR_WALL_RELATED_INCLUDE,
  classifySponsorWallShell,
  formatSponsorWallMetric,
  sponsorWallNextActions,
  sponsorWallRelatedLinks,
  sponsorWallSetupSteps,
  sponsorWallShellCopy,
  shouldShowSponsorWallSummaryTiles,
  type SponsorWallNextAction,
  type SponsorWallShellKind,
} from "../../lib/sponsor-wall/sponsor-wall-related";
import type { SponsorWallTheme, SponsorWallTier } from "../../lib/sponsor-wall/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./sponsor-wall.css";

const THEME_LABEL: Record<SponsorWallTheme, string> = {
  light: "Light",
  dark: "Dark",
  team: "Team colors",
};

type LiveView = Extract<SponsorWallView, { status: "live" }>;

function SponsorWallRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = sponsorWallRelatedLinks(orgId, {
    include: [...SPONSOR_WALL_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related sponsor-wall-related" aria-label="Related business tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function SponsorWallNextActionsPanel({ actions }: { actions: SponsorWallNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions sponsor-wall-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
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

function SponsorWallShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: SponsorWallShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = sponsorWallNextActions({ orgId, shell });
  const copy = sponsorWallShellCopy(shell);
  const businessHref = hubWorkbenchHref("business", "sponsor-wall", orgId);
  const steps = shell === "setup" ? sponsorWallSetupSteps(orgId) : [];

  return (
    <main className="module-page sponsor-wall-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Sponsor Wall"}
          </>
        }
        title="Sponsor Wall"
        description={description}
      >
        <SponsorWallRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No sponsors yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={hubHref("/business", "sponsors", orgId)}>
              Open Sponsor CRM
            </a>
            <a className="app-button secondary" href={hubHref("/business", "sponsorship", orgId)}>
              Open Sponsorship
            </a>
            <a className="app-button secondary" href={hubHref("/business", "sponsor-suite", orgId)}>
              Open Sponsor Suite
            </a>
          </>
        ) : null}
      </EmptyState>
      {shell === "setup" && steps.length > 0 ? (
        <ol className="strategy-setup-steps">
          {steps.map((step) => (
            <li key={step.id}>
              <div>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </div>
              <a href={step.href}>Open</a>
            </li>
          ))}
        </ol>
      ) : null}
      <SponsorWallNextActionsPanel actions={actions} />
    </main>
  );
}

export default function SponsorWallClient() {
  const [view, setView] = useState<SponsorWallView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/sponsor-wall${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SponsorWallView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const entryCount = view?.status === "live" ? view.summary.totalEntries : 0;
  const publishedCount = view?.status === "live" ? view.summary.publishedEntries : 0;
  const tierCount = view?.status === "live" ? view.summary.byTier.length : 0;
  const wallPublished = view?.status === "live" ? view.settings.published : false;

  const shell = classifySponsorWallShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    entryCount,
  });
  const shellCopy = sponsorWallShellCopy(shell);
  const nextActions = sponsorWallNextActions({
    orgId,
    shell,
    entryCount,
    publishedCount,
  });
  const relatedLinks = sponsorWallRelatedLinks(orgId, {
    include: [...SPONSOR_WALL_RELATED_INCLUDE],
  });
  const businessHref = hubWorkbenchHref("business", "sponsor-wall", orgId);
  const sponsorsHref = hubHref("/business", "sponsors", orgId);
  const sponsorshipHref = hubHref("/business", "sponsorship", orgId);
  const suiteHref = hubHref("/business", "sponsor-suite", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/sponsor-wall", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as SponsorWallView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return <SponsorWallShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <SponsorWallShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <SponsorWallShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <SponsorWallShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page sponsor-wall-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Sponsor Wall"}
          </>
        }
        title="Sponsor Wall"
        description="Build a public thank-you wall for your sponsors — logos, tiers, and shout-outs from real entries only. Cross-check Sponsor CRM and Sponsorship."
      >
        <div className="sponsor-wall-header-actions">
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <SponsorWallNextActionsPanel actions={nextActions} />

      {shouldShowSponsorWallSummaryTiles(entryCount) ? (
        <section className="sponsor-wall-stats" aria-label="Sponsor wall counts">
          <div>
            <strong>{formatSponsorWallMetric(entryCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Sponsors
            </span>
          </div>
          <div>
            <strong>{formatSponsorWallMetric(publishedCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Published
            </span>
          </div>
          <div>
            <strong>{formatSponsorWallMetric(tierCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Tiers represented
            </span>
          </div>
          <div>
            <strong>{wallPublished ? "Public" : "Draft"}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Wall status
            </span>
          </div>
        </section>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No sponsors yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href="#sponsor-wall-add">
            Add a sponsor
          </a>
          <a className="app-button secondary" href={sponsorsHref}>
            Open Sponsor CRM
          </a>
          <a className="app-button secondary" href={sponsorshipHref}>
            Open Sponsorship
          </a>
        </EmptyState>
      ) : null}

      <div className="sponsor-wall-layout">
        <SettingsForm view={view} busy={busy} mutate={mutate} />
        <AddEntryForm busy={busy} mutate={mutate} />
        <WallPreview view={view} busy={busy} mutate={mutate} />
        <Panel className="sponsor-wall-tip" aria-label="Sponsor Wall tip">
          <span className="eyebrow">Grounding path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Pull names from <a href={sponsorsHref}>Sponsor CRM</a>, align tiers with{" "}
            <a href={sponsorshipHref}>Sponsorship</a>, and pair assets in <a href={suiteHref}>Sponsor Suite</a>
          </p>
        </Panel>
      </div>
    </main>
  );
}

function SettingsForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [headline, setHeadline] = useState(view.settings.headline);
  const [subtitle, setSubtitle] = useState(view.settings.subtitle ?? "");
  const [theme, setTheme] = useState<SponsorWallTheme>(view.settings.theme);
  const [published, setPublished] = useState(view.settings.published);

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        mutate({ action: "update-settings", headline, subtitle: subtitle || undefined, theme, published });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Wall settings</h2>
      <FormGrid min={160}>
        <FormRow label="Headline">
          <input value={headline} onChange={(e) => setHeadline(e.target.value)} required />
        </FormRow>
        <FormRow label="Subtitle (optional)">
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
        </FormRow>
        <FormRow label="Theme">
          <select value={theme} onChange={(e) => setTheme(e.target.value as SponsorWallTheme)}>
            {(Object.keys(THEME_LABEL) as SponsorWallTheme[]).map((t) => (
              <option key={t} value={t}>
                {THEME_LABEL[t]}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Visibility">
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
            Published (publicly viewable)
          </label>
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !headline.trim()}>
          Save settings
        </button>
      </div>
      {view.publicId ? (
        view.settings.published ? (
          <p className="app-muted" style={{ margin: 0 }}>
            Public page:{" "}
            <a href={`/sponsor-wall/${view.publicId}`} target="_blank" rel="noopener noreferrer">
              {`/sponsor-wall/${view.publicId}`}
            </a>{" "}
            — share this link with sponsors; no sign-in required.
          </p>
        ) : (
          <p className="app-muted" style={{ margin: 0 }}>
            Publish the wall to activate its public link at {`/sponsor-wall/${view.publicId}`}.
          </p>
        )
      ) : (
        <p className="app-muted" style={{ margin: 0 }}>
          Save settings once to create the wall&apos;s public share link.
        </p>
      )}
    </Panel>
  );
}

function AddEntryForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      sponsorName: "",
      tier: "partner" as SponsorWallTier,
      logoUrl: "",
      websiteUrl: "",
      message: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="sponsor-wall-add"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.sponsorName.trim()) return;
        mutate({
          action: "add-entry",
          sponsorName: form.sponsorName,
          tier: form.tier,
          logoUrl: form.logoUrl || undefined,
          websiteUrl: form.websiteUrl || undefined,
          message: form.message || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add sponsor</h2>
      <p className="app-muted" style={{ margin: 0 }}>
        Published entries reflect sponsors you add.
      </p>
      <FormGrid min={160}>
        <FormRow label="Sponsor name">
          <input value={form.sponsorName} onChange={set("sponsorName")} placeholder="Acme Robotics" required />
        </FormRow>
        <FormRow label="Tier">
          <select value={form.tier} onChange={set("tier")}>
            {SPONSOR_WALL_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {sponsorWallTierLabel(tier)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Logo URL (optional)">
          <input value={form.logoUrl} onChange={set("logoUrl")} placeholder="https://…" />
        </FormRow>
        <FormRow label="Website URL (optional)">
          <input value={form.websiteUrl} onChange={set("websiteUrl")} placeholder="https://…" />
        </FormRow>
      </FormGrid>
      <FormRow label="Thank-you message (optional)">
        <textarea value={form.message} onChange={set("message")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.sponsorName.trim()}>
          Add to wall
        </button>
      </div>
    </Panel>
  );
}

function WallPreview({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.entries.length === 0) {
    return (
      <EmptyState
        soft
        badge="No sponsors yet"
        badgeTone="setup"
        title="Add your first sponsor to build the wall"
        description="Sponsor names, tiers, and thank-you messages appear here only after real entries."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Wall preview</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.entries.map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              {item.logoUrl ? (
                 
                <img
                  src={item.logoUrl}
                  alt={`${item.sponsorName} logo`}
                  style={{ maxHeight: 32, maxWidth: 120, display: "block", marginBottom: 4 }}
                />
              ) : null}
              <strong>{item.sponsorName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {sponsorWallTierLabel(item.tier)}
                {item.websiteUrl ? ` · ${item.websiteUrl}` : ""}
                {item.published ? "" : " · Hidden"}
              </small>
              {item.message ? <small className="app-muted">{item.message}</small> : null}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "toggle-publish-entry", entryId: item.id, published: !item.published })}
              >
                {item.published ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove "${item.sponsorName}" from the wall?`)) {
                    mutate({ action: "delete-entry", entryId: item.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
