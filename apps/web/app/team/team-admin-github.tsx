"use client";

import { type FormEvent } from "react";
import { EmptyState, Button } from "../../components/ui";
import type { GitHubShellKind } from "../../lib/github/github-related";
import type { LoadFailureCopy } from "../../lib/ui/load-failure";
import type { GitHubConnection, GitHubRepo } from "./team-admin-model";

export function TeamAdminGitHubPanel({
  githubShell,
  githubCopy,
  githubFailure,
  githubLoading,
  githubOAuthSetupRequired,
  githubOAuthMessage,
  githubCredentialRejected,
  githubConnection,
  githubBusy,
  githubPat,
  setGithubPat,
  githubRepos,
  defaultRepo,
  setDefaultRepo,
  onRetry,
  onConnectOAuth,
  onDisconnect,
  onSavePat,
  onSetDefaultRepo,
}: {
  githubShell: GitHubShellKind;
  githubCopy: { title: string; description: string };
  githubFailure: LoadFailureCopy | null;
  githubLoading: boolean;
  githubOAuthSetupRequired: boolean;
  githubOAuthMessage: string;
  githubCredentialRejected: { login: string | null } | null;
  githubConnection: GitHubConnection | null;
  githubBusy: boolean;
  githubPat: string;
  setGithubPat: (value: string) => void;
  githubRepos: GitHubRepo[];
  defaultRepo: string;
  setDefaultRepo: (value: string) => void;
  onRetry: () => void;
  onConnectOAuth: () => void;
  onDisconnect: () => void;
  onSavePat: (event: FormEvent) => void;
  onSetDefaultRepo: (event: FormEvent) => void;
}) {
  return (
    <section className="compare-panel github-panel" id="github-connection">
      <h2>GitHub</h2>
      <p className="app-muted">Connect so calendar due dates and code tools can use this team’s repo.</p>

      {githubShell === "loading" || githubShell === "error" ? (
        <EmptyState
          soft
          badge={githubFailure ? "Unavailable" : undefined}
          badgeTone="setup"
          title={githubFailure ? githubFailure.title : githubCopy.title}
          description={githubFailure ? githubFailure.description : githubCopy.description}
          aria-busy={githubLoading}
        >
          {githubFailure?.primary ? (
            <Button as="a" variant="primary" href={githubFailure.primary.href}>
              {githubFailure.primary.label}
            </Button>
          ) : null}
          {githubFailure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void onRetry()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      ) : null}

      <div className="admin-grid">
        <section className="intel-panel">
          {githubOAuthSetupRequired ? (
            // Was: "OAuth isn't configured on this server. Save a PAT
            // instead." — true, and useless: it named no variable and gave no
            // callback URL, so the admin could not act on it. The setup
            // message from githubSetupStatus() names both.
            <p className="app-muted github-oauth-note">
              {githubOAuthMessage || "OAuth isn’t configured on this server. Save a PAT instead."}{" "}
              <a href="/connectors">See all connectors</a>
            </p>
          ) : null}
          {githubCredentialRejected ? (
            <p className="app-muted github-oauth-note" role="status">
              GitHub refused the stored credential for @{githubCredentialRejected.login ?? "this account"}. The
              token was revoked, expired, or lost its scopes — Disconnect, then Connect GitHub again to issue a
              new one. Nothing that reads the repo (deploy log, code review, calendar milestones) works until
              then.
            </p>
          ) : null}
          {githubConnection ? (
            <article className="admin-org">
              <b>LINKED</b>
              <div>
                <strong>@{githubConnection.githubLogin ?? "github"}</strong>
                <small>
                  {githubConnection.authMethod} · {githubConnection.status}
                  {githubConnection.defaultRepoFullName
                    ? ` · ${githubConnection.defaultRepoFullName}`
                    : " · pick a default repo"}
                </small>
              </div>
            </article>
          ) : null}
          <div className="intel-actions">
            <button
              type="button"
              className={githubOAuthSetupRequired ? undefined : "primary-action"}
              disabled={githubBusy || githubOAuthSetupRequired || githubLoading}
              onClick={() => void onConnectOAuth()}
            >
              {githubOAuthSetupRequired
                ? "Connect GitHub (OAuth unavailable)"
                : githubCredentialRejected
                  ? "Reconnect GitHub"
                  : "Connect GitHub"}
            </button>
            {/* A rejected credential leaves no `connection` (that loader wants
                a spendable token), but the row and its dead token are still
                there — so Disconnect has to stay reachable, or the only way to
                clear it is a support request. */}
            {githubConnection || githubCredentialRejected ? (
              <button type="button" disabled={githubBusy} onClick={() => void onDisconnect()}>
                Disconnect
              </button>
            ) : null}
          </div>
        </section>
        <section className="intel-panel">
          <form onSubmit={onSavePat}>
            <span className="eyebrow">{githubOAuthSetupRequired ? "CONNECT WITH PAT" : "OR SAVE A PAT"}</span>
            <label>
              Personal access token
              <input
                type="password"
                autoComplete="off"
                value={githubPat}
                onChange={(e) => setGithubPat(e.target.value)}
                placeholder="ghp_… or github_pat_…"
                required
              />
            </label>
            <button className="primary-action" disabled={githubBusy}>
              Save token
            </button>
          </form>
          {githubConnection ? (
            <form id="github-default-repo" onSubmit={onSetDefaultRepo} style={{ marginTop: "1.25rem" }}>
              <span className="eyebrow">DEFAULT REPO</span>
              <label>
                Repository
                <select value={defaultRepo} onChange={(e) => setDefaultRepo(e.target.value)} required>
                  <option value="">Choose a repository…</option>
                  {githubRepos.map((repo) => (
                    <option key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}
                      {repo.private ? " (private)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {!githubRepos.length ? (
                <p className="app-muted">No repositories on this account yet.</p>
              ) : null}
              <button className="primary-action" disabled={githubBusy || !defaultRepo}>
                Set default repo
              </button>
            </form>
          ) : null}
        </section>
      </div>
    </section>
  );
}
