"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Badge, EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import type { DocRolesView } from "../../lib/doc-roles/compute-doc-roles";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

function isDocRolesView(value: unknown): value is DocRolesView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

function docRolesCacheOrg(data: DocRolesView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistDocRolesSnapshot(orgHint: string, data: DocRolesView): Promise<void> {
  const cacheOrg = docRolesCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("doc-roles", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("doc-roles", "_", data);
  } catch {
    // Live Document roles already painted; IndexedDB is best-effort.
  }
}

function orgHintFromWindow(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("orgId")?.trim() ?? "";
}

export default function DocRolesClient() {
  const [view, setView] = useState<DocRolesView | null>(null);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [grantUserId, setGrantUserId] = useState("");
  const [confirmGrant, setConfirmGrant] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<DocRolesView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint = orgHintFromWindow();
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<DocRolesView>("doc-roles", orgHint || "_");
      if (!viewRef.current && cached?.data && isDocRolesView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setError("");
    setErrorStatus(null);
    try {
      const query = orgHint ? `?orgId=${encodeURIComponent(orgHint)}` : "";
      const response = await fetch(`/api/doc-roles${query}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      const errorMessage =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "";
      if (response.status === 401 || response.status === 403) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Document roles. Showing the last copy on this device.");
          return;
        }
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setErrorStatus(response.status);
        setError(errorMessage || "Could not load document roles.");
        return;
      }
      if (!response.ok || !isDocRolesView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Document roles. Showing the last copy on this device.");
          return;
        }
        setErrorStatus(response.status);
        setError(errorMessage || "Could not load document roles.");
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setError("");
      await persistDocRolesSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Document roles. Showing the last copy on this device.");
        return;
      }
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
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !isDocRolesView(data)) {
        const err =
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "That did not work.";
        setError(err);
        return false;
      }
      setView(data);
      setFromCache(false);
      setNotice(success);
      const orgHint = orgHintFromWindow();
      void persistDocRolesSnapshot(orgHint, data);
      return true;
    } catch {
      setError("Could not reach the server. Nothing was saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error && !view) {
    const chooseTeam = errorStatus === 401 || errorStatus === 403;
    return (
      <main className="module-page doc-roles-page">
        <PageHeader breadcrumbs="Team / Playbook" title="Document roles" />
        <OfflineBanner feature="Document roles" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge={chooseTeam ? "Needs setup" : "Unavailable"}
          badgeTone="setup"
          title={chooseTeam ? "Choose your team" : "Could not load document roles"}
          description={
            chooseTeam
              ? "Choose your team before changing who can edit playbook documents."
              : error
          }
        >
          {chooseTeam ? (
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          ) : (
            <Button variant="primary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          )}
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page doc-roles-page">
        <PageHeader breadcrumbs="Team / Playbook" title="Document roles" />
        <OfflineBanner feature="Document roles" fromCache={fromCache} cachedAt={cachedAt} />
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
        <OfflineBanner feature="Document roles" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge="Setup"
          badgeTone="setup"
          title="Document roles are not ready"
          description={view.message}
        />
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
      <OfflineBanner feature="Document roles" fromCache={fromCache} cachedAt={cachedAt} />

      <Panel>
        <h2>How this works</h2>
        <p>
          Everyone on the team can <strong>read</strong> the playbook. Creating and editing pages is
          a role. Owners and admins have it without a grant; anyone else needs one, and{" "}
          <strong>only the team owner can hand it out</strong>. Nobody — owner included — can grant
          it to themselves.
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
                  <Button variant="ghost" type="button" disabled={busy} onClick={() => { void act( { action: "revoke", userId: grant.userId }, `${grant.name || grant.email} can no longer edit docs.`, ); }}>
                    Remove
                  </Button>
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
                  <Button variant="primary" type="submit" disabled={busy}>
                    Yes, grant it
                  </Button>{" "}
                  <Button variant="ghost" type="button" onClick={() => setConfirmGrant(false)}>
                    Cancel
                  </Button>
                </p>
              ) : (
                <Button variant="primary" type="submit" disabled={busy || !grantUserId}>
                  Grant doc editing
                </Button>
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
