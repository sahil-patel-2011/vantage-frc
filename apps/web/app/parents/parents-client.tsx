"use client";

// Mentor-side parent communications (owner/admin only). One-way by design:
// contacts + weekly digest + read-only view links. No chat, no reply path.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  Button,
  EmptyState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
} from "../../components/ui";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import {
  PARENTS_RELATED_INCLUDE,
  classifyParentsShell,
  parentsNextActions,
  parentsRelatedLinks,
  parentsSetupSteps,
  parentsShellCopy,
  type ParentsNextAction,
  type ParentsShellKind,
} from "../../lib/parents/parents-related";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type {
  ParentContactView,
  ParentDigestLogView,
  ParentsView,
} from "../api/parents/route";

type ReadyView = Extract<ParentsView, { status: "ready" }>;

type DigestSummary = {
  digestBuilt: boolean;
  sent: number;
  skipped: number;
  failed: number;
  setupRequired: number;
} | null;

type ContactForm = {
  name: string;
  email: string;
  phone: string;
  preferredLanguage: string;
  studentLabel: string;
  memberUserId: string;
};

const EMPTY_FORM: ContactForm = {
  name: "",
  email: "",
  phone: "",
  preferredLanguage: "en",
  studentLabel: "",
  memberUserId: "",
};

const LOG_STATUS_LABEL: Record<ParentDigestLogView["status"], string> = {
  sent: "Sent",
  skipped: "Skipped",
  failed: "Failed",
  setup_required: "Email not configured",
};

const LOG_STATUS_TONE: Record<ParentDigestLogView["status"], "good" | "setup" | "neutral" | "danger"> = {
  sent: "good",
  skipped: "neutral",
  failed: "danger",
  setup_required: "setup",
};

function isParentsView(value: unknown): value is ParentsView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "restricted" || status === "ready";
}

function parentsCacheOrg(data: ParentsView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return orgHint;
    case "restricted":
    case "ready":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistParentsSnapshot(orgHint: string, data: ParentsView): Promise<void> {
  const cacheOrg = parentsCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("parents", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("parents", "_", data);
  } catch {
    // Live Parent updates already painted; IndexedDB is best-effort.
  }
}

function formFor(contact: ParentContactView): ContactForm {
  return {
    name: contact.name,
    email: contact.email,
    phone: contact.phone ?? "",
    preferredLanguage: contact.preferredLanguage,
    studentLabel: contact.studentLabel,
    memberUserId: contact.memberUserId ?? "",
  };
}

function ParentsRelated({ orgId }: { orgId?: string | null }) {
  const links = parentsRelatedLinks(orgId, {
    include: [...PARENTS_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: ParentsNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
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
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function ParentsClient() {
  const [view, setView] = useState<ParentsView | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendSummary, setSendSummary] = useState<DigestSummary>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ParentsView | null>(null);
  viewRef.current = view;

  const orgId = view && view.status !== "setup_required" ? view.orgId : null;

  const load = useCallback(async (previewNote?: string) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<ParentsView>("parents", orgHint || "_");
      if (!viewRef.current && cached?.data && isParentsView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    const query = new URLSearchParams();
    if (orgHint) query.set("orgId", orgHint);
    if (previewNote) query.set("note", previewNote);
    try {
      const response = await fetch(`/api/parents${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isParentsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Parent updates. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistParentsSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Parent updates. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>): Promise<boolean> => {
      if (!orgId || busy) return false;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/parents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isParentsView(data)) {
          setError(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Something went wrong.",
          );
          return false;
        }
        setView(data);
        setFromCache(false);
        if ("digestSummary" in data && data.digestSummary !== undefined) {
          setSendSummary((data as { digestSummary?: DigestSummary }).digestSummary ?? null);
        }
        void persistParentsSnapshot(orgId, data);
        return true;
      } catch {
        setError("Network error — please try again.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  const submitContact = useCallback(async () => {
    const payload: Record<string, unknown> = {
      action: editingId ? "update" : "add",
      contactId: editingId ?? undefined,
      name: form.name,
      email: form.email,
      phone: form.phone || null,
      preferredLanguage: form.preferredLanguage,
      studentLabel: form.studentLabel,
      memberUserId: form.memberUserId || null,
    };
    const ok = await mutate(payload);
    if (ok) {
      setForm(EMPTY_FORM);
      setEditingId(null);
    }
  }, [editingId, form, mutate]);

  const copyLink = useCallback(async (contact: ParentContactView) => {
    try {
      await navigator.clipboard.writeText(contact.viewUrl);
      setCopiedId(contact.id);
      setTimeout(() => setCopiedId((current) => (current === contact.id ? null : current)), 2000);
    } catch {
      window.prompt("Copy this parent view link:", contact.viewUrl);
    }
  }, []);

  const peopleHref = hubWorkbenchHref("team", "parents", orgId);
  const contactCount = view?.status === "ready" ? view.contacts.length : 0;
  const shell: ParentsShellKind = classifyParentsShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    contactCount,
  });
  const copy = parentsShellCopy(shell);
  const actions = parentsNextActions({ orgId, shell, contactCount });
  const setup = shell === "setup" ? parentsSetupSteps(orgId)[0] : null;
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={peopleHref}>Team</a>
          {" / Parent updates"}
        </>
      }
      title="Parent updates"
      description={copy.description}
    >
      <ParentsRelated orgId={orgId} />
    </PageHeader>
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || copy.description,
          },
        )
      : null;
    const primary = failure?.primary ?? (setup ? { label: setup.label, href: setup.href } : null);
    return (
      <>
        {header}
        <OfflineBanner feature="Parent updates" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : copy.title}
          description={failure ? failure.description : copy.description}
          badge={failure ? failure.kind === "unknown" ? "Unavailable" : copy.badge : copy.badge}
          badgeTone="setup"
          aria-busy={!fetchFailed}
        >
          {primary ? (
            <Button as="a" variant="primary" href={primary.href}>
              {primary.label}
            </Button>
          ) : failure?.showRetry ? (
            <Button variant="primary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <>
          {header}
          <OfflineBanner feature="Parent updates" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState
            title={copy.title}
            badge={copy.badge}
            badgeTone="setup"
            description={view.message || copy.description}
          >
            {setup ? (
              <Button as="a" variant="primary" href={setup.href}>
                {setup.label}
              </Button>
            ) : null}
          </EmptyState>
        </>
      );
    case "restricted": {
      const restrictedPrimary = actions[0];
      return (
        <>
          {header}
          <OfflineBanner feature="Parent updates" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState
            title={copy.title}
            badge={copy.badge}
            badgeTone="setup"
            description={view.message || copy.description}
          >
            {restrictedPrimary ? (
              <Button as="a" variant="primary" href={restrictedPrimary.href}>
                {restrictedPrimary.label}
              </Button>
            ) : null}
          </EmptyState>
        </>
      );
    }
    case "ready":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  const ready: ReadyView = view;
  const activeContacts = ready.contacts.filter((contact) => contact.active);
  const inactiveContacts = ready.contacts.filter((contact) => !contact.active);

  return (
    <>
      <PageHeader
        breadcrumbs={
          <>
            <a href={peopleHref}>Team</a>
            {" / Parent updates"}
          </>
        }
        title="Parent updates"
        description={copy.description}
      >
        <ParentsRelated orgId={ready.orgId} />
      </PageHeader>
      <OfflineBanner feature="Parent updates" fromCache={fromCache} cachedAt={cachedAt} />

      {!ready.emailConfigured && shell === "ready" ? (
        <EmptyState
          soft
          title="Ask a mentor to finish email delivery"
          badge="Needs setup"
          badgeTone="setup"
          description="Weekly updates cannot go out until team email is connected. Sends wait until a mentor finishes email delivery."
        >
          <Button as="a" variant="primary" href="/connectors">
            Open Connectors
          </Button>
        </EmptyState>
      ) : null}

      {error ? <p role="alert" className="app-muted">{error}</p> : null}

      <Panel
        as="form"
        id="parent-contact"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          void submitContact();
        }}
      >
        <h2>{editingId ? "Edit parent contact" : "Add a parent contact"}</h2>
        <p className="app-muted">
          Parent contact details are visible to team owners and admins only.
        </p>
        <FormGrid min={180}>
          <FormRow label="Parent name">
            <input required maxLength={120} value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </FormRow>
          <FormRow label="Email">
            <input required type="email" maxLength={254} value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </FormRow>
          <FormRow label="Phone" hint="Optional — kept for pit-day contact, never emailed.">
            <input maxLength={32} value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </FormRow>
          <FormRow label="Preferred language" hint="en, es, zh-Hans, pt-BR…">
            <input maxLength={12} value={form.preferredLanguage}
              onChange={(event) => setForm({ ...form, preferredLanguage: event.target.value })} />
          </FormRow>
          <FormRow label="Student (team member)" hint="Links the family so the parent view shows their student's own RSVPs.">
            <select value={form.memberUserId}
              onChange={(event) => setForm({ ...form, memberUserId: event.target.value })}>
              <option value="">Not linked yet</option>
              {ready.members.map((member) => (
                <option key={member.userId} value={member.userId}>{member.name}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Student label" hint="Shown to the parent when the student is not a Vantage user yet.">
            <input maxLength={120} value={form.studentLabel}
              onChange={(event) => setForm({ ...form, studentLabel: event.target.value })} />
          </FormRow>
        </FormGrid>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Button variant="primary" type="submit" disabled={busy}>
            {editingId ? "Save changes" : "Add contact"}
          </Button>
          {editingId ? (
            <Button type="button" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); }}>
              Cancel
            </Button>
          ) : null}
        </div>
      </Panel>

      <Panel>
        <h2>Contacts</h2>
        {ready.contacts.length === 0 ? (
          <p className="app-muted">
            No parent contacts yet. Add the first one above — each contact gets a private
            read-only view link and is included in the weekly digest.
          </p>
        ) : (
          <>
            {activeContacts.map((contact) => (
              <div key={contact.id}
                style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)", minHeight: 44 }}>
                <div style={{ minWidth: 180 }}>
                  <strong>{contact.name}</strong>
                  <div className="app-muted" style={{ fontSize: 13 }}>
                    {contact.email}
                    {contact.memberName
                      ? ` · student: ${contact.memberName}`
                      : contact.studentLabel
                        ? ` · student: ${contact.studentLabel}`
                        : ""}
                    {` · ${contact.preferredLanguage}`}
                  </div>
                </div>
                {!contact.digestOptIn ? <Badge tone="setup">Unsubscribed</Badge> : null}
                <span style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button size="sm" onClick={() => void copyLink(contact)}>
                    {copiedId === contact.id ? "Copied!" : "Copy view link"}
                  </Button>
                  <Button size="sm" onClick={() => { setEditingId(contact.id); setForm(formFor(contact)); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    Edit
                  </Button>
                  <Button size="sm" variant="danger" disabled={busy}
                    onClick={() => void mutate({ action: "deactivate", contactId: contact.id })}>
                    Deactivate
                  </Button>
                </span>
              </div>
            ))}
            {inactiveContacts.length > 0 ? (
              <>
                <h3 className="app-muted" style={{ marginTop: 16 }}>Deactivated</h3>
                {inactiveContacts.map((contact) => (
                  <div key={contact.id}
                    style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)", minHeight: 44 }}>
                    <div style={{ minWidth: 180 }}>
                      <strong>{contact.name}</strong>
                      <div className="app-muted" style={{ fontSize: 13 }}>{contact.email}</div>
                    </div>
                    <span style={{ marginLeft: "auto" }}>
                      <Button size="sm" disabled={busy}
                        onClick={() => void mutate({ action: "reactivate", contactId: contact.id })}>
                        Reactivate
                      </Button>
                    </span>
                  </div>
                ))}
              </>
            ) : null}
          </>
        )}
      </Panel>

      <Panel id="parent-digest">
        <h2>This week&apos;s digest</h2>
        <p className="app-muted">
          The exact text below goes to every active, subscribed contact — translated per family&apos;s
          preferred language when an AI model is configured, otherwise in English with an explicit
          note. Whole-team calendar events for the next 7 days only.
        </p>
        <FormRow wide label="Logistics note (optional)" hint="Included verbatim at the top of the digest.">
          <textarea rows={2} maxLength={1000} value={note}
            onChange={(event) => setNote(event.target.value)} />
        </FormRow>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <Button onClick={() => void load(note)} disabled={busy}>Update preview</Button>
          <Button variant="primary" disabled={busy || !ready.preview || activeContacts.length === 0}
            onClick={() => void mutate({ action: "send_now", logisticsNotes: note || null })}>
            Send digest now
          </Button>
        </div>
        {sendSummary ? (
          <p className="app-muted" role="status" style={{ marginTop: 8 }}>
            {sendSummary.digestBuilt
              ? `Sent ${sendSummary.sent} · skipped ${sendSummary.skipped} · failed ${sendSummary.failed}` +
                (sendSummary.setupRequired > 0
                  ? ` · ${sendSummary.setupRequired} waiting on email setup`
                  : "")
              : "Nothing to send — the week is empty."}
          </p>
        ) : null}
        {ready.preview ? (
          <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginTop: 12, fontSize: 13 }}>
            {`Subject: ${ready.preview.subject}\n\n${ready.preview.text}`}
          </pre>
        ) : (
          <p className="app-muted" style={{ marginTop: 12 }}>
            Nothing scheduled in the next 7 days — no digest will send. Add whole-team events to
            the team calendar (or a logistics note above) and the digest builds from them.
          </p>
        )}
      </Panel>

      <Panel>
        <h2>Send log</h2>
        {ready.log.length === 0 ? (
          <p className="app-muted">No digests have been sent yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>When</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Contact</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Period</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Status</th>
                  <th style={{ textAlign: "left", padding: "6px 8px" }}>Language</th>
                </tr>
              </thead>
              <tbody>
                {ready.log.map((row) => (
                  <tr key={row.id} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.contactName}
                      <span className="app-muted"> · {row.contactEmail}</span>
                    </td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                      {row.periodStart} → {row.periodEnd}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      <Badge tone={LOG_STATUS_TONE[row.status]}>{LOG_STATUS_LABEL[row.status]}</Badge>
                      {row.reason ? <span className="app-muted"> {row.reason}</span> : null}
                    </td>
                    <td style={{ padding: "6px 8px" }}>
                      {row.translatedTo ? `translated: ${row.translatedTo}` : "en (original)"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
    </>
  );
}
