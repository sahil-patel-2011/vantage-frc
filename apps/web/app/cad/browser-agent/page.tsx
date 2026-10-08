import { Button } from "../../../components/ui/button";
import { PageHeader } from "../../../components/ui/page-header";
import BrowserAgentClient from "./client";
import styles from "./browser-agent.module.css";

export const metadata = {
  title: "Onshape browser pilot",
  description: "Authorize a paired computer for the WA Robotics Team 6925 browser CAD development pilot.",
};

export default async function BrowserAgentPage({ searchParams }: {
  searchParams: Promise<{ orgId?: string | string[] }>;
}) {
  const params = await searchParams;
  const orgId = typeof params.orgId === "string" ? params.orgId : "";
  return (
    <main className={`module-page ${styles.page}`}>
      <PageHeader breadcrumbs="CAD / Browser pilot" title="Onshape browser pilot"
        description="CAD through the Onshape interface, with your paired computer." />
      <div className={styles.preview}>
        <span className={styles.badge}>Development preview</span>
        <p>The packaged desktop connector is not released yet. Development builds can open an Onshape browser after you choose to start it. The web version can authorize a paired device for testing.</p>
      </div>
      {orgId ? <BrowserAgentClient orgId={orgId} /> : (
        <section className={styles.card} aria-labelledby="choose-team-title">
          <h2 id="choose-team-title">Choose your team</h2>
          <p>This pilot is limited to current members of WA Robotics Team 6925.</p>
          <Button as="a" variant="primary" href="/workspace">Choose your team</Button>
        </section>
      )}
    </main>
  );
}
