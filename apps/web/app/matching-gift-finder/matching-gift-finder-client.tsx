"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { UsageCutoffBanner, resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import {
  MATCHING_GIFT_PLEDGE_STATUSES,
  MATCHING_GIFT_RELATIONSHIPS,
  pledgeStatusLabel,
  relationshipLabel,
} from "../../lib/matching-gift-finder";
import type { MatchingGiftFinderView } from "../../lib/matching-gift-finder/compute-matching-gift-finder";
import type { MatchingGiftPledgeStatus, MatchingGiftRelationship } from "../../lib/matching-gift-finder/types";
import {
  MATCHING_GIFT_FINDER_RELATED_INCLUDE,
  classifyMatchingGiftFinderShell,
  formatMatchingGiftFinderMetric,
  matchingGiftFinderNextActions,
  matchingGiftFinderRelatedLinks,
  matchingGiftFinderSetupSteps,
  matchingGiftFinderShellCopy,
  shouldShowMatchingGiftFinderSummaryTiles,
  type MatchingGiftFinderNextAction,
  type MatchingGiftFinderShellKind,
} from "../../lib/matching-gift-finder/matching-gift-finder-related";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./matching-gift-finder.css";

type LiveView = Extract<MatchingGiftFinderView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = matchingGiftFinderRelatedLinks(orgId, {
    include: [...MATCHING_GIFT_FINDER_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related mgf-related" aria-label="Related business tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: MatchingGiftFinderNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions mgf-next-actions" aria-label="Next actions">
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

function GiftShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: MatchingGiftFinderShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = matchingGiftFinderNextActions({ orgId, shell });
  const copy = matchingGiftFinderShellCopy(shell);
  const businessHref = hubWorkbenchHref("business", "matching-gift-finder", orgId);
  const steps = shell === "setup" ? matchingGiftFinderSetupSteps(orgId) : [];

  return (
    <main className="module-page mgf-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Matching Gift Finder"}
          </>
        }
        title="Matching Gift Multiplier Finder"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading matching gift finder">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button is-primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</a>
          ) : null}
          {shell === "empty" ? (
            <a className="app-button is-primary" href="#matching-gift-contacts">Add a household contact</a>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="mgf-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="mgf-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted mgf-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function MatchingGiftFinderClient() {
  const [view, setView] = useState<MatchingGiftFinderView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/matching-gift-finder${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MatchingGiftFinderView | { error?: string };
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
  const contactCount = view?.status === "live" ? view.contacts.length : 0;
  const matchCount = view?.status === "live" ? view.matches.length : 0;

  const shell = classifyMatchingGiftFinderShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    contactCount,
  });
  const shellCopy = matchingGiftFinderShellCopy(shell);
  const nextActions = matchingGiftFinderNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    contactCount,
    matchCount,
  });
  const relatedLinks = matchingGiftFinderRelatedLinks(orgId, {
    include: [...MATCHING_GIFT_FINDER_RELATED_INCLUDE],
  });
  const businessHref = hubWorkbenchHref("business", "matching-gift-finder", orgId);
  const showTiles = shouldShowMatchingGiftFinderSummaryTiles(contactCount);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      setCutoffCode(null);
      try {
        const response = await fetch("/api/matching-gift-finder", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as MatchingGiftFinderView | { error?: string; code?: string };
        if (!response.ok || !("status" in data)) {
          const cutoff = resolveCutoffErrorCode(response.status, data);
          if (cutoff) {
            setCutoffCode(cutoff);
            setError("AI usage limit reached — raise budgets or wait for the billing period to reset.");
            return;
          }
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
    return <GiftShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <GiftShell
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
      <GiftShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        {view?.status === "setup_required" && view.steps.length > 0 ? (
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href.startsWith("/") ? (orgId ? withOrgHref(step.href, orgId) : step.href) : step.href}>
                  Open
                </a>
              </li>
            ))}
          </ol>
        ) : null}
      </GiftShell>
    );
  }

  if (shell === "empty" || view?.status !== "live") {
    return (
      <GiftShell description={shellCopy.description} orgId={orgId} shell="empty">
        <div id="matching-gift-contacts">
          <ContactForm busy={busy} mutate={mutate} />
        </div>
      </GiftShell>
    );
  }

  return (
    <main className="module-page mgf-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Matching Gift Finder"}
          </>
        }
        title="Matching Gift Multiplier Finder"
        description="Match household-employer contacts against employer matching-gift programs, draft HR request letters, and track pledge status. Cross-check Sponsor CRM, Renewal ROI, and Impact."
      >
        <div className="mgf-header-actions">
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="app-muted mgf-status" role="alert">
          {error}
        </p>
      ) : null}
      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      <NextActionsPanel actions={nextActions} />

      {showTiles ? <SummaryTiles view={view} /> : null}

      <div id="matching-gift-matches">
        <MatchesPanel view={view} busy={busy} mutate={mutate} />
      </div>
      <div id="matching-gift-contacts">
        <ContactsPanel view={view} busy={busy} mutate={mutate} />
      </div>
      <div id="matching-gift-programs">
        <ProgramsPanel view={view} busy={busy} mutate={mutate} />
      </div>
      <PledgesPanel view={view} busy={busy} mutate={mutate} />
      <DraftsPanel view={view} busy={busy} mutate={mutate} />
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <section className="mgf-stats" aria-label="Matching gift counts">
      <StatTile label="Contacts w/ employer" value={formatMatchingGiftFinderMetric(summary.contactsWithEmployer, true)} />
      <StatTile label="Programs" value={formatMatchingGiftFinderMetric(summary.totalPrograms, true)} />
      <StatTile label="Unpledged matches" value={formatMatchingGiftFinderMetric(summary.unmatchedMatchCount, true)} />
      <StatTile label="Matched pledges" value={formatMatchingGiftFinderMetric(summary.pledgeCountByStatus.matched, true)} />
    </section>
  );
}

function MatchesPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.matches.length === 0) {
    return (
      <EmptyState
        soft
        badge="No matches yet"
        badgeTone="setup"
        title="No employer matches found"
        description="A match appears once a contact's employer name matches a tracked program — add programs below or fill in more employer names."
      />
      );
  }
  return (
    <section className="app-card soft-panel matching-gift-finder-matches" aria-label="Matched employers">
      <h2 style={{ marginTop: 0 }}>Matched employers</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.matches.map((match) => (
          <li
            key={`${match.contactId}::${match.program.id}`}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}
          >
            <div>
              <strong>{match.contactName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {match.program.employerName} · {match.program.matchRatio}
                {match.program.annualDeadline ? ` · deadline: ${match.program.annualDeadline}` : ""}
              </small>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {!match.hasPledge ? (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    mutate({
                      action: "upsert-pledge",
                      contactId: match.contactId,
                      programId: match.program.id,
                      status: "identified",
                    })
                  }
                >
                  Track pledge
                </button>
              ) : (
                <span className="app-muted">Pledge tracked</span>
              )}
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() =>
                  mutate({ action: "generate-draft", contactId: match.contactId, programId: match.program.id })
                }
              >
                Draft HR letter
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContactForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({ fullName: "", relationship: "parent" as MatchingGiftRelationship, employerName: "", email: "", notes: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.fullName.trim()) return;
        mutate({
          action: "add-contact",
          fullName: form.fullName,
          relationship: form.relationship,
          employerName: form.employerName || undefined,
          email: form.email || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10, marginTop: 12 }}
    >
      <span className="biz-overline">Household contact</span>
      <h2 style={{ margin: 0 }}>Add contact</h2>
      <FormGrid min={160}>
        <FormRow label="Full name">
          <input value={form.fullName} onChange={set("fullName")} placeholder="Jane Doe" required />
        </FormRow>
        <FormRow label="Relationship">
          <select value={form.relationship} onChange={set("relationship")}>
            {MATCHING_GIFT_RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {relationshipLabel(r)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Employer (optional)">
          <input value={form.employerName} onChange={set("employerName")} placeholder="Microsoft" />
        </FormRow>
        <FormRow label="Email (optional)">
          <input type="email" value={form.email} onChange={set("email")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.fullName.trim()}>
          Add contact
        </button>
      </div>
    </Panel>
  );
}

function ContactsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Household contacts</h2>
      {view.contacts.length === 0 ? (
        <EmptyState soft badge="No contacts" badgeTone="setup" title="No contacts recorded yet" />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {view.contacts.map((contact) => (
            <li key={contact.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong>{contact.fullName}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {relationshipLabel(contact.relationship)}
                  {contact.employerName ? ` · ${contact.employerName}` : " · no employer on file"}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete contact "${contact.fullName}"?`)) {
                    mutate({ action: "delete-contact", contactId: contact.id });
                  }
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <ContactForm busy={busy} mutate={mutate} />
    </Panel>
  );
}

function ProgramsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({ employerName: "", matchRatio: "1:1", minGiftUsd: "", maxGiftUsd: "", annualDeadline: "", submissionUrl: "", notes: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Employer matching-gift programs</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        A starter set of well-known public programs is seeded once — edit ratios/terms or add your own; always verify
        current terms with the employer before submitting a request.
      </p>
      {view.programs.length === 0 ? (
        <EmptyState soft badge="No programs" badgeTone="setup" title="No programs tracked yet" />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {view.programs.map((program) => (
            <li key={program.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong>{program.employerName}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {program.matchRatio}
                  {program.minGiftUsd != null || program.maxGiftUsd != null
                    ? ` · $${program.minGiftUsd ?? 0}–$${program.maxGiftUsd ?? "?"}`
                    : ""}
                  {program.annualDeadline ? ` · ${program.annualDeadline}` : ""}
                  {program.source === "seed" ? " · seeded" : " · manual"}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete program "${program.employerName}"?`)) {
                    mutate({ action: "delete-program", programId: program.id });
                  }
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.employerName.trim()) return;
          mutate({
            action: "add-program",
            employerName: form.employerName,
            matchRatio: form.matchRatio || "1:1",
            minGiftUsd: form.minGiftUsd || undefined,
            maxGiftUsd: form.maxGiftUsd || undefined,
            annualDeadline: form.annualDeadline || undefined,
            submissionUrl: form.submissionUrl || undefined,
            notes: form.notes || undefined,
          });
          setForm(empty);
        }}
        style={{ marginTop: 12, display: "grid", gap: 10 }}
      >
        <FormGrid min={140}>
          <FormRow label="Employer">
            <input value={form.employerName} onChange={set("employerName")} placeholder="Acme Corp" required />
          </FormRow>
          <FormRow label="Match ratio">
            <input value={form.matchRatio} onChange={set("matchRatio")} placeholder="1:1" />
          </FormRow>
          <FormRow label="Min gift ($)">
            <input type="number" min={0} value={form.minGiftUsd} onChange={set("minGiftUsd")} />
          </FormRow>
          <FormRow label="Max gift ($)">
            <input type="number" min={0} value={form.maxGiftUsd} onChange={set("maxGiftUsd")} />
          </FormRow>
          <FormRow label="Deadline note (optional)">
            <input value={form.annualDeadline} onChange={set("annualDeadline")} placeholder="Calendar year of gift" />
          </FormRow>
          <FormRow label="Submission URL (optional)">
            <input value={form.submissionUrl} onChange={set("submissionUrl")} placeholder="https://…" />
          </FormRow>
        </FormGrid>
        <button type="submit" className="app-button secondary" disabled={busy || !form.employerName.trim()}>
          Save program
        </button>
      </form>
    </Panel>
  );
}

function PledgesPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Pledge tracking</h2>
      {view.pledges.length === 0 ? (
        <EmptyState
          soft
          badge="No pledges"
          badgeTone="setup"
          title="No pledges tracked yet"
          description="Track a pledge from the Matched employers list above once a contact requests a match."
        />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {view.pledges.map((pledge) => (
            <li key={pledge.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <strong>
                  {pledge.contactName} → {pledge.employerName}
                </strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {pledgeStatusLabel(pledge.status)}
                  {pledge.pledgeAmountUsd != null ? ` · $${pledge.pledgeAmountUsd.toLocaleString()}` : ""}
                  {pledge.requestedOn ? ` · requested ${pledge.requestedOn}` : ""}
                </small>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <select
                  value={pledge.status}
                  disabled={busy}
                  onChange={(event) =>
                    mutate({
                      action: "upsert-pledge",
                      contactId: pledge.contactId,
                      programId: pledge.programId,
                      status: event.target.value as MatchingGiftPledgeStatus,
                      pledgeAmountUsd: pledge.pledgeAmountUsd ?? undefined,
                      requestedOn: pledge.requestedOn ?? undefined,
                      resolvedOn: pledge.resolvedOn ?? undefined,
                    })
                  }
                >
                  {MATCHING_GIFT_PLEDGE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {pledgeStatusLabel(status)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "delete-pledge", pledgeId: pledge.id })}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function DraftsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Drafted HR request letters</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        Computed from Matched employers above — a template grounded only in the contact and program
        record, not model output.
      </p>
      {view.drafts.length === 0 ? (
        <EmptyState
          soft
          badge="No drafts yet"
          badgeTone="setup"
          title="No letters drafted yet"
          description="Use “Draft HR letter” on a matched employer above to generate one."
        />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14, marginTop: 12 }}>
          {view.drafts.map((draft) => (
            <li key={draft.id} className="app-card soft-panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <strong>{draft.subject}</strong>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "delete-draft", draftId: draft.id })}
                >
                  Delete
                </button>
              </div>
              <p style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{draft.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
