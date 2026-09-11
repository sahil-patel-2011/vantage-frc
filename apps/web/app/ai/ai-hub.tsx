"use client";

import dynamic from "next/dynamic";
import { AiSponsorBranding } from "../../components/ai-sponsor-branding";
import { HubLegacyRedirect, HubOrgGate, ProductHubShell } from "../../components/product-hub";
import "../product-hub.css";

const ChatClient = dynamic(() => import("../chat/chat-client"), { ssr: false });
const BudgetClient = dynamic(() => import("../team/budgets/budget-client"), { ssr: false });
const WriterClient = dynamic(() => import("../writer/writer-client"), { ssr: false });
const CodeClient = dynamic(() => import("../code/code-client").then((m) => m.CodeClient), { ssr: false });
const DecisionsClient = dynamic(() => import("../decisions/decisions-client"), { ssr: false });
const AiMemoryClient = dynamic(() => import("../team/ai-memory/ai-memory-client"), { ssr: false });
const AiPolicyClient = dynamic(() => import("../team/ai-policy/ai-policy-client"), { ssr: false });
const AutonomousAgentPanel = dynamic(
  () => import("./autonomous-agent-panel").then((m) => m.AutonomousAgentPanel),
  { ssr: false },
);
const FinanceInAiPanel = dynamic(
  () => import("./finance-in-ai-panel").then((m) => m.FinanceInAiPanel),
  { ssr: false },
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
    <ProductHubShell hubId="ai" headerActions={<AiSponsorBranding />} embeddedTabs={EMBEDDED_TABS}>
      {({ tab, orgId }) => (
        <HubOrgGate orgId={orgId} label="AI">
          {(id) => {
            if (tab === "chat") return <ChatClient orgId={id} initialPrompt="" source="" contextId="" />;
            if (tab === "agent") return <AutonomousAgentPanel orgId={id} />;
            if (tab === "budgets") return <BudgetClient orgId={id} />;
            if (tab === "writer") return <WriterClient orgId={id} />;
            if (tab === "code" || tab === "bugbot") {
              return <CodeClient orgId={id} related="ai" focusBugbot={tab === "bugbot"} />;
            }
            if (tab === "decisions") return <DecisionsClient />;
            if (tab === "memory") return <AiMemoryClient orgId={id} />;
            if (tab === "governance") return <AiPolicyClient orgId={id} />;
            if (tab === "finance") return <FinanceInAiPanel orgId={id} />;
            return <HubLegacyRedirect hubId="ai" tab={tab} orgId={id} />;
          }}
        </HubOrgGate>
      )}
    </ProductHubShell>
  );
}
