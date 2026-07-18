"use client";

import dynamic from "next/dynamic";
import { HubOrgGate, ProductHubShell } from "../../components/product-hub";
import { FinanceInAiPanel } from "./finance-in-ai-panel";
import "../product-hub.css";
import "../chat/chat.css";

const ChatClient = dynamic(() => import("../chat/chat-client"), { ssr: false });
const BudgetClient = dynamic(() => import("../team/budgets/budget-client"), { ssr: false });
const AiPolicyClient = dynamic(() => import("../team/ai-policy/ai-policy-client"), { ssr: false });

export default function AiHub() {
  return (
    <ProductHubShell hubId="ai">
      {({ tab, orgId }) => (
        <HubOrgGate orgId={orgId} label="AI">
          {(id) => {
            if (tab === "chat") return <ChatClient orgId={id} initialPrompt="" source="" contextId="" />;
            if (tab === "budgets") return <BudgetClient orgId={id} />;
            if (tab === "governance") return <AiPolicyClient orgId={id} />;
            if (tab === "finance") return <FinanceInAiPanel orgId={id} />;
            return null;
          }}
        </HubOrgGate>
      )}
    </ProductHubShell>
  );
}