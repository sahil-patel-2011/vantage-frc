"use client";

import { type ReactNode } from "react";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  VIDEO_ANALYSIS_RELATED_INCLUDE,
  VIDEO_PAGE_DESCRIPTION,
  videoAnalysisRelatedLinks,
  videoAnalysisSetupSteps,
  videoAnalysisShellCopy,
  type VideoAnalysisNextAction,
  type VideoAnalysisShellKind,
} from "../../lib/video-analysis/video-analysis-related";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { hubWorkbenchHref } from "../../lib/nav/hubs";

export function VideoRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = videoAnalysisRelatedLinks(orgId, {
    include: [...VIDEO_ANALYSIS_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related video-analysis-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function VideoNextActionsPanel({ actions }: { actions: VideoAnalysisNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions video-analysis-next-actions" aria-label="Next actions">
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

export function VideoAnalysisShell({
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: VideoAnalysisShellKind;
  error?: string;
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const copy = videoAnalysisShellCopy(shell);
  const setup = shell === "setup" ? videoAnalysisSetupSteps(orgId)[0] : null;
  const competitionHref = hubWorkbenchHref("competition", "video-analysis", orgId);
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          },
        )
      : null;

  return (
    <main className="module-page video-analysis-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Video"}
          </>
        }
        title="Video"
        description={VIDEO_PAGE_DESCRIPTION}
      >
        <VideoRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        className="video-analysis-empty"
        badge={failure ? undefined : copy.badge}
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {shell === "error" && onRetry && (failure?.showRetry ?? true) ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
      </EmptyState>
    </main>
  );
}
