"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { AiWorkspaceContext } from "../../components/ai-workspace-context";
import { ActionMenu, Modal } from "../../components/ui";
import { hubLegacyHref, type HubTabDef } from "../../lib/nav/hubs";
import { AiSponsorBranding } from "../../components/ai-sponsor-branding";
import { HubLegacyRedirect, HubOrgGate, HubPanelSkeleton, ProductHubShell } from "../../components/product-hub";
import { FinanceInAiPanel } from "./finance-in-ai-panel";
import "../product-hub.css";
import "../chat/chat.css";
import "../code/code.css";
import "./ai-workspace.css";

const ChatClient = dynamic(() => import("../chat/chat-client"), { ssr: false, loading: HubPanelSkeleton });
const BudgetClient = dynamic(() => import("../team/budgets/budget-client"), { ssr: false, loading: HubPanelSkeleton });
const WriterClient = dynamic(() => import("../writer/writer-client"), { ssr: false, loading: HubPanelSkeleton });
const CodeClient = dynamic(() => import("../code/code-client").then((m) => m.CodeClient), { ssr: false, loading: HubPanelSkeleton });
const DecisionsClient = dynamic(() => import("../decisions/decisions-client"), { ssr: false, loading: HubPanelSkeleton });
const AiMemoryClient = dynamic(() => import("../team/ai-memory/ai-memory-client"), { ssr: false, loading: HubPanelSkeleton });
const AiPolicyClient = dynamic(() => import("../team/ai-policy/ai-policy-client"), { ssr: false, loading: HubPanelSkeleton });
const AutonomousAgentPanel = dynamic(
  () => import("./autonomous-agent-panel").then((m) => m.AutonomousAgentPanel),
  { ssr: false, loading: HubPanelSkeleton },
);

/** Tab ids rendered inline below. Anything else opens its own route directly. */
const EMBEDDED_TABS = [
  "chat",
  "agent",
  "budgets",
  "writer",
  "code",
  "bugbot",
  "memory",
  "governance",
  "finance",
  "decisions",
] as const;

export default function AiHub() {
  return (
    <ProductHubShell hubId="ai" navigation="contextual" embeddedTabs={EMBEDDED_TABS}>
      {({ tab, orgId, selectTab, availableTabs }) => (
        <>
          <header className="ai-workspace-head">
            <div><h1>AI</h1><p>Ask, write, or work through a task.</p></div>
            <AiSponsorBranding />
          </header>
          <HubOrgGate orgId={orgId} label="AI">
            {(id) => <AiWorkspace key={id} orgId={id} tab={tab} selectTab={selectTab} availableTabs={availableTabs} />}
          </HubOrgGate>
        </>
      )}
    </ProductHubShell>
  );
}

const MODES = [
  { id: "chat", label: "Chat" },
  { id: "writer", label: "Write" },
  { id: "agent", label: "Run a task" },
] as const;
const isMode = (id: string) => MODES.some((mode) => mode.id === id);

function AiTool({ tab, orgId }: { tab: string; orgId: string }) {
  if (tab === "chat") return <ChatClient orgId={orgId} />;
  if (tab === "writer") return <WriterClient orgId={orgId} />;
  if (tab === "agent") return <AutonomousAgentPanel orgId={orgId} embedded />;
  if (tab === "budgets") return <BudgetClient orgId={orgId} />;
  if (tab === "decisions") return <DecisionsClient />;
  if (tab === "memory") return <AiMemoryClient orgId={orgId} />;
  if (tab === "governance") return <AiPolicyClient orgId={orgId} />;
  if (tab === "finance") return <FinanceInAiPanel orgId={orgId} />;
  if (tab === "code" || tab === "bugbot") return <CodeClient orgId={orgId} related="ai" focusBugbot={tab === "bugbot"} />;
  return <HubLegacyRedirect hubId="ai" tab={tab} orgId={orgId} />;
}

function AiWorkspace({ tab, orgId, selectTab, availableTabs }: {
  tab: string; orgId: string; selectTab: (tab: string) => void; availableTabs: HubTabDef[];
}) {
  const modes = MODES.filter((mode) => availableTabs.some((entry) => entry.id === mode.id));
  const [lastMode, setLastMode] = useState(isMode(tab) ? tab : modes[0]?.id ?? "chat");
  const [visited, setVisited] = useState<string[]>([tab]);
  const [lastTool, setLastTool] = useState(isMode(tab) ? null : tab);
  const toolsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setVisited((current) => current.includes(tab) ? current : [...current, tab]);
    if (isMode(tab)) setLastMode(tab);
    else setLastTool(tab);
  }, [tab]);
  const activeMode = isMode(tab) ? tab : modes.some((mode) => mode.id === lastMode) ? lastMode : modes[0]?.id;
  const toolOpen = !isMode(tab);
  const tool = toolOpen ? tab : lastTool;
  // Visit lazily, then retain editors. A switch must never discard an unsent message or draft.
  const rendered = Array.from(new Set([...visited, tab])).filter((id) => availableTabs.some((entry) => entry.id === id));
  const tools = availableTabs.filter((entry) => !isMode(entry.id));
  const openTool = (id: string) => {
    // The menu item disappears when selected. Restore to the persistent trigger on closing the panel.
    toolsRef.current?.querySelector<HTMLButtonElement>("button[aria-haspopup]")?.focus();
    selectTab(id);
  };
  return (
    <AiWorkspaceContext.Provider value={true}>
      <section className="ai-workspace" aria-label="AI workspace">
        <div className="ai-workspace-toolbar">
          {modes.length ? <label className="ai-workspace-mode">
            <span>Workspace</span>
            <select aria-label="AI workspace mode" value={activeMode} onChange={(event) => selectTab(event.target.value)}>
              {modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
            </select>
          </label> : <span>Team tools</span>}
          <div ref={toolsRef}>
            <ActionMenu label="AI tools" overflowLabel="Tools" overflowOnly actions={tools.map((entry) => ({
              id: entry.id, label: entry.id === "budgets" ? "Limits & settings" : entry.label,
              group: entry.id === "decisions" || entry.group === "decisions" ? "Work" : "Settings",
              ...(EMBEDDED_TABS.includes(entry.id as typeof EMBEDDED_TABS[number])
                ? { onClick: () => openTool(entry.id) }
                : { href: hubLegacyHref(entry, orgId) }),
            }))} />
          </div>
        </div>
        <div className="ai-workspace-body">
          {rendered.filter(isMode).map((id) => <section key={id} hidden={id !== activeMode} aria-label={`${MODES.find((mode) => mode.id === id)?.label} workspace`}>
            <AiTool tab={id} orgId={orgId} />
          </section>)}
        </div>
        {!modes.length ? <div className="ai-workspace-tool-body">
          <AiTool tab={tab} orgId={orgId} />
        </div> : tool ? <Modal open={toolOpen} keepMounted onClose={() => selectTab(activeMode ?? modes[0]?.id ?? "chat")}
          title={tool === "budgets" ? "Limits & settings" : availableTabs.find((entry) => entry.id === tool)?.label ?? "AI tools"} className="ai-workspace-panel">
          <div className="ai-workspace-tool-body product-hub-panel">
            {rendered.filter((id) => !isMode(id)).map((id) => <section key={id} hidden={id !== tool}>
              <AiTool tab={id} orgId={orgId} />
            </section>)}
          </div>
        </Modal> : null}
      </section>
    </AiWorkspaceContext.Provider>
  );
}
