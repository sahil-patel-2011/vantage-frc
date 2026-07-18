"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { HubLegacyRedirect, HubOrgGate, ProductHubShell } from "../../components/product-hub";
import { parseComposerLinkFromSearch, type MessageObjectLink } from "../../lib/messages/object-links";
import "../product-hub.css";
import "./calendar/team-calendar.css";
import "../attendance/attendance.css";
import "../practice/practice.css";
import "./knowledge/knowledge.css";
import "../batteries/batteries.css";

const TeamCalendarClient = dynamic(() => import("./calendar/team-calendar-client"), { ssr: false });
const TasksClient = dynamic(() => import("../tasks/tasks-client"), { ssr: false });
const MessagesClient = dynamic(() => import("../messages/messages-client"), { ssr: false });
const PracticeClient = dynamic(() => import("../practice/practice-client"), { ssr: false });
const KnowledgeClient = dynamic(() => import("./knowledge/knowledge-client"), { ssr: false });
const AttendanceClient = dynamic(() => import("../attendance/attendance-client"), { ssr: false });
const BatteriesClient = dynamic(() => import("../batteries/batteries-client"), { ssr: false });
const FmeaClient = dynamic(() => import("../fmea/fmea-client"), { ssr: false });

function TeamAdminLink() {
  const [href, setHref] = useState("/team/admin");
  useEffect(() => {
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    if (orgId) setHref(`/team/admin?orgId=${encodeURIComponent(orgId)}`);
  }, []);
  return (
    <a className="app-button secondary" href={href}>
      Team admin
    </a>
  );
}

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

  if (!ready) return null;
  return (
    <MessagesClient
      orgId={orgId}
      initialConversationId={initialConversationId}
      initialObjectLink={initialObjectLink}
    />
  );
}

export default function TeamHub() {
  return (
    <ProductHubShell hubId="team" headerActions={<TeamAdminLink />}>
      {({ tab, orgId }) => {
        if (tab === "calendar") return <TeamCalendarClient />;
        if (tab === "todos") return <TasksClient />;
        if (tab === "practice") return <PracticeClient />;
        if (tab === "knowledge") return <KnowledgeClient />;
        if (tab === "attendance") return <AttendanceClient />;
        if (tab === "batteries") return <BatteriesClient />;
        if (tab === "fmea") return <FmeaClient />;
        if (tab === "messages") {
          return (
            <HubOrgGate orgId={orgId} label="Messages">
              {(id) => <MessagesTab orgId={id} />}
            </HubOrgGate>
          );
        }
        return <HubLegacyRedirect hubId="team" tab={tab} orgId={orgId} />;
      }}
    </ProductHubShell>
  );
}
