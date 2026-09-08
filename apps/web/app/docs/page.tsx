import HelpClient from "../help/help-client";
import SectionGuide from "./section-guide";

export const metadata = {
  title: "App manual",
};

export const dynamic = "force-dynamic";

/**
 * The Soft-UI app manual — Account / Settings → App manual.
 *
 * Two views of one manual: the same categorised, searchable article index that
 * /help renders, plus the section-by-section guide (`/docs?view=sections`) that
 * walks every workbench by season moment. /help is the canonical article index;
 * /docs/<slug> stays as an alias for old article links, and `?q=` prefills the
 * search on both.
 */
export default function DocsPage() {
  return <HelpClient sectionGuide={<SectionGuide />} />;
}
