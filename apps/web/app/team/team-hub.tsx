"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { EmptyState } from "../../components/ui";
import { HubLegacyRedirect, HubOrgGate, HubPanelSkeleton, ProductHubShell } from "../../components/product-hub";
import { parseComposerLinkFromSearch, type MessageObjectLink } from "../../lib/messages/object-links";
import "../product-hub.css";
import "./calendar/team-calendar.css";
import "../attendance/attendance.css";
import "../practice/practice.css";
import "./knowledge/knowledge.css";
import "../batteries/batteries.css";
import "../todos/todos.css";
import "../logistics/logistics.css";

const TeamCalendarClient = dynamic(() => import("./calendar/team-calendar-client"), { ssr: false, loading: HubPanelSkeleton });
const TodosClient = dynamic(() => import("../todos/todos-client"), { ssr: false, loading: HubPanelSkeleton });
const MessagesClient = dynamic(() => import("../messages/messages-client"), { ssr: false, loading: HubPanelSkeleton });
const PracticeClient = dynamic(() => import("../practice/practice-client"), { ssr: false, loading: HubPanelSkeleton });
const KnowledgeClient = dynamic(() => import("./knowledge/knowledge-client"), { ssr: false, loading: HubPanelSkeleton });
const AttendanceClient = dynamic(() => import("../attendance/attendance-client"), { ssr: false, loading: HubPanelSkeleton });
const BatteriesClient = dynamic(() => import("../batteries/batteries-client"), { ssr: false, loading: HubPanelSkeleton });
const FmeaClient = dynamic(() => import("../fmea/fmea-client"), { ssr: false, loading: HubPanelSkeleton });
const LogisticsClient = dynamic(() => import("../logistics/logistics-client"), { ssr: false, loading: HubPanelSkeleton });

function MessagesTab({ orgId }: { orgId: string }) {
  const [initialConversationId, setInitialConversationId] = useState<string | null>(null);
  const [initialObjectLink, setInitialObjectLink] = useState<MessageObjectLink | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setInitialConversationId(params.get("conversationId"));
    setInitialObjectLink(parseComposerLinkFromSearch(params, orgId));
    setReady(true);
  }, [orgId]);

  if (!ready) {
    return (
      <EmptyState
        soft
        aria-busy
        badge="Loading"
        title="Opening team chat"
        description="Loading conversations for this team."
      />
    );
  }
  return (
    <MessagesClient
      orgId={orgId}
      embedded
      initialConversationId={initialConversationId}
      initialObjectLink={initialObjectLink}
    />
  );
}

/** Tab ids rendered inline below. Anything else opens its own route directly. */
const EMBEDDED_TABS = ["calendar", "logistics", "todos", "practice", "knowledge", "attendance", "batteries", "fmea", "messages"] as const;

export default function TeamHub() {
  return (
    <ProductHubShell hubId="team" embeddedTabs={EMBEDDED_TABS}>
      {({ tab, orgId }) => {
        if (tab === "logistics") {
          return <HubOrgGate orgId={orgId} label="Logistics">{() => <LogisticsClient embedded />}</HubOrgGate>;
        }
        if (tab === "calendar") {
          return (
            <HubOrgGate orgId={orgId} label="Calendar">
              {() => <TeamCalendarClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "todos") {
          return (
            <HubOrgGate orgId={orgId} label="Work">
              {() => <TodosClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "practice") {
          return (
            <HubOrgGate orgId={orgId} label="Practice">
              {() => <PracticeClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "knowledge") {
          return (
            <HubOrgGate orgId={orgId} label="Playbook">
              {() => <KnowledgeClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "attendance") {
          return (
            <HubOrgGate orgId={orgId} label="People">
              {() => <AttendanceClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "batteries") {
          return (
            <HubOrgGate orgId={orgId} label="Batteries">
              {() => <BatteriesClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "fmea") {
          return (
            <HubOrgGate orgId={orgId} label="Failure notes">
              {() => <FmeaClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "messages") {
          return (
            <HubOrgGate orgId={orgId} label="Chat">
              {(id) => <MessagesTab orgId={id} />}
            </HubOrgGate>
          );
        }
        return <HubLegacyRedirect hubId="team" tab={tab} orgId={orgId} />;
      }}
    </ProductHubShell>
  );
}
