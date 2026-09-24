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
      <h2>{githubConnection ? "Connected" : "Connect GitHub"}</h2>
      <p className="app-muted">
        {githubConnection
          ? "Pick the repository your robot code lives in."
          : "Sign in with GitHub, or paste a personal access token if sign-in isn’t available."}
      </p>

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
            // Server setup copy names what to paste; fall back to a student-readable line.
            <p className="app-muted github-oauth-note">
              {githubOAuthMessage || "GitHub sign-in isn’t available here, so use a token instead."}
            </p>
          ) : null}
          {githubCredentialRejected ? (
            <p className="app-muted github-oauth-note" role="status">
              GitHub stopped accepting the saved sign-in for @{githubCredentialRejected.login ?? "this account"}.
              Disconnect, then connect again. Until then nothing can read the repo.
            </p>
          ) : null}
          {githubConnection ? (
            <article className="admin-org">
              <b>LINKED</b>
              <div>
                <strong>@{githubConnection.githubLogin ?? "github"}</strong>
                <small>
                  {githubConnection.authMethod === "pat" ? "Token" : "GitHub sign-in"}
                  {githubConnection.defaultRepoFullName
                    ? ` · ${githubConnection.defaultRepoFullName}`
                    : " · no repository picked yet"}
                </small>
              </div>
            </article>
          ) : null}
          <div className="intel-actions">
            {githubConnection || githubOAuthSetupRequired ? null : (
              <Button
                variant="primary"
                type="button"
                disabled={githubBusy || githubLoading}
                onClick={() => void onConnectOAuth()}
              >
                {githubCredentialRejected ? "Reconnect GitHub" : "Sign in with GitHub"}
              </Button>
            )}
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
          {githubConnection ? null : (
            <details className="github-token" open={githubOAuthSetupRequired}>
              <summary>Use a personal access token instead</summary>
              <form onSubmit={onSavePat}>
                <ol className="github-token-steps">
                  <li>On GitHub, open Settings → Developer settings → Personal access tokens.</li>
                  <li>Make a token that can read your robot-code repository.</li>
                  <li>Paste it here and press Save token.</li>
                </ol>
                <label>
                  Personal access token
                  <input
                    type="password"
                    autoComplete="off"
                    value={githubPat}
                    onChange={(e) => setGithubPat(e.target.value)}
                    placeholder="e.g. github_pat_…"
                    required
                  />
                </label>
                <Button variant={githubOAuthSetupRequired ? "primary" : "secondary"} type="submit" disabled={githubBusy}>
                  Save token
                </Button>
              </form>
            </details>
          )}
          {githubConnection ? (
            <form id="github-default-repo" onSubmit={onSetDefaultRepo}>
              <label>
                Robot-code repository
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
              <Button variant="primary" type="submit" disabled={githubBusy || !defaultRepo}>
                Save repository
              </Button>
            </form>
          ) : null}
        </section>
      </div>
    </section>
  );
}
