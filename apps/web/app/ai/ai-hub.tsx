"use client";

import dynamic from "next/dynamic";
import { HubLegacyRedirect, HubOrgGate, ProductHubShell } from "../../components/product-hub";
import { FinanceInAiPanel } from "./finance-in-ai-panel";
import "../product-hub.css";
import "../chat/chat.css";
import "../code/code.css";

const ChatClient = dynamic(() => import("../chat/chat-client"), { ssr: false });
const BudgetClient = dynamic(() => import("../team/budgets/budget-client"), { ssr: false });
const WriterClient = dynamic(() => import("../writer/writer-client"), { ssr: false });
const CodeClient = dynamic(() => import("../code/code-client").then((m) => m.CodeClient), { ssr: false });
const AiMemoryClient = dynamic(() => import("../team/ai-memory/ai-memory-client"), { ssr: false });
const AiPolicyClient = dynamic(() => import("../team/ai-policy/ai-policy-client"), { ssr: false });

export default function AiHub() {
  return (
    <ProductHubShell hubId="ai">
      {({ tab, orgId }) => (
        <HubOrgGate orgId={orgId} label="AI">
          {(id) => {
            if (tab === "chat") return <ChatClient orgId={id} initialPrompt="" source="" contextId="" />;
            if (tab === "budgets") return <BudgetClient orgId={id} />;
            if (tab === "writer") return <WriterClient />;
            if (tab === "code") return <CodeClient orgId={id} related="ai" />;
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
