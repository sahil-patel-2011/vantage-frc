import AssignmentPage from "../scouting/lineup/assignment-page";
import { assignmentWorkspaceHref } from "../../lib/scouting/assignment-navigation";
import ScoutCoverageLiveClient from "./scout-coverage-live-client";

export const metadata = { title: "Scouting assignments" };

export default async function ScoutCoverageLivePage({ searchParams }: {
  searchParams: Promise<{ orgId?: string; eventKey?: string; matchKey?: string; qualsOnly?: string; view?: string }>;
}) {
  const params = await searchParams;
  if (params.view === "review" && params.orgId) {
    return <ScoutCoverageLiveClient key={`${params.orgId}:${params.eventKey ?? "active"}`} orgId={params.orgId}
      assignmentHref={assignmentWorkspaceHref({ orgId: params.orgId, eventKey: params.eventKey, matchKey: params.matchKey, qualsOnly: params.qualsOnly !== "0" && params.qualsOnly !== "false" })} />;
  }
  return <AssignmentPage searchParams={Promise.resolve(params)} />;
}
