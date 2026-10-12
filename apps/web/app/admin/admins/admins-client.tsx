"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, PageHeader, SoftBlockSkeleton, askConfirm } from "../../../components/ui";
import { ReauthHint, SidePanel, api, day } from "../admin-console-kit";
import "../admin-console.css";

type Admin = { userId: string; email: string; name: string; grantedAt: string; grantedByEmail: string | null; you: boolean };
type Payload = {
  admins: Admin[];
  abilities: { canRemoveOthers: boolean; canRemoveSelf: boolean; canTransfer: boolean };
  sessionFresh: boolean;
  setupRequired: boolean;
};

/**
 * Who runs Vantage. Add someone by the email of their Vantage account (from any team or none),
 * remove someone (never the last admin), or hand Platform admin to someone else in one step.
 */
export default function AdminsClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<"add" | "transfer" | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone?: "error"; code?: string } | null>(null);

  const load = useCallback(async () => {
    const result = await api<Payload>("/api/admin/platform-admins");
    if (result.ok) setData(result.data);
    else setError(result.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openPanel(kind: "add" | "transfer") {
    setEmail("");
    setMessage(null);
    setPanel(kind);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!panel) return;
    if (panel === "transfer") {
      const ok = await askConfirm({
        title: `Hand Platform admin to ${email.trim()}?`,
        body: "They become a platform admin and you stop being one, in one step. You keep your account and your teams. Only a platform admin can give it back.",
        confirmLabel: "Hand it over",
        tone: "destructive",
      });
      if (!ok) return;
    }
    setBusy(true);
    setMessage(null);
    const result = await api<{ next: string | null }>("/api/admin/platform-admins", {
      method: "POST",
      body: JSON.stringify({ action: panel, email }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ text: result.error, tone: "error", code: result.code });
      return;
    }
    if (result.data.next) {
      window.location.assign(result.data.next);
      return;
    }
    setPanel(null);
    setMessage({ text: `${email.trim()} is now a platform admin. They have a note in their inbox.` });
    await load();
  }

  async function remove(admin: Admin) {
    const ok = await askConfirm({
      title: admin.you ? "Stop being a platform admin?" : `Remove ${admin.email} from Platform admin?`,
      body: admin.you
        ? "You lose access to Platform admin at once. Your account and teams stay. Another platform admin can add you back."
        : "They lose access to Platform admin at once and get a note. Their account and teams stay.",
      confirmLabel: admin.you ? "Leave Platform admin" : "Remove admin",
      tone: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const result = await api<{ next: string | null }>("/api/admin/platform-admins", {
      method: "DELETE",
      body: JSON.stringify({ userId: admin.userId }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ text: result.error, tone: "error", code: result.code });
      return;
    }
    if (result.data.next) {
      window.location.assign(result.data.next);
      return;
    }
    setMessage({ text: `${admin.email} is no longer a platform admin.` });
    await load();
  }

  if (error) {
    return (
      <main className="module-page admin-control ac-page">
        <PageHeader title="Platform admins" />
        <EmptyState soft title="The list didn't load" description={error} />
      </main>
    );
  }
  if (!data) {
    return (
      <main className="module-page admin-control ac-page" aria-busy="true">
        <PageHeader title="Platform admins" />
        <SoftBlockSkeleton />
      </main>
    );
  }

  const only = data.admins.length <= 1;

  return (
    <main className="module-page admin-control ac-page">
      <PageHeader
        title="Platform admins"
        description="People who can set up teams, give AI credit and see module health. Add anyone with a Vantage account, from any team."
      >
        <Button variant="primary" type="button" onClick={() => openPanel("add")} disabled={data.setupRequired}>
          Add an admin
        </Button>
      </PageHeader>

      {data.setupRequired ? <p className="ac-message ac-muted">Managing platform admins needs database migration 0727.</p> : null}
      {!data.sessionFresh ? (
        <p className="ac-message">
          Changes here need a sign-in from the last 24 hours. <a href="/signin?next=/admin/admins">Sign in again</a> first.
        </p>
      ) : null}
      {message ? (
        <p className="ac-message" data-tone={message.tone} role="status">
          {message.text} <ReauthHint code={message.code} />
        </p>
      ) : null}

      <ul className="ac-list">
        {data.admins.map((admin) => (
          <li key={admin.userId} className="ac-item">
            <div className="ac-row-main">
              <strong>
                {admin.name}
                {admin.you ? " (you)" : ""}
              </strong>
              <small>
                {admin.email} · admin since {day(admin.grantedAt)}
                {admin.grantedByEmail ? `, added by ${admin.grantedByEmail}` : ""}
              </small>
            </div>
            <div className="ac-item-actions">
              {only ? (
                <span className="ac-small ac-muted">The only admin: add someone before anyone can leave.</span>
              ) : (
                <Button variant="ghost" size="sm" type="button" className="admin-org-delete" disabled={busy} onClick={() => void remove(admin)}>
                  {admin.you ? "Leave…" : "Remove…"}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <section className="ac-section">
        <div className="ac-section-head">
          <div>
            <h2>Hand over Platform admin</h2>
            <p>Make someone else an admin and stop being one yourself, in one step.</p>
          </div>
          <Button variant="secondary" type="button" onClick={() => openPanel("transfer")} disabled={data.setupRequired}>
            Hand over…
          </Button>
        </div>
      </section>

      <SidePanel
        open={panel !== null}
        onClose={() => setPanel(null)}
        title={panel === "transfer" ? "Hand over Platform admin" : "Add a platform admin"}
        description={
          panel === "transfer"
            ? "They become a platform admin and you stop being one."
            : "They need a Vantage account already. If they don't have one, ask them to sign in to Vantage once."
        }
      >
        <form className="ac-form" onSubmit={submit}>
          <label>
            Their Vantage account email
            <input required type="email" autoComplete="off" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          {message?.tone === "error" ? (
            <p className="ac-message" data-tone="error" role="alert">
              {message.text} <ReauthHint code={message.code} />
            </p>
          ) : null}
          <div className="ac-actions">
            <Button variant="secondary" type="button" onClick={() => setPanel(null)}>
              Cancel
            </Button>
            <Button variant={panel === "transfer" ? "danger" : "primary"} type="submit" disabled={busy || !email.trim()}>
              {busy ? "Saving…" : panel === "transfer" ? "Hand over…" : "Add admin"}
            </Button>
          </div>
        </form>
      </SidePanel>
    </main>
  );
}
