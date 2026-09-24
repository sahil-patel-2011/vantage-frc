"use client";

/**
 * GitHub, on Connectors with every other integration. It used to sit at the
 * bottom of Team admin, so "Connectors" did not list it and AI keys sent
 * people to Team admin to find it. Same API (/api/github) as before.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ConfirmDialog, PageHeader } from "../../../components/ui";
import { classifyGitHubShell, githubShellCopy } from "../../../lib/github/github-related";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import { TeamAdminGitHubPanel } from "../../team/team-admin-github";
import type { GitHubConnection, GitHubRepo } from "../../team/team-admin-model";
import "../../team/github-connection.css";
import "../connectors.css";

export default function GitHubConnectorClient({ initialOrgId }: { initialOrgId: string | null }) {
  const [orgId, setOrgId] = useState<string | null>(initialOrgId);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [oauthSetupRequired, setOauthSetupRequired] = useState(false);
  const [credentialRejected, setCredentialRejected] = useState<{ login: string | null } | null>(null);
  const [connection, setConnection] = useState<GitHubConnection | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [defaultRepo, setDefaultRepo] = useState("");
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchFailed(false);
    const timeout = { signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS), cache: "no-store" as const };
    try {
      let team = orgId;
      if (!team) {
        // A bare visit resolves the caller's own team, like /connectors does.
        const response = await fetch("/api/connectors", timeout);
        const data = (await response.json().catch(() => ({}))) as { orgId?: string | null };
        team = typeof data.orgId === "string" ? data.orgId : null;
        setOrgId(team);
      }
      if (!team) {
        setFetchFailed(true);
        setErrorStatus(403);
        setErrorMessage("Choose your team");
        return;
      }
      const response = await fetch(`/api/github?orgId=${encodeURIComponent(team)}`, timeout);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setFetchFailed(true);
        setErrorStatus(response.status);
        setErrorMessage(typeof data.error === "string" ? data.error : "Could not load GitHub");
        return;
      }
      setOauthSetupRequired(Boolean(data.oauthSetupRequired ?? (data.setupRequired && !data.patAvailable)));
      setCredentialRejected(data.credentialRejected ? { login: data.rejectedLogin ?? null } : null);
      setConnection(data.connection ?? null);
      setDefaultRepo(data.connection?.defaultRepoFullName ?? "");
      if (data.connection) {
        const reposResponse = await fetch(`/api/github/repos?orgId=${encodeURIComponent(team)}`, timeout);
        const reposData = await reposResponse.json().catch(() => ({}));
        setRepos(reposResponse.ok && Array.isArray(reposData.repos) ? reposData.repos : []);
      } else {
        setRepos([]);
      }
    } catch {
      setFetchFailed(true);
      setErrorStatus(null);
      setErrorMessage("");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected") setMessage("GitHub connected for this team.");
    if (params.get("github") === "denied") setMessage("GitHub sign-in was cancelled.");
    if (params.get("github") === "error") setMessage("Could not connect GitHub. Try again, or save a token instead.");
    void load();
    // Load once on mount; load itself resolves the team when the link had none.
  }, []);

  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    const response = await fetch("/api/github", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, ...body }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, data };
  }

  async function connectOAuth() {
    setBusy(true);
    try {
      const { ok, data } = await post({ action: "authorize-url" });
      if (!ok || typeof data.url !== "string") {
        setMessage(typeof data.error === "string" ? data.error : "Could not start GitHub sign-in.");
        return;
      }
      window.location.href = data.url;
    } finally {
      setBusy(false);
    }
  }

  async function savePat(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const { ok, data } = await post({ action: "connect-pat", pat });
      setMessage(ok ? "Saved. GitHub is connected for this team." : String(data.error ?? "That token didn't work."));
      if (ok) {
        setPat("");
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveDefaultRepo(event: FormEvent) {
    event.preventDefault();
    if (!defaultRepo.trim()) return;
    setBusy(true);
    try {
      const { ok, data } = await post({ action: "set-default-repo", repoFullName: defaultRepo.trim() });
      const repo = (data.defaultRepo as { fullName?: string } | undefined)?.fullName ?? defaultRepo;
      setMessage(ok ? `Saved. Robot code comes from ${repo}.` : String(data.error ?? "That didn't save."));
      if (ok) await load();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const { ok, data } = await post({ action: "disconnect" });
      setMessage(ok ? "GitHub disconnected." : String(data.error ?? "Could not disconnect GitHub."));
      if (ok) await load();
    } finally {
      setBusy(false);
    }
  }

  const shell = classifyGitHubShell({
    loading,
    fetchFailed,
    hasOrgs: true,
    orgId: orgId ?? "",
    connected: Boolean(connection),
  });
  const copy = githubShellCopy(shell);
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: errorMessage,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath: typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
            message: errorMessage || copy.description,
          },
        )
      : null;

  return (
    <main className="module-page connectors-page">
      <PageHeader
        breadcrumbs="Settings / Connectors / GitHub"
        title="GitHub"
        description="Link your team's robot-code repository so the calendar, code review and Ask AI can read it."
      >
        <nav className="product-hub-related" aria-label="Back to connectors">
          <a href={orgId ? `/connectors?orgId=${encodeURIComponent(orgId)}` : "/connectors"}>‹ All connectors</a>
        </nav>
      </PageHeader>
      {message ? (
        <p className="connector-message success" role="status">
          {message}
        </p>
      ) : null}
      <TeamAdminGitHubPanel
        githubShell={shell}
        githubCopy={copy}
        githubFailure={failure}
        githubLoading={loading}
        githubOAuthSetupRequired={oauthSetupRequired}
        githubOAuthMessage=""
        githubCredentialRejected={credentialRejected}
        githubConnection={connection}
        githubBusy={busy}
        githubPat={pat}
        setGithubPat={setPat}
        githubRepos={repos}
        defaultRepo={defaultRepo}
        setDefaultRepo={setDefaultRepo}
        onRetry={() => void load()}
        onConnectOAuth={() => void connectOAuth()}
        onDisconnect={() => setConfirmDisconnect(true)}
        onSavePat={(event) => void savePat(event)}
        onSetDefaultRepo={(event) => void saveDefaultRepo(event)}
      />
      <ConfirmDialog
        open={confirmDisconnect}
        opts={
          confirmDisconnect
            ? {
                title: "Disconnect GitHub for this team?",
                body: "Ask AI, code review and calendar milestones stop reading the repo until someone connects it again.",
                confirmLabel: "Disconnect GitHub",
                tone: "destructive",
              }
            : null
        }
        onResolve={(ok) => {
          setConfirmDisconnect(false);
          if (ok) void disconnect();
        }}
      />
    </main>
  );
}
