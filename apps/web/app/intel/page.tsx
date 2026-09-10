import { EmptyState, Button } from "../../components/ui";
import { intelSetupSteps, intelShellCopy } from "../../lib/intel/intel-related";
import IntelClient from "./intel-client";
import "./intel.css";

export const metadata = {
  title: "Team Intel",
};

export default async function IntelPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = intelShellCopy("setup");
    const setup = intelSetupSteps(null)[0];
    return (
      <main className="module-page intel-page soft-gate">
        <EmptyState
          soft
          badge={copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
        >
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }
  return <IntelClient orgId={orgId} />;
}
