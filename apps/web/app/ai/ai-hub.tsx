"use client";

import dynamic from "next/dynamic";
import { AiSponsorBranding } from "../../components/ai-sponsor-branding";
import { HubLegacyRedirect, HubOrgGate, ProductHubShell } from "../../components/product-hub";
import { AskCanvas } from "./ask-canvas";
import { WorkspacePane } from "./workspace-pane";
import { FinanceInAiPanel } from "./finance-in-ai-panel";
import "../product-hub.css";
import "../chat/chat.css";
import "../code/code.css";

const BudgetClient = dynamic(() => import("../team/budgets/budget-client"), { ssr: false });
const CodeClient = dynamic(() => import("../code/code-client").then((m) => m.CodeClient), { ssr: false });
const DecisionsClient = dynamic(() => import("../decisions/decisions-client"), { ssr: false });
const AiMemoryClient = dynamic(() => import("../team/ai-memory/ai-memory-client"), { ssr: false });
const AiPolicyClient = dynamic(() => import("../team/ai-policy/ai-policy-client"), { ssr: false });

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

const SETTINGS_GROUPS = [
  {
    id: "limits",
    label: "Limits",
    items: [{ id: "budgets", label: "Budgets", hint: "Spend and token caps" }],
  },
  {
    id: "access",
    label: "Access",
    items: [
      { id: "ai-keys", label: "API keys", hint: "Yours or the team's" },
      { id: "ai-bridge", label: "Subscription", hint: "Claude or ChatGPT on a Pi" },
    ],
  },
  {
    id: "policy",
    label: "Policy",
    items: [
      { id: "memory", label: "Memory", hint: "What the assistant remembers" },
      { id: "governance", label: "Governance", hint: "Allowlists and approvals" },
      { id: "finance", label: "Finance", hint: "Ledger redaction" },
    ],
  },
  {
    id: "meter",
    label: "Usage",
    items: [
      { id: "usage", label: "Usage", hint: "Metered calls" },
      { id: "ai-usage", label: "BYOK usage", hint: "Your own keys" },
    ],
  },
];

const LIBRARY_GROUPS = [
  {
    id: "notes",
    label: "Notes",
    items: [{ id: "decisions", label: "Decisions", hint: "What you chose and why" }],
  },
  {
    id: "find",
    label: "Find",
    items: [
      { id: "decision-search", label: "Search", hint: "Past decisions" },
      { id: "season-report", label: "Season report", hint: "From logged entries" },
    ],
  },
  {
    id: "code",
    label: "Code",
    items: [
      { id: "code", label: "Code", hint: "Review and lessons" },
      { id: "bugbot", label: "Bugbot", hint: "Scan robot code" },
    ],
  },
];

export default function AiHub() {
  return (
    <ProductHubShell
      hubId="ai"
      headerActions={<AiSponsorBranding />}
      embeddedTabs={EMBEDDED_TABS}
      hideNestedStripFor={["chat", "decisions", "budgets"]}
    >
      {({ tab, orgId, selectTab }) => (
        <HubOrgGate orgId={orgId} label="Ask">
          {(id) => {
            if (tab === "chat" || tab === "writer" || tab === "agent") {
              return <AskCanvas orgId={id} mode={tab} onMode={selectTab} />;
            }
            if (SETTINGS_GROUPS.some((group) => group.items.some((item) => item.id === tab))) {
              return (
                <WorkspacePane
                  groups={SETTINGS_GROUPS}
                  value={tab}
                  onChange={selectTab}
                  searchPlaceholder="Search settings"
                >
                  {tab === "budgets" ? <BudgetClient orgId={id} /> : null}
                  {tab === "memory" ? <AiMemoryClient orgId={id} /> : null}
                  {tab === "governance" ? <AiPolicyClient orgId={id} /> : null}
                  {tab === "finance" ? <FinanceInAiPanel orgId={id} /> : null}
                  {tab === "ai-keys" || tab === "ai-bridge" || tab === "usage" || tab === "ai-usage" ? (
                    <HubLegacyRedirect hubId="ai" tab={tab} orgId={id} />
                  ) : null}
                </WorkspacePane>
              );
            }
            if (LIBRARY_GROUPS.some((group) => group.items.some((item) => item.id === tab))) {
              return (
                <WorkspacePane
                  groups={LIBRARY_GROUPS}
                  value={tab}
                  onChange={selectTab}
                  searchPlaceholder="Search library"
                >
                  {tab === "decisions" ? <DecisionsClient /> : null}
                  {tab === "code" || tab === "bugbot" ? (
                    <CodeClient orgId={id} related="ai" focusBugbot={tab === "bugbot"} />
                  ) : null}
                  {tab === "decision-search" || tab === "season-report" ? (
                    <HubLegacyRedirect hubId="ai" tab={tab} orgId={id} />
                  ) : null}
                </WorkspacePane>
              );
            }
            return <HubLegacyRedirect hubId="ai" tab={tab} orgId={id} />;
          }}
        </HubOrgGate>
      )}
    </ProductHubShell>
  );
}
