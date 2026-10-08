import { Button } from "../../../components/ui/button";
import { PageHeader } from "../../../components/ui/page-header";
import BrowserAgentClient from "./client";
import styles from "./browser-agent.module.css";

export const metadata = {
  title: "Browser CAD",
  description: "Build and refine Onshape parts with the WA Robotics Team 6925 development pilot.",
};

export default async function BrowserAgentPage({ searchParams }: {
  searchParams: Promise<{ orgId?: string | string[] }>;
}) {
  const params = await searchParams;
  const orgId = typeof params.orgId === "string" ? params.orgId : "";
  return (
    <main className={`module-page ${styles.page}`}>
      <PageHeader breadcrumbs="CAD / Browser CAD" title="Browser CAD"
        description="Build, refine and inspect your Onshape models." />
      <div className={styles.preview}>
        <span className={styles.badge}>Development preview</span>
        <p>Team 6925 pilot. The desktop release is not available yet.</p>
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
