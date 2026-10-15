"use client";

import { useEffect, useState } from "react";
import { EmptyState, Button, PageMain, TabBar } from "../../components/ui";
import { MeteredAiCutoffBanner } from "../../components/metered-ai-cutoff-banner";
import { UsageCutoffBanner } from "../../components/usage-cutoff-banner";
import { withOrgHref } from "../../lib/nav/product-nav";
import { CodeBugbotPanel } from "./code-bugbot-panel";
import { CodeCoachPanel } from "./code-coach-panel";
import { CodePullRequests } from "./code-pr-panel";
import type { CodeReadyViewProps } from "./code-view-props";

export type { CodeReadyViewProps } from "./code-view-props";

type CodeTab = "review" | "scan" | "pulls";

/** In-page links (#cdc-source from Repo scan's "Paste a file", #bugbot) choose their tab. */
function tabForHash(hash: string): CodeTab | null {
  if (hash === "#cdc-source") return "review";
  if (hash === "#bugbot") return "scan";
  return null;
}

/*
  Code review: one header, three tabs, one main button per tab.

  It used to be about nine stacked blocks: a links strip, a fold of three billing cards and a
  "Next actions" card, three "Flag / Explain / Correct" cards, the editor, Bugbot, the code map
  and pull requests, with "Run AI Bugbot" and "Scan this file" doing the same thing, "Load
  teaching sample" and "Reset sample" doing the same thing, and Connect GitHub twice. Now:

    Review         paste or load a file, Run risk review (main), Build proposal
    Repo scan      Bugbot on a connected repo or the pasted file
    Pull requests  the code map and the team's pull requests

  What a scan costs is said once, next to the scan, and in the line at the foot of the page.
*/
export function CodeReadyView(props: CodeReadyViewProps) {
  const { orgId, embedded, budgetsHref, keysHref, showMeteredBanner, cutoffCode, message, initialTab } = props;
  const [tab, setTab] = useState<CodeTab>(initialTab ?? "review");
  // The hub's AI Bugbot tab (?tab=bugbot) opens on Repo scan, including after a soft navigation.
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const follow = () => {
      const next = tabForHash(window.location.hash);
      if (next) setTab(next);
    };
    follow();
    window.addEventListener("hashchange", follow);
    return () => window.removeEventListener("hashchange", follow);
  }, []);

  const tabs = [
    { id: "review", label: "Review" },
    { id: "scan", label: "Repo scan" },
    ...(orgId ? [{ id: "pulls", label: "Pull requests" }] : []),
  ];

  return (
    <PageMain className={`module-page cdc-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
        <header className="app-page-header">
          <div>
            <h1>Code review</h1>
            <p>
              Find risky robot-code patterns, learn why they fail on match day, and get a safer version to approve.
              Nothing is ever pushed to your robot or to GitHub.
            </p>
          </div>
        </header>
      ) : null}

      {!orgId ? (
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team for repo scans"
          description="Reviewing a pasted file works without a team. Scanning GitHub and pull requests need one."
          className="product-hub-setup"
        >
          <Button as="a" variant="secondary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      ) : null}

      {showMeteredBanner ? <MeteredAiCutoffBanner orgId={orgId} className="cdc-cutoff" /> : null}
      {cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} className="cdc-cutoff" /> : null}

      <TabBar
        tabs={tabs}
        value={tab}
        onChange={(id) => setTab(id as CodeTab)}
        aria-label="Code review"
        panelId="cdc-tab-panel"
        className="cdc-tabs"
      />

      {message ? (
        <p role="status" className="telemetry-status">
          {message}
        </p>
      ) : null}

      <div id="cdc-tab-panel" role="tabpanel" aria-label={tabs.find((entry) => entry.id === tab)?.label}>
        {tab === "review" ? <CodeCoachPanel {...props} /> : null}
        {tab === "scan" ? <CodeBugbotPanel {...props} /> : null}
        {tab === "pulls" && orgId ? <CodePullRequests orgId={orgId} /> : null}
      </div>

      {orgId ? (
        <p className="app-muted cdc-foot">
          Reviewing a pasted file runs on this device and is free. Repo scans use your team&apos;s{" "}
          <a href={keysHref}>AI keys</a> or plan credits, within your <a href={budgetsHref}>AI limits</a> ·{" "}
          <a href={withOrgHref("/team/usage", orgId)}>Usage</a>
        </p>
      ) : null}
    </PageMain>
  );
}
