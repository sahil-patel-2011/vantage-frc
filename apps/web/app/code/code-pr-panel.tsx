"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui";
import { withOrgHref } from "../../lib/nav/product-nav";
import type { CodeMap } from "../../lib/github/code-map";
import { duplicateCanIds } from "../../lib/github/code-map";
import type { PrReviewFinding } from "../../lib/github/pr-review";
import "./code-pr.css";

type Review = {
  id: string;
  prNumber: number;
  headSha: string;
  title: string;
  htmlUrl: string | null;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  trigger: "manual" | "webhook";
  summary: string | null;
  risk: "low" | "medium" | "high" | null;
  findings: PrReviewFinding[];
  filesChanged: number;
  filesReviewed: number;
  error: string | null;
  reviewedAt: string | null;
  updatedAt: string;
  stale?: boolean;
};

type Pull = {
  number: number;
  title: string;
  authorLogin: string | null;
  htmlUrl: string | null;
  headSha: string;
  draft: boolean;
  updatedAt: string | null;
  review: Review | null;
};

type View =
  | { status: "setup"; reason: "not_connected" | "no_repo"; canManage: boolean }
  | {
      status: "ready";
      repo: string;
      branch: string;
      canManage: boolean;
      canReview: boolean;
      autoReviews: { enabled: boolean; lastDeliveryAt: string | null; webhookRegistered: boolean };
      pulls: Pull[];
      earlier: Review[];
      githubError: string | null;
      codeMap: { repoFullName: string; ref: string; headSha: string; generatedAt: string; map: CodeMap } | null;
    };

type ManualHook = { url: string; secret: string; events: string[] };

const RISK_LABEL = { low: "Low risk", medium: "Medium risk", high: "High risk" } as const;

function when(iso: string | null): string {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
}

function blobHref(repo: string, sha: string, file: string, line: number | null): string {
  return `https://github.com/${repo}/blob/${sha}/${file.split("/").map(encodeURIComponent).join("/")}${line ? `#L${line}` : ""}`;
}

function ReviewChip({ review, current }: { review: Review | null; current: boolean }) {
  if (!review) return <span className="cpr-chip">Not reviewed</span>;
  if (review.status === "running" && !review.stale) return <span className="cpr-chip busy">Reviewing…</span>;
  if (review.status === "running" || review.status === "failed") return <span className="cpr-chip bad">Didn&apos;t finish</span>;
  if (review.status === "skipped") return <span className="cpr-chip">Nothing to review</span>;
  const count = review.findings.length;
  return (
    <span className={`cpr-chip ${review.risk ?? "low"}`}>
      {RISK_LABEL[review.risk ?? "low"]} · {count} finding{count === 1 ? "" : "s"}
      {current ? "" : " · older commit"}
    </span>
  );
}

function Findings({ review, repo }: { review: Review; repo: string }) {
  return (
    <div className="cpr-review">
      {review.summary ? <p className="cpr-summary">{review.summary}</p> : null}
      {review.error && review.status !== "done" ? <p className="cpr-error" role="alert">{review.error}</p> : null}
      {review.findings.length ? (
        <ol className="cpr-findings">
          {review.findings.map((finding, index) => (
            <li key={`${finding.file}:${finding.line}:${index}`} className={`sev-${finding.severity}`}>
              <div className="cpr-finding-head">
                <span className={`cpr-sev ${finding.severity}`}>{finding.severity}</span>
                <strong>{finding.title}</strong>
              </div>
              <a className="cpr-where" href={blobHref(repo, review.headSha, finding.file, finding.line)} target="_blank" rel="noreferrer">
                {finding.file}
                {finding.line ? `:${finding.line}` : ""}
              </a>
              <code className="cpr-quote">{finding.quote}</code>
              {finding.detail ? <p>{finding.detail}</p> : null}
            </li>
          ))}
        </ol>
      ) : review.status === "done" ? (
        <p className="app-muted">No problems found in the changed lines.</p>
      ) : null}
      <p className="cpr-meta app-muted">
        {review.trigger === "webhook" ? "Reviewed automatically" : "Reviewed on request"}
        {review.reviewedAt ? ` ${when(review.reviewedAt)}` : ""} · {review.filesReviewed} of {review.filesChanged} files · commit{" "}
        {review.headSha.slice(0, 7)}
      </p>
    </div>
  );
}

function CodeMapCard({ codeMap, canRefresh, busy, onRefresh }: {
  codeMap: Extract<View, { status: "ready" }>["codeMap"];
  canRefresh: boolean;
  busy: boolean;
  onRefresh: () => void;
}) {
  const dupes = codeMap ? duplicateCanIds(codeMap.map) : [];
  return (
    <section className="cpr-map app-card soft-panel" aria-label="Robot code map">
      <header className="cpr-head">
        <div>
          <h2>Robot code map</h2>
          <p className="app-muted">
            {codeMap
              ? `${codeMap.repoFullName}@${codeMap.ref} · commit ${codeMap.headSha.slice(0, 7)} · mapped ${when(codeMap.generatedAt)}`
              : "Not mapped yet. Ask AI and the Build tools use this map when you ask about the robot."}
          </p>
        </div>
        {canRefresh ? (
          <Button variant="secondary" type="button" disabled={busy} onClick={onRefresh}>
            {busy ? "Mapping…" : codeMap ? "Refresh" : "Map the code"}
          </Button>
        ) : null}
      </header>
      {codeMap ? (
        <dl className="cpr-map-grid">
          <div>
            <dt>Builds with</dt>
            <dd>
              {codeMap.map.language === "unknown" ? "Unknown language" : codeMap.map.language} · WPILib {codeMap.map.wpilibVersion ?? "unknown"}
            </dd>
          </div>
          <div>
            <dt>Vendor libraries</dt>
            <dd>{codeMap.map.vendorLibraries.join(", ") || "None"}</dd>
          </div>
          <div>
            <dt>Subsystems ({codeMap.map.subsystems.length})</dt>
            <dd>{codeMap.map.subsystems.map((s) => s.name).join(", ") || "None found"}</dd>
          </div>
          <div>
            <dt>Commands</dt>
            <dd>{codeMap.map.commands.length}</dd>
          </div>
          <div>
            <dt>CAN IDs in constants</dt>
            <dd>{codeMap.map.canIds.length}</dd>
          </div>
        </dl>
      ) : null}
      {dupes.length ? (
        <p className="cpr-warn" role="note">
          {dupes.map((d) => `CAN ID ${d.id} is used by ${d.names.join(" and ")}`).join(". ")}. Check the wiring before the next deploy.
        </p>
      ) : null}
    </section>
  );
}

export function CodePullRequests({ orgId }: { orgId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [manual, setManual] = useState<ManualHook | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/github/pulls?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      const data = (await response.json().catch(() => null)) as (View & { error?: string }) | null;
      if (!response.ok || !data || !("status" in data)) {
        setError(data?.error ?? "Could not load pull requests.");
        return;
      }
      setError("");
      setView(data);
    } catch {
      setError("Could not reach Vantage. Check the connection and try again.");
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(key: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(key);
    setError("");
    try {
      const response = await fetch("/api/github/pulls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...body }),
      });
      const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "That did not work. Try again.");
        return null;
      }
      return data;
    } catch {
      setError("Could not reach Vantage. Check the connection and try again.");
      return null;
    } finally {
      setBusy(null);
      await load();
    }
  }

  if (!view) {
    return (
      <section className="cpr app-card soft-panel" aria-label="Pull requests" aria-busy={!error}>
        <h2>Pull requests</h2>
        <p className="app-muted" role={error ? "alert" : "status"}>{error || "Loading pull requests…"}</p>
      </section>
    );
  }

  if (view.status === "setup") {
    return (
      <section className="cpr app-card soft-panel" aria-label="Pull requests">
        <h2>Pull requests</h2>
        {/* Say who has to act (A5-20): a student pressing Connect GitHub reached a token walkthrough
            the server then refused them. */}
        {view.canManage ? (
          <>
            <p className="app-muted">
              {view.reason === "not_connected"
                ? "Connect the team's GitHub so every pull request on the robot code gets an AI review, and Ask AI knows the code."
                : "Pick the robot code repository so its pull requests can be reviewed."}
            </p>
            {/* Secondary: the page's primary actions are the code review above; this is setup. */}
            <Button as="a" variant="secondary" href={withOrgHref("/connectors/github", orgId)}>
              {view.reason === "not_connected" ? "Connect GitHub" : "Pick the repository"}
            </Button>
          </>
        ) : (
          <p className="app-muted">
            {view.reason === "not_connected"
              ? "Pull request reviews start once your team's owner or an admin connects GitHub. Ask one of them to connect it."
              : "Pull request reviews start once your team's owner or an admin picks the robot code repository. Ask one of them."}
          </p>
        )}
      </section>
    );
  }

  const auto = view.autoReviews;
  return (
    <>
      <section className="cpr app-card soft-panel" aria-label="Pull requests">
        <header className="cpr-head">
          <div>
            <h2>Pull requests</h2>
            <p className="app-muted">
              {view.repo} · AI review of the changed lines, metered like Bugbot. Nothing is posted to GitHub.
            </p>
          </div>
          {view.canManage ? (
            <label className="cpr-switch">
              <input
                type="checkbox"
                role="switch"
                checked={auto.enabled}
                disabled={busy !== null}
                onChange={async (event) => {
                  const data = await post("auto", { action: "auto-reviews", enabled: event.target.checked });
                  setManual((data?.manual as ManualHook | null | undefined) ?? null);
                }}
              />
              <span>
                Review every new pull request
                <small>
                  {auto.enabled
                    ? auto.lastDeliveryAt
                      ? `On · GitHub last checked in ${when(auto.lastDeliveryAt)}`
                      : auto.webhookRegistered
                        ? "On · waiting for the first pull request"
                        : "On · add the webhook below to finish"
                    : "Off · review one at a time below"}
                </small>
              </span>
            </label>
          ) : (
            <p className="cpr-auto-note app-muted">{auto.enabled ? "Automatic reviews are on." : "Automatic reviews are off."}</p>
          )}
        </header>

        {manual ? (
          <div className="cpr-manual" role="note">
            <strong>One step left in GitHub</strong>
            <p>
              The saved GitHub sign-in can read the repo but not add webhooks. In GitHub, open {view.repo} → Settings → Webhooks →
              Add webhook, and paste:
            </p>
            <dl>
              <div><dt>Payload URL</dt><dd><code>{manual.url}</code></dd></div>
              <div><dt>Content type</dt><dd><code>application/json</code></dd></div>
              <div><dt>Secret</dt><dd><code>{manual.secret}</code></dd></div>
              <div><dt>Events</dt><dd>Pull requests and Pushes</dd></div>
            </dl>
            <p className="app-muted">The secret is shown once. Turning reviews off and on makes a new one.</p>
          </div>
        ) : null}

        {view.githubError ? <p className="cpr-error" role="alert">{view.githubError}</p> : null}
        {error ? <p className="cpr-error" role="alert">{error}</p> : null}

        {view.pulls.length === 0 && !view.githubError ? (
          <p className="app-muted">No open pull requests on {view.repo}.</p>
        ) : null}

        <ul className="cpr-list">
          {view.pulls.map((pull) => {
            const review = pull.review;
            const current = review?.headSha === pull.headSha;
            const reviewing = busy === `review:${pull.number}` || (review?.status === "running" && !review.stale && current);
            const expanded = open === pull.number;
            return (
              <li key={pull.number}>
                <div className="cpr-row">
                  <button
                    type="button"
                    className="cpr-row-main"
                    aria-expanded={expanded}
                    disabled={!review}
                    onClick={() => setOpen(expanded ? null : pull.number)}
                  >
                    <strong>
                      #{pull.number} {pull.title}
                      {pull.draft ? <span className="cpr-draft">Draft</span> : null}
                    </strong>
                    <span className="app-muted">
                      {pull.authorLogin ?? "unknown"} · updated {when(pull.updatedAt)}
                    </span>
                  </button>
                  <ReviewChip review={review} current={current} />
                  {view.canReview ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      disabled={busy !== null || reviewing}
                      onClick={async () => {
                        const data = await post(`review:${pull.number}`, { action: "review", number: pull.number });
                        if (data) setOpen(pull.number);
                      }}
                    >
                      {reviewing ? "Reviewing…" : review && current && review.status === "done" ? "Review again" : "Review"}
                    </Button>
                  ) : null}
                </div>
                {expanded && review ? <Findings review={review} repo={view.repo} /> : null}
              </li>
            );
          })}
        </ul>

        {view.earlier.length ? (
          <details className="cpr-earlier">
            <summary data-disclosure>Earlier reviews ({view.earlier.length})</summary>
            <ul className="cpr-list">
              {view.earlier.map((review) => (
                <li key={review.id}>
                  <div className="cpr-row">
                    <span className="cpr-row-main static">
                      <strong>
                        #{review.prNumber} {review.title}
                      </strong>
                      <span className="app-muted">Closed or merged · reviewed {when(review.reviewedAt)}</span>
                    </span>
                    <ReviewChip review={review} current />
                  </div>
                  <Findings review={review} repo={view.repo} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <CodeMapCard
        codeMap={view.codeMap}
        canRefresh={view.canReview}
        busy={busy === "map"}
        onRefresh={() => void post("map", { action: "refresh-map" })}
      />
    </>
  );
}
