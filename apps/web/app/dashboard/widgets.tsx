"use client";

import { memo } from "react";
import dynamic from "next/dynamic";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import { withOrgHref } from "../../lib/nav/product-nav";
import { AskAiWidget } from "./widgets/ask-ai";
import { NextMatchLive } from "./widgets/next-match";
import { emptyHintFor, WidgetShell as Shell } from "./widgets/widget-shell";
import { OnboardingChecklistCard } from "./widgets/onboarding-card";
import {
  FilesRecentLive,
  LearnProgressLive,
  MyDayLive,
  TeamChatLive,
} from "./widgets/home-cards";

export { LiveCountdown, countdownLabel, useCountdownTick } from "./widgets/live-countdown";

const ExtraWidgetView = dynamic(
  () => import("./widgets/extra-widget-view").then((mod) => mod.ExtraWidgetView),
  { ssr: false },
);

const STUDENT_WIDGET_TYPES = new Set([
  "next_match",
  "ask_ai",
  "my_day",
  "learn_progress",
  "files_recent",
  "team_chat",
  "team_todos",
  "onboarding_checklist",
]);

export const DashboardWidgetView = memo(function DashboardWidgetView({
  type,
  payload,
  orgId,
  tbaConfigured,
}: {
  type: string;
  payload?: WidgetPayload;
  orgId: string;
  tbaConfigured?: boolean;
}) {
  const data = payload?.data ?? {};
  const withOrg = (href: string) => withOrgHref(href, orgId || null);
  const hint = emptyHintFor(type);

  if (!STUDENT_WIDGET_TYPES.has(type)) {
    return <ExtraWidgetView type={type} payload={payload} orgId={orgId} tbaConfigured={tbaConfigured} />;
  }

  switch (type) {
    case "next_match": {
      const myDayHref =
        typeof data.href === "string" && data.href ? data.href : withOrg("/my-day");
      return (
        <Shell
          type={type}
          title="Next match"
          payload={payload}
          href={myDayHref}
          emptyHint={hint}
          orgId={orgId}
        >
          {payload?.status === "live" ? <NextMatchLive data={data} /> : null}
        </Shell>
      );
    }
    case "ask_ai": {
      const href = typeof data.href === "string" && data.href ? data.href : "/ai?tab=chat";
      const askHref = withOrg(href);
      return (
        <Shell type={type} title="Ask AI" payload={payload} href={askHref} emptyHint={hint} orgId={orgId} preferChildren>
          <AskAiWidget href={askHref} />
        </Shell>
      );
    }
    case "my_day":
      return (
        <Shell type={type} title="My day" payload={payload} href={withOrg("/my-day")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <MyDayLive data={data} /> : null}
        </Shell>
      );
    case "learn_progress":
      return (
        <Shell type={type} title="Learn" payload={payload} href={withOrg("/cad-learn")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <LearnProgressLive data={data} /> : null}
        </Shell>
      );
    case "files_recent":
      return (
        <Shell type={type} title="Recent files" payload={payload} href={withOrg("/files")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <FilesRecentLive data={data} /> : null}
        </Shell>
      );
    case "team_chat":
      return (
        <Shell type={type} title="Team chat" payload={payload} href={withOrg("/messages")} emptyHint={hint} orgId={orgId}>
          {payload?.status === "live" ? <TeamChatLive data={data} /> : null}
        </Shell>
      );
    case "team_todos": {
      const items =
        (data.items as Array<{
          id: string;
          title: string;
          status: string;
          dueOn: string | null;
          assigneeName: string | null;
        }> | undefined) ?? [];
      return (
        <Shell type={type} title="Team todos" payload={payload} href={withOrg("/todos")} emptyHint={hint} orgId={orgId} preferChildren>
          {payload?.status === "live" ? (
            <div className="dash-metric-grid" style={{ marginBottom: items.length ? 10 : 0 }}>
              <div>
                <strong>{String(data.open ?? 0)}</strong>
                <span>open</span>
              </div>
              <div>
                <strong>{String(data.mineOpen ?? 0)}</strong>
                <span>mine</span>
              </div>
              <div>
                <strong>{String(data.overdue ?? 0)}</strong>
                <span>overdue</span>
              </div>
            </div>
          ) : null}
          {payload?.status === "live" && items.length > 0 ? (
            <ul className="dash-checklist">
              {items.map((item) => (
                <li key={item.id}>
                  <a href={withOrg(`/todos?todoId=${encodeURIComponent(item.id)}`)}>
                    <span>{item.title}</span>
                    <small className="dash-notif-preview">
                      {item.status}
                      {item.assigneeName ? ` · ${item.assigneeName}` : ""}
                      {item.dueOn ? ` · ${item.dueOn}` : ""}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </Shell>
      );
    }
    case "onboarding_checklist": {
      const steps =
        (data.steps as Array<{
          key: string;
          label: string;
          detail: string;
          done: boolean;
          href: string;
        }> | undefined) ?? [];
      return <OnboardingChecklistCard steps={steps} payload={payload} orgId={orgId} />;
    }
    default:
      return <ExtraWidgetView type={type} payload={payload} orgId={orgId} tbaConfigured={tbaConfigured} />;
  }
});
