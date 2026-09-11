import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  VIDEO_ANALYSIS_RELATED_INCLUDE,
  VIDEO_PAGE_DESCRIPTION,
  videoAnalysisRelatedLinks,
  videoAnalysisSetupSteps,
  videoAnalysisShellCopy,
} from "../../lib/video-analysis/video-analysis-related";
import VideoAnalysisClient from "./video-analysis-client";

export const metadata = {
  title: "Video",
};

export default async function VideoAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = videoAnalysisShellCopy("setup");
    const setup = videoAnalysisSetupSteps(null)[0];
    const links = videoAnalysisRelatedLinks(null, { include: [...VIDEO_ANALYSIS_RELATED_INCLUDE] });
    return (
      <main className="module-page video-analysis-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Video"
          title="Video"
          description={VIDEO_PAGE_DESCRIPTION}
        >
          <nav className="product-hub-related video-analysis-related" aria-label="Related competition tools">
            {links.map((link) => (
              <Button as="a" variant="secondary" key={link.id} href={link.href}>
                {link.label}
              </Button>
            ))}
          </nav>
        </PageHeader>
        <EmptyState soft badge={copy.badge} badgeTone="setup" title={copy.title} description={copy.description}>
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }
  return <VideoAnalysisClient orgId={orgId} />;
}
