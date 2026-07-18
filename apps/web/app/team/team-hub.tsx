"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { HubOrgGate, ProductHubShell } from "../../components/product-hub";
import "../product-hub.css";
import "./calendar/team-calendar.css";

const TeamCalendarClient = dynamic(() => import("./calendar/team-calendar-client"), { ssr: false });
const TasksClient = dynamic(() => import("../tasks/tasks-client"), { ssr: false });
const MessagesClient = dynamic(() => import("../messages/messages-client"), { ssr: false });
const PracticeClient = dynamic(() => import("../practice/practice-client"), { ssr: false });
const KnowledgeClient = dynamic(() => import("./knowledge/knowledge-client"), { ssr: false });
const AttendanceClient = dynamic(() => import("../attendance/attendance-client"), { ssr: false });

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

export default function TeamHub() {
  return (
    <ProductHubShell hubId="team" headerActions={<TeamAdminLink />}>
      {({ tab, orgId }) => {
        if (tab === "calendar") return <TeamCalendarClient />;
        if (tab === "todos") return <TasksClient />;
        if (tab === "practice") return <PracticeClient />;
        if (tab === "knowledge") return <KnowledgeClient />;
        if (tab === "attendance") return <AttendanceClient />;
        if (tab === "messages") {
          return (
            <HubOrgGate orgId={orgId} label="Messages">
              {(id) => <MessagesClient orgId={id} />}
            </HubOrgGate>
          );
        }
        return null;
      }}
    </ProductHubShell>
  );
}