"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, EmptyState, PageHeader, Panel } from "../../components/ui";
import type { DocRolesView } from "../../lib/doc-roles/compute-doc-roles";

export default function DocRolesClient() {
  const [view, setView] = useState<DocRolesView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [grantUserId, setGrantUserId] = useState("");
  const [confirmGrant, setConfirmGrant] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/doc-roles");
      const data = (await response.json()) as DocRolesView & { error?: string };
      if (!response.ok) {
        setError((data as { error?: string }).error ?? "Could not load document roles.");
        return;
      }
      setView(data);
      setError("");
    } catch {
      setError("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>, success: string): Promise<boolean> {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/doc-roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as DocRolesView & { error?: string };
      if (!response.ok) {
        setError((data as { error?: string }).error ?? "That did not work.");
        return false;
      }
      setView(data);
      setNotice(success);
      return true;
    } catch {
      setError("Could not reach the server. Nothing was saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error && !view) {
    return (
      <main className="module-page doc-roles-page">
        <PageHeader breadcrumbs="Team / Playbook" title="Document roles" />
        <EmptyState soft badge="Not available" badgeTone="setup" title="Document roles need a team" description={error}>
          <a className="app-button" href="/workspace">
            Choose team
          </a>
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page doc-roles-page">
        <PageHeader breadcrumbs="Team / Playbook" title="Document roles" />
        <Panel>
          <p className="app-muted">Loading…</p>
        </Panel>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page doc-roles-page">
        <PageHeader breadcrumbs="Team / Playbook" title="Document roles" />
        <EmptyState soft badge="Setup" badgeTone="setup" title="Not migrated yet" description={view.message} />
      </main>
    );
  }

  return (
    <main className="module-page doc-roles-page">
      <PageHeader
        breadcrumbs="Team / Playbook"
        title="Document roles"
        description={`Who can write ${view.orgName}'s playbook pages — and who decides that.`}
      />

      <Panel>
        <h2>How this works</h2>
        <p>
          Everyone on the team can <strong>read</strong> the playbook. Creating and editing pages is
          a role. Owners and admins have it without a grant; anyone else needs one, and{" "}
          <strong>only the team owner can hand it out</strong>. Nobody — owner included — can grant
          it to themselves; the database refuses a row where the giver and the receiver are the same
          person.
        </p>
        <p className="app-muted">
          You:{" "}
          <Badge tone={view.canEditDocs ? "good" : "neutral"}>
            {view.canEditDocs ? "Can edit docs" : "Read only"}
          </Badge>{" "}
          <Badge tone={view.canGrant ? "good" : "neutral"}>
            {view.canGrant ? "Can grant the role" : "Cannot grant the role"}
          </Badge>
        </p>
        {view.cannotGrantReason ? <p className="dr-note">{view.cannotGrantReason}</p> : null}
      </Panel>

      <Panel>
        <h2>Editors by role</h2>
        <p className="app-muted">
          These people can edit docs because of the role they already hold. They do not appear as
          grants below, and removing a grant does not affect them.
        </p>
        {view.implicitEditors.length === 0 ? (
          <p className="app-muted">No owners or admins found on this team.</p>
        ) : (
          <ul className="dr-list">
            {view.implicitEditors.map((member) => (
              <li key={member.userId}>
                <strong>{member.name || member.email}</strong>{" "}
                <span className="app-muted">{member.role}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel>
        <h2>Granted doc editors</h2>
        {view.editors.length === 0 ? (
          <EmptyState
            compact
            title="Nobody has been granted the role"
            description="Only the owners and admins listed above can edit docs right now."
          />
        ) : (
          <ul className="dr-list">
            {view.editors.map((grant) => (
              <li key={grant.userId} className="dr-grant">
                <span>
                  <strong>{grant.name || grant.email}</strong>{" "}
                  <span className="app-muted">
                    granted {new Date(grant.grantedAt).toLocaleDateString()}
                    {grant.grantedByName ? ` by ${grant.grantedByName}` : ""}
                  </span>
                </span>
                {view.canGrant ? (
                  <button
                    className="app-button ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void act(
                        { action: "revoke", userId: grant.userId },
                        `${grant.name || grant.email} can no longer edit docs.`,
                      );
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {view.canGrant ? (
          view.candidates.length === 0 ? (
            <p className="app-muted">
              Everyone on the team either already holds the role or has it through their org role.
            </p>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!grantUserId) return;
                if (!confirmGrant) {
                  setConfirmGrant(true);
                  return;
                }
                const person = view.candidates.find((c) => c.userId === grantUserId);
                void act(
                  { action: "grant", userId: grantUserId },
                  `${person?.name || person?.email || "That member"} can now create and edit docs.`,
                ).then((ok) => {
                  setConfirmGrant(false);
                  if (ok) {
                    setGrantUserId("");
                  }
                });
              }}
            >
              <label className="dr-field">
                <span>Give doc editing to</span>
                <select
                  value={grantUserId}
                  onChange={(event) => {
                    setGrantUserId(event.target.value);
                    setConfirmGrant(false);
                  }}
                >
                  <option value="">Choose a team member…</option>
                  {view.candidates.map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.name || person.email} ({person.role})
                    </option>
                  ))}
                </select>
              </label>
              {confirmGrant ? (
                <p className="dr-confirm">
                  Let{" "}
                  {view.candidates.find((c) => c.userId === grantUserId)?.name ||
                    view.candidates.find((c) => c.userId === grantUserId)?.email ||
                    "this member"}{" "}
                  create and edit the team&rsquo;s docs?{" "}
                  <button className="app-button" type="submit" disabled={busy}>
                    Yes, grant it
                  </button>{" "}
                  <button className="app-button ghost" type="button" onClick={() => setConfirmGrant(false)}>
                    Cancel
                  </button>
                </p>
              ) : (
                <button className="app-button" type="submit" disabled={busy || !grantUserId}>
                  Grant doc editing
                </button>
              )}
            </form>
          )
        ) : null}
      </Panel>

      <Panel>
        <h2>Where the docs are</h2>
        <p className="app-muted">
          The pages this role governs live in the team playbook.{" "}
          <a href="/knowledge">Open the playbook</a>
        </p>
      </Panel>

      {error ? <p className="dr-error">{error}</p> : null}
      {notice ? <p className="dr-notice">{notice}</p> : null}
    </main>
  );
}
