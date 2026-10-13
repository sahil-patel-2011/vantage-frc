"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AiSponsorBranding } from "../../components/ai-sponsor-branding";
import { HubLegacyRedirect, HubOrgGate, HubPanelSkeleton, ProductHubShell } from "../../components/product-hub";
import { PageMain } from "../../components/ui";
import { SettingsLayout } from "../../components/settings-layout";
import { useClientAccessProfile } from "../../lib/nav/use-client-access";
import { clientCanAccessHubTab } from "../../lib/nav/hub-access-filter";
import { HubTabForbidden } from "../../components/hub-access-gate";
import { askAiHref } from "../../lib/ai-skills/catalog";
import { fetchActiveOrgId, persistOrgIdInUrl, readOrgIdFromSearch } from "../../lib/nav/resolve-org";
import { FinanceInAiPanel } from "./finance-in-ai-panel";
import "../product-hub.css";
import "../chat/chat.css";
import "../code/code.css";

const ChatClient = dynamic(() => import("../chat/chat-client"), { ssr: false, loading: HubPanelSkeleton });
const BudgetClient = dynamic(() => import("../team/budgets/budget-client"), { ssr: false, loading: HubPanelSkeleton });
const WriterClient = dynamic(() => import("../writer/writer-client"), { ssr: false, loading: HubPanelSkeleton });
const CodeClient = dynamic(() => import("../code/code-client").then((m) => m.CodeClient), { ssr: false, loading: HubPanelSkeleton });
const DecisionsClient = dynamic(() => import("../decisions/decisions-client"), { ssr: false, loading: HubPanelSkeleton });
const AiMemoryClient = dynamic(() => import("../team/ai-memory/ai-memory-client"), { ssr: false, loading: HubPanelSkeleton });
const AiPolicyClient = dynamic(() => import("../team/ai-policy/ai-policy-client"), { ssr: false, loading: HubPanelSkeleton });

/** What a link into Ask AI carried (lib/ai-skills/catalog `askAiHref`). */
export type AskAiParams = {
  skill: string | null;
  prompt: string;
  from: string | null;
  about: string | null;
  sponsorId: string | null;
  teamKey: string | null;
  matchKey: string | null;
  mode: "background" | null;
  source: string;
  contextId: string;
};

/** Control tabs rendered inline below. Anything else opens its own route directly. */
const EMBEDDED_TABS = [
  "chat",
  "budgets",
  "code",
  "bugbot",
  "memory",
  "governance",
  "finance",
  "decisions",
] as const;

/**
 * Ask AI is the page: no tab row of tools, one primary action (Send). It resolves the team the
 * same way a hub does — `?orgId=` first, then the remembered team.
 */
function AssistantPage({ ask, surface = "chat" }: { ask: AskAiParams; surface?: "chat" | "budgets" }) {
  const label = surface === "budgets" ? "AI limits" : "Ask AI";
  const [orgId, setOrgId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const fromUrl = readOrgIdFromSearch(window.location.search);
    if (fromUrl) {
      setOrgId(fromUrl);
      setReady(true);
      return;
    }
    void fetchActiveOrgId().then((active) => {
      if (cancelled) return;
      setOrgId(active);
      if (active) persistOrgIdInUrl(active);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <PageMain className="module-page ch-page ask-page" aria-busy>
        <header className="app-page-header ask-head">
          <div>
            <h1>{label}</h1>
          </div>
        </header>
        <HubPanelSkeleton />
      </PageMain>
    );
  }
  if (!orgId) {
    return (
      <PageMain className="module-page ch-page ask-page">
        <header className="app-page-header ask-head">
          <div>
            <h1>{label}</h1>
          </div>
          <AiSponsorBranding />
        </header>
        <HubOrgGate orgId={null} label={label}>
          {() => null}
        </HubOrgGate>
      </PageMain>
    );
  }
  if (surface === "budgets") return <BudgetClient orgId={orgId} />;
  return (
    <ChatClient
      key={JSON.stringify(ask)}
      orgId={orgId}
      initialPrompt={ask.prompt}
      source={ask.source}
      contextId={ask.contextId}
      initialSkill={ask.skill}
      initialMode={ask.mode}
      page={{ from: ask.from, about: ask.about, sponsorId: ask.sponsorId, teamKey: ask.teamKey, matchKey: ask.matchKey }}
    />
  );
}

/** A control tab's row still offers "Ask AI": it opens the assistant page itself. */
function OpenAssistant({ orgId }: { orgId: string }) {
  useEffect(() => {
    window.location.replace(askAiHref({ orgId }));
  }, [orgId]);
  return <HubPanelSkeleton />;
}

/** AI limits moved into Settings; retain the hub tab's existing visibility gate. */
function AiLimitsPage({ ask }: { ask: AskAiParams }) {
  const access = useClientAccessProfile();
  return <SettingsLayout>
    {!access.ready ? <HubPanelSkeleton /> : !clientCanAccessHubTab(access.hubAccess, "ai", "budgets")
      ? <HubTabForbidden hubLabel="AI" tabLabel="AI limits" />
      : <AssistantPage ask={ask} surface="budgets" />}
  </SettingsLayout>;
}

export default function AiHub({ initialTab, ask }: { initialTab?: string | null; ask: AskAiParams }) {
  // The chat, and the former Agent tab (now "Work on this in the background"), are one page.
  if (!initialTab || initialTab === "chat" || initialTab === "agent") return <AssistantPage ask={ask} />;
  if (initialTab === "budgets") return <AiLimitsPage ask={ask} />;
  // The former Writer tab: saved drafts and templates. Drafting with AI happens in Ask AI.
  if (initialTab === "writer") return <WriterClient />;
  return (
    <ProductHubShell hubId="ai" headerActions={<AiSponsorBranding />} embeddedTabs={EMBEDDED_TABS} initialTab={initialTab}>
      {({ tab, orgId }) => (
        <HubOrgGate orgId={orgId} label="AI">
          {(id) => {
            if (tab === "chat") return <OpenAssistant orgId={id} />;
            if (tab === "budgets") return <BudgetClient orgId={id} />;
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
