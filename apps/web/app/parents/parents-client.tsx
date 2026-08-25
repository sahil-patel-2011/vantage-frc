"use client";

// Mentor-side parent communications (owner/admin only). One-way by design:
// contacts + weekly digest + read-only view links. No chat, no reply path.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  EmptyState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
} from "../../components/ui";
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

export default function ParentsClient() {
  const [view, setView] = useState<ParentsView | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendSummary, setSendSummary] = useState<DigestSummary>(null);

  const orgId = view && view.status !== "setup_required" ? view.orgId : null;

  const load = useCallback((previewNote?: string) => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (previewNote) query.set("note", previewNote);
    void fetch(`/api/parents${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ParentsView | { error?: string };
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
        });
        const data = (await response.json()) as
          | (ParentsView & { digestSummary?: DigestSummary })
          | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return false;
        }
        setView(data);
        if ("digestSummary" in data && data.digestSummary !== undefined) {
          setSendSummary(data.digestSummary ?? null);
        }
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

  if (fetchFailed) {
    return (
      <EmptyState title="Parent updates" badge="Unavailable" badgeTone="setup"
        description="Could not reach the server. Check your connection and try again.">
        <Button onClick={() => load()}>Retry</Button>
      </EmptyState>
    );
  }

  if (!view) {
    return (
      <EmptyState title="Parent updates" aria-busy description="Loading parent contacts…" />
    );
  }

  if (view.status === "setup_required") {
    return (
      <EmptyState title="Parent updates" badge="Setup required" badgeTone="setup"
        description={view.message} />
    );
  }

  if (view.status === "restricted") {
    return (
      <EmptyState title="Parent updates" badge="Owners and admins only" badgeTone="setup"
        description={view.message} />
    );
  }

  const ready: ReadyView = view;
  const activeContacts = ready.contacts.filter((contact) => contact.active);
  const inactiveContacts = ready.contacts.filter((contact) => !contact.active);

  return (
    <>
      <PageHeader
        navPath="/parents"
        title="Parent updates"
        description={`One-way updates from ${ready.orgName} to parent contacts: a weekly schedule digest and a read-only view link per family. No chat, no reply path, no roster exposure.`}
      />

      {!ready.emailConfigured ? (
        <EmptyState soft title="Configure email delivery" badge="Setup required" badgeTone="setup"
          description="RESEND_API_KEY and AUTH_EMAIL_FROM are not set, so digests cannot be delivered. Sends will be recorded as “setup required” until email is configured." />
      ) : null}

      {error ? <p role="alert" className="app-muted">{error}</p> : null}

      <Panel as="form"
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
          <FormRow label="Preferred language" hint="BCP-47 tag: en, es, zh-Hans, pt-BR…">
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
                style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--soft-line)", minHeight: 44 }}>
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
                    style={{ display: "flex", flexWrap: "wrap", gap: "6px 12px", alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--soft-line)", minHeight: 44 }}>
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

      <Panel>
        <h2>This week's digest</h2>
        <p className="app-muted">
          The exact text below goes to every active, subscribed contact — translated per family's
          preferred language when an AI model is configured, otherwise in English with an explicit
          note. Whole-team calendar events for the next 7 days only.
        </p>
        <FormRow wide label="Logistics note (optional)" hint="Included verbatim at the top of the digest.">
          <textarea rows={2} maxLength={1000} value={note}
            onChange={(event) => setNote(event.target.value)} />
        </FormRow>
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <Button onClick={() => load(note)} disabled={busy}>Update preview</Button>
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
          <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto", background: "var(--soft-bg)", border: "1px solid var(--soft-line)", borderRadius: 8, padding: 12, marginTop: 12, fontSize: 13 }}>
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
                  <tr key={row.id} style={{ borderTop: "1px solid var(--soft-line)" }}>
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
    </>
  );
}
