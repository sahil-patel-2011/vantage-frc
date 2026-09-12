"use client";

import { BUGBOT_ULTRA_PRICES_USD } from "@vantage/agent/bugbot";
import { EmptyState, Button } from "../../components/ui";
import { WhyPanel } from "../../components/why-panel";
import { bugbotScanMetaLine } from "../../lib/bugbot";
import { BUGBOT_INSTRUCTION_MAX } from "../../lib/cockpit/prefs";
import type { CodeReadyViewProps } from "./code-view-props";

export type CodeBugbotPanelProps = Pick<
  CodeReadyViewProps,
  | "orgId"
  | "busy"
  | "hasSource"
  | "githubHref"
  | "bugbotMode"
  | "setBugbotMode"
  | "bugbotMeta"
  | "includeScanTests"
  | "setIncludeScanTests"
  | "cockpit"
  | "instructions"
  | "setInstructions"
  | "githubConnected"
  | "githubLogin"
  | "selectedRepo"
  | "setSelectedRepo"
  | "repos"
  | "setSelectedRef"
  | "githubEmptyReason"
  | "robotFiles"
  | "loadGithubFile"
  | "treeTruncated"
  | "planLoading"
  | "scanPlan"
  | "showCoverage"
  | "setShowCoverage"
  | "scanPlanReason"
  | "lastScan"
  | "runBugbot"
  | "requestWritePr"
  | "writePrConfirming"
  | "progress"
  | "coverage"
  | "delta"
  | "fixedFindings"
  | "bugbot"
  | "dismissTarget"
  | "setDismissTarget"
  | "dismissReason"
  | "setDismissReason"
  | "submitDismissal"
  | "bugbotNarrations"
  | "dismissals"
  | "restoreDismissal"
  | "history"
>;

export function CodeBugbotPanel({
  orgId,
  busy,
  hasSource,
  githubHref,
  bugbotMode,
  setBugbotMode,
  bugbotMeta,
  includeScanTests,
  setIncludeScanTests,
  cockpit,
  instructions,
  setInstructions,
  githubConnected,
  githubLogin,
  selectedRepo,
  setSelectedRepo,
  repos,
  setSelectedRef,
  githubEmptyReason,
  robotFiles,
  loadGithubFile,
  treeTruncated,
  planLoading,
  scanPlan,
  showCoverage,
  setShowCoverage,
  scanPlanReason,
  lastScan,
  runBugbot,
  requestWritePr,
  writePrConfirming,
  progress,
  coverage,
  delta,
  fixedFindings,
  bugbot,
  dismissTarget,
  setDismissTarget,
  dismissReason,
  setDismissReason,
  submitDismissal,
  bugbotNarrations,
  dismissals,
  restoreDismissal,
  history,
}: CodeBugbotPanelProps) {
  return (
      <section className="cdc-workbench" id="bugbot" aria-label="AI Bugbot">
        <article className="cdc-panel">
          <header>
            <div>
              <span className="app-badge">{bugbotMode === "ultra" ? "Bugbot Ultra" : "Subscription"}</span>
              <h2>AI Bugbot</h2>
              <p className="app-muted" style={{ margin: "4px 0 0" }}>
                Connect a GitHub repo, scan robot-code, then optionally propose a human-approved diff and recheck.
                Findings must quote the source. Never deploys, never pushes.
                {bugbotScanMetaLine(bugbotMeta ?? {})}
              </p>
            </div>
          </header>

          <div className="cdc-bugbot-modes" role="group" aria-label="Bugbot billing mode">
            <button
              type="button"
              className={bugbotMode === "subscription" ? "is-active" : undefined}
              disabled={busy}
              onClick={() => setBugbotMode("subscription")}
            >
              <strong>On your subscription</strong>
              <span>Plan allowance or your own keys</span>
            </button>
            <button
              type="button"
              className={bugbotMode === "ultra" ? "is-active" : undefined}
              disabled={busy}
              onClick={() => setBugbotMode("ultra")}
            >
              <strong>Bugbot Ultra</strong>
              <span>
                ${BUGBOT_ULTRA_PRICES_USD.scan.toFixed(2)} scan · ${BUGBOT_ULTRA_PRICES_USD.fix.toFixed(2)} fix · $
                {BUGBOT_ULTRA_PRICES_USD.recheck.toFixed(2)} recheck
              </span>
            </button>
          </div>

          <div className="cdc-cockpit">
            <label className="appearance-check">
              <input
                type="checkbox"
                checked={includeScanTests}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.checked;
                  setIncludeScanTests(next);
                  void fetch("/api/account/cockpit", {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      cockpit: { ...cockpit, includeScanTests: next, bugbotInstructions: instructions },
                    }),
                  });
                }}
              />
              Include our tests in the repo scan
            </label>
            <label>
              Custom instructions
              <textarea
                value={instructions}
                maxLength={BUGBOT_INSTRUCTION_MAX}
                rows={2}
                disabled={busy}
                placeholder="Short notes Bugbot must follow. Empty is fine."
                onChange={(event) => setInstructions(event.target.value)}
                onBlur={() => {
                  if (instructions === cockpit.bugbotInstructions) return;
                  void fetch("/api/account/cockpit", {
                    method: "PUT",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({
                      cockpit: { ...cockpit, bugbotInstructions: instructions, includeScanTests },
                    }),
                  });
                }}
              />
            </label>
            <p className="app-muted" style={{ margin: 0, fontSize: 12 }}>
              Subscription / your key uses the team or member key on{" "}
              <a href="/team/ai-keys">AI keys</a> (Ollama, LM Studio, OpenAI, …). Ultra is the hosted SKU.
              More knobs live under Account → Appearance → Cockpit.
            </p>
          </div>

          {!orgId ? (
            <EmptyState
              soft
              badge="Needs setup"
              badgeTone="setup"
              title="Choose your team for Bugbot"
              description="Local pattern review is free. GitHub scans and both Bugbot modes need a team."
            >
              <Button as="a" variant="primary" href="/workspace">
                Choose your team
              </Button>
            </EmptyState>
          ) : !githubConnected ? (
            <EmptyState
              soft
              badge="GitHub"
              badgeTone="setup"
              title="Connect a GitHub repo to scan"
              description="Owners and admins link a PAT or OAuth app under Team admin. You can still paste a file below without GitHub."
            >
              <Button as="a" variant="primary" href={githubHref}>
                Connect GitHub
              </Button>
            </EmptyState>
          ) : (
            <div className="cdc-github-scan">
              <p className="app-muted" style={{ margin: 0 }}>
                Linked as {githubLogin ?? "GitHub"} · read-only. Pick the robot-code repo to scan.
              </p>
              <label>
                Repository
                <select
                  value={selectedRepo}
                  onChange={(event) => {
                    const next = event.target.value;
                    setSelectedRepo(next);
                    const meta = repos.find((repo) => repo.fullName === next);
                    if (meta?.defaultBranch) setSelectedRef(meta.defaultBranch);
                  }}
                  aria-label="GitHub repository"
                >
                  {!selectedRepo ? <option value="">Choose a repository</option> : null}
                  {repos.map((repo) => (
                    <option key={repo.fullName} value={repo.fullName}>
                      {repo.fullName}
                      {repo.private ? " (private)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              {githubEmptyReason && !repos.length ? <p className="app-muted">{githubEmptyReason}</p> : null}
              {robotFiles.length ? (
                <label>
                  Robot-code files
                  <select
                    defaultValue=""
                    onChange={(event) => {
                      const filePath = event.target.value;
                      if (filePath) void loadGithubFile(filePath);
                    }}
                    aria-label="GitHub robot-code file"
                  >
                    <option value="">Load one file into the editor</option>
                    {robotFiles.map((file) => (
                      <option key={file} value={file}>
                        {file}
                      </option>
                    ))}
                  </select>
                </label>
              ) : selectedRepo ? (
                <p className="app-muted">
                  {treeTruncated
                    ? "Tree listing truncated — no robot-code files in the first slice."
                    : "No .java / .cpp / .py files visible in this tree yet."}
                </p>
              ) : null}
            </div>
          )}

          {/*
            The scan plan is free: it answers "what will you read, what will you
            skip, and what does it cost" BEFORE any metered call. A team should
            never discover the price or the coverage after the fact.
          */}
          {githubConnected && selectedRepo ? (
            <section className="cdc-scan-plan" aria-label="Scan plan">
              {planLoading ? (
                <p className="app-muted" style={{ margin: 0 }}>
                  Planning a scan of {selectedRepo}…
                </p>
              ) : scanPlan ? (
                <>
                  <header className="cdc-scan-plan-head">
                    <strong>
                      Scan plan · {scanPlan.repo}@{scanPlan.sha ? scanPlan.sha.slice(0, 7) : scanPlan.ref}
                    </strong>
                    <span className={`cdc-scan-cost ${bugbotMode === "ultra" ? "paid" : "included"}`}>
                      {bugbotMode === "ultra"
                        ? `$${scanPlan.cost.totalUsd.toFixed(2)} · $${scanPlan.cost.perChunkUsd.toFixed(2)} × ${scanPlan.chunkCount} chunk${scanPlan.chunkCount === 1 ? "" : "s"}`
                        : `${scanPlan.chunkCount} metered call${scanPlan.chunkCount === 1 ? "" : "s"} on your team's keys or plan allowance`}
                    </span>
                  </header>
                  <p className="app-muted" style={{ margin: 0 }}>
                    Will read {scanPlan.reviewed.length} robot-code file
                    {scanPlan.reviewed.length === 1 ? "" : "s"} of {scanPlan.candidateCount} found, {scanPlan.chunkFiles} per
                    chunk, entry points first.
                    {scanPlan.deferredCount > 0
                      ? ` ${scanPlan.deferredCount} file${scanPlan.deferredCount === 1 ? "" : "s"} will NOT be reached by this scan's chunk budget.`
                      : ""}
                    {scanPlan.treeTruncated ? " GitHub truncated the tree listing for this repo." : ""}
                  </p>
                  {scanPlan.skipCounts.length ? (
                    <ul className="cdc-skip-list" aria-label="Files this scan will skip">
                      {scanPlan.skipCounts.map((item) => (
                        <li key={item.reason}>
                          <strong>{item.count}</strong> {item.label}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <Button variant="ghost" type="button" className="cdc-coverage-toggle" aria-expanded={showCoverage} onClick={() => setShowCoverage((prev) => !prev)}>
                    {showCoverage ? "Hide the file list" : "Show exactly which files"}
                  </Button>
                  {showCoverage ? (
                    <div className="cdc-coverage-detail">
                      <div>
                        <h4>Reviewed</h4>
                        <ol>
                          {scanPlan.reviewed.map((item) => (
                            <li key={item.path}>
                              <code>{item.path}</code>
                              <small className="app-muted">
                                {item.role.replace(/_/g, " ")} · chunk {item.chunk + 1}
                              </small>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <div>
                        <h4>Skipped</h4>
                        <ol>
                          {scanPlan.skipped.slice(0, 60).map((item) => (
                            <li key={item.path}>
                              <code>{item.path}</code>
                              <small className="app-muted">{item.reason.replace(/_/g, " ")}</small>
                            </li>
                          ))}
                        </ol>
                        {scanPlan.skipped.length > 60 || scanPlan.skippedListTruncated ? (
                          <p className="app-muted">
                            Listing the first 60 skipped paths — the counts above cover every file in the tree.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : scanPlanReason ? (
                <p className="app-muted" style={{ margin: 0 }}>
                  {scanPlanReason}
                </p>
              ) : null}
            </section>
          ) : null}

          <footer className="cdc-bugbot-actions">
            <Button
              type="button"
              variant="primary"
              disabled={busy || !orgId || !hasSource}
              onClick={() => void runBugbot({ mode: bugbotMode, phase: "scan", scanRepo: false })}
            >
              {bugbotMode === "ultra" ? `Scan file · $${BUGBOT_ULTRA_PRICES_USD.scan.toFixed(2)}` : "Scan this file"}
            </Button>
            <Button variant="secondary" type="button" disabled={busy || !orgId || !githubConnected || !selectedRepo} onClick={() => void runBugbot({ mode: bugbotMode, phase: "scan", scanRepo: true })}>
              {bugbotMode === "ultra"
                ? `Scan repo · $${(scanPlan?.cost.totalUsd ?? BUGBOT_ULTRA_PRICES_USD.scan).toFixed(2)}`
                : scanPlan
                  ? `Scan connected repo · ${scanPlan.chunkCount} chunk${scanPlan.chunkCount === 1 ? "" : "s"}`
                  : "Scan connected repo"}
            </Button>
            <Button variant="secondary" type="button" disabled={busy || !orgId || (!hasSource && !lastScan?.scanRepo)} onClick={() => void runBugbot({ mode: bugbotMode, phase: "fix", scanRepo: false })}>
              {bugbotMode === "ultra" ? `Propose fix · $${BUGBOT_ULTRA_PRICES_USD.fix.toFixed(2)}` : "Propose fix"}
            </Button>
            <Button variant="secondary" type="button" disabled={busy || !orgId || (!hasSource && !lastScan?.scanRepo)} onClick={() => void runBugbot({ mode: bugbotMode, phase: "recheck", scanRepo: false })}>
              {bugbotMode === "ultra" ? `Recheck · $${BUGBOT_ULTRA_PRICES_USD.recheck.toFixed(2)}` : "Recheck"}
            </Button>
          </footer>
          {lastScan?.scanRepo ? (
            <p className="app-muted" style={{ margin: 0, fontSize: 12 }}>
              Fix and recheck target the scanned repo{lastScan.repo ? ` ${lastScan.repo}` : ""}
              {lastScan.sha ? ` (fix pinned to ${lastScan.sha.slice(0, 7)})` : ""} — not the editor buffer.
            </p>
          ) : null}
          {bugbotMeta?.repoOverview ? (
            <section className="cdc-repo-overview" aria-label="What this repo looks like">
              <h3>What this repo looks like</h3>
              <pre>{bugbotMeta.repoOverview}</pre>
            </section>
          ) : null}

          {/* Running cost and coverage while a chunked scan is in flight. */}
          {progress ? (
            <section
              className={`cdc-scan-progress${progress.partial ? " partial" : ""}`}
              aria-label="Scan progress"
              aria-live="polite"
            >
              <div
                className="cdc-scan-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.chunkCount}
                aria-valuenow={progress.chunkIndex}
                aria-valuetext={`chunk ${progress.chunkIndex} of ${progress.chunkCount}`}
              >
                <span
                  style={{
                    width: `${Math.round((progress.chunkIndex / Math.max(1, progress.chunkCount)) * 100)}%`,
                  }}
                />
              </div>
              <p style={{ margin: 0 }}>
                {progress.running ? "Scanning" : "Scan finished"} · chunk {progress.chunkIndex} of{" "}
                {progress.chunkCount}
                {bugbotMode === "ultra" ? ` · $${progress.spentUsd.toFixed(2)} spent so far` : ""}
              </p>
              {progress.partial && progress.partialReason ? (
                <p className="cdc-partial-note" style={{ margin: 0 }}>
                  <strong>Partial coverage.</strong> {progress.partialReason}. Findings below cover only the files
                  that were actually read — this is not a clean bill of health for the repo.
                </p>
              ) : null}
            </section>
          ) : null}

          {/* What the finished pass read, and the NEW / KNOWN / FIXED delta. */}
          {coverage && coverage.reviewedFiles.length ? (
            <section className="cdc-coverage" aria-label="Scan coverage">
              <p style={{ margin: 0 }}>
                Reviewed {coverage.reviewedFiles.length} file
                {coverage.reviewedFiles.length === 1 ? "" : "s"}
                {coverage.candidateCount > coverage.reviewedFiles.length
                  ? ` of ${coverage.candidateCount} robot-code files`
                  : ""}
                .
              </p>
              {delta ? (
                <p className="cdc-delta" style={{ margin: 0 }}>
                  <span className="cdc-delta-chip new">{delta.new} new</span>
                  <span className="cdc-delta-chip known">{delta.known} known</span>
                  <span className="cdc-delta-chip fixed">{delta.fixed} fixed</span>
                </p>
              ) : null}
              {fixedFindings.length ? (
                <details>
                  <summary>
                    Fixed since the last scan ({fixedFindings.length})
                  </summary>
                  <ul>
                    {fixedFindings.map((item) => (
                      <li key={item.fingerprint}>
                        <code>{item.filePath}</code> — {item.finding}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <details>
                <summary>Files read this pass ({coverage.reviewedFiles.length})</summary>
                <ol>
                  {coverage.reviewedFiles.map((file) => (
                    <li key={file}>
                      <code>{file}</code>
                    </li>
                  ))}
                </ol>
              </details>
              {coverage.skipCounts.length ? (
                <details>
                  <summary>
                    Skipped, and why ({coverage.skipCounts.reduce((sum, item) => sum + item.count, 0)})
                  </summary>
                  <ul>
                    {coverage.skipCounts.map((item) => (
                      <li key={item.reason}>
                        <strong>{item.count}</strong> {item.label}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          ) : null}

          {bugbotMeta?.proposedDiff ? (
            <div className="cdc-proposal">
              <span>Proposed fix · human approval required</span>
              <strong>
                Never pushed to GitHub · never deployed
                {bugbotMeta.githubSha
                  ? ` · fixed against ${bugbotMeta.githubRepo ? `${bugbotMeta.githubRepo}@` : ""}${bugbotMeta.githubSha.slice(0, 7)}`
                  : ""}
              </strong>
              {bugbotMeta.branchMoved ? (
                <p className="app-muted" style={{ margin: 0, fontSize: 12 }}>
                  Branch moved since that scan — this diff targets the scanned commit. Rescan recommended before
                  applying.
                </p>
              ) : null}
              <pre aria-label="Bugbot unified diff">{bugbotMeta.proposedDiff}</pre>
              {lastScan?.scanRepo ? (
                <Button variant="secondary" type="button" disabled={busy || !orgId} onClick={() => void requestWritePr()}>
                  {writePrConfirming ? "Confirm open pull request" : "Approve and open pull request"}
                </Button>
              ) : (
                <p className="app-muted" style={{ margin: 0, fontSize: 12 }}>
                  Open pull request is only available after a repo scan (repo + sha), not the editor sample.
                </p>
              )}
            </div>
          ) : null}

          {bugbot ? (
            bugbot.findings.length === 0 ? (
              <EmptyState
                soft
                badge="Clear"
                badgeTone="good"
                title="No grounded Bugbot findings"
                description="Nothing quoted from this source survived. Empty is not certification — still simulate before enable."
              />
            ) : (
              <div className="cdc-bugbot-table-wrap">
                <table className="cdc-bugbot-table">
                  <caption className="visually-hidden">AI Bugbot findings</caption>
                  <thead>
                    <tr>
                      <th>Severity</th>
                      <th>Location</th>
                      <th>Finding</th>
                      <th>Triage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bugbot.findings.map((item, index) => (
                      <tr key={item.fingerprint ?? `${item.location}-${index}`}>
                        <td>
                          <span className={`cdc-severity ${item.severity}`}>{item.severity}</span>
                          <small className="app-muted">{item.source === "model" ? "model" : "local"}</small>
                        </td>
                        <td>
                          <code>{item.location}</code>
                          {item.delta ? (
                            <small className={`cdc-delta-chip ${item.delta}`}>{item.delta}</small>
                          ) : null}
                        </td>
                        <td>
                          <p style={{ margin: 0 }}>{item.finding}</p>
                          <code>{item.evidence}</code>
                        </td>
                        <td>
                          {item.fingerprint ? (
                            <Button variant="ghost" type="button" disabled={busy} onClick={() => { setDismissTarget(item); setDismissReason(""); }}>
                              Dismiss
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {dismissTarget ? (
                  <form
                    className="cdc-dismiss-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void submitDismissal();
                    }}
                  >
                    <p style={{ margin: 0 }}>
                      Dismiss <code>{dismissTarget.location}</code> — why is this one fine?
                    </p>
                    <label>
                      <span className="visually-hidden">Dismissal reason</span>
                      <input
                        value={dismissReason}
                        onChange={(event) => setDismissReason(event.target.value)}
                        placeholder="e.g. deliberate — the limit is set in Constants.java"
                        maxLength={500}
                        aria-label="Dismissal reason"
                      />
                    </label>
                    <div className="cdc-dismiss-actions">
                      <Button type="submit" variant="primary" disabled={busy || dismissReason.trim().length < 3}>
                        Dismiss this finding
                      </Button>
                      <Button variant="ghost" type="button" onClick={() => { setDismissTarget(null); setDismissReason(""); }}>
                        Cancel
                      </Button>
                    </div>
                    <p className="app-muted" style={{ margin: 0, fontSize: 12 }}>
                      Kept against this finding&apos;s fingerprint, so it stays dismissed across commits even when
                      the line moves. Restore it any time.
                    </p>
                  </form>
                ) : null}
                {bugbot.droppedUngrounded > 0 ? (
                  <p className="app-muted">
                    Dropped {bugbot.droppedUngrounded} ungrounded model claim{bugbot.droppedUngrounded === 1 ? "" : "s"} that
                    did not quote this source.
                  </p>
                ) : null}
              </div>
            )
          ) : orgId ? (
            <EmptyState
              soft
              badge="Idle"
              badgeTone="setup"
              title="No Bugbot pass yet"
              description="Scan a connected repo or this file. Subscription uses your key. Ultra is the published hosted SKU. Findings stay empty until evidence is in the source."
            >
              <Button as="a" variant="secondary" href={githubHref}>
                GitHub connection
              </Button>
            </EmptyState>
          ) : null}
          {bugbotNarrations.length ? (
            <WhyPanel
              narrations={bugbotNarrations}
              orgId={orgId || undefined}
              title="Why Bugbot flagged this"
              subtitle={`${bugbotNarrations.length} grounded finding${bugbotNarrations.length === 1 ? "" : "s"} · every quote comes from your own source`}
            />
          ) : null}
          {dismissals.length ? (
            <details className="cdc-dismissals">
              <summary>Dismissed findings ({dismissals.length})</summary>
              <ul>
                {dismissals.map((item) => (
                  <li key={item.fingerprint}>
                    <div>
                      <code>{item.filePath ?? "—"}</code>
                      <span className="app-muted"> — {item.reason}</span>
                    </div>
                    <Button variant="ghost" type="button" disabled={busy} onClick={() => void restoreDismissal(item.fingerprint)}>
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="app-muted">
                Dismissals are kept per finding fingerprint, so they survive new commits and moved lines.
              </p>
            </details>
          ) : null}

          {history.length ? (
            <ol className="cdc-bugbot-history" aria-label="Recent Bugbot runs">
              {history.slice(0, 6).map((row) => (
                <li key={row.id}>
                  <strong>{row.path}</strong>
                  <span>
                    {row.tier ?? "subscription"} · {row.phase ?? "scan"} · {row.riskLevel} · {row.localRiskCount} local ·{" "}
                    {row.modelFindingCount} model
                    {row.newFindingCount != null || row.knownFindingCount != null || row.fixedFindingCount != null
                      ? ` · ${row.newFindingCount ?? 0} new / ${row.knownFindingCount ?? 0} known / ${row.fixedFindingCount ?? 0} fixed`
                      : ""}
                    {(row.chunkCount ?? 1) > 1 ? ` · chunk ${(row.chunkIndex ?? 0) + 1}/${row.chunkCount}` : ""}
                    {row.githubSha ? ` · ${row.githubSha.slice(0, 7)}` : ""}
                    {row.chargeUsd && Number(row.chargeUsd) > 0 ? ` · $${Number(row.chargeUsd).toFixed(2)}` : ""}
                    {row.model ? ` · ${row.model}` : ""}
                  </span>
                  {row.partial ? (
                    <span className="cdc-partial-tag" title={row.partialReason ?? undefined}>
                      partial coverage
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : null}
        </article>
      </section>
  );
}
