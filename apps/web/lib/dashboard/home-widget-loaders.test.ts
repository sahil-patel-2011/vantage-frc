import { describe, expect, it } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { getHelpArticle } from "../help/articles";
import {
  DASHBOARD_WIDGET_TYPES,
  WIDGET_CATALOG,
  widgetRegistryMeta,
} from "./catalog";
import { HOME_WIDGET_TYPES, loadHomeWidget } from "./home-widget-loaders";
import type { DashboardWidgetType } from "./catalog";

function fakeClient(rowsByNeedle: Record<string, unknown[]>): PoolClient {
  return {
    query: async (sql: string) => {
      const needles = Object.keys(rowsByNeedle)
        .filter((needle) => sql.includes(needle))
        .sort((a, b) => b.length - a.length);
      const hit = needles[0];
      return { rows: hit ? rowsByNeedle[hit]! : [] };
    },
  } as PoolClient;
}

function stamp(
  status: "live" | "empty" | "setup_required",
  type: DashboardWidgetType,
  data?: Record<string, unknown>,
  message?: string,
) {
  return { type, status, updatedAt: "t", data, message };
}

const ctx = {
  orgId: "org-1",
  userId: "user-1",
  eventKey: "2026nccmp",
  eventName: "NC Championship",
  teamNumber: 6925,
  fundingModel: "sponsored" as string | null,
};

describe("home widget loaders", () => {
  it("covers every catalog type that is not loaded by the original snapshot jobs", () => {
    const original = new Set([
      "onboarding_checklist",
      "next_match",
      "recent_result",
      "competition_snapshot",
      "scouting_coverage",
      "prediction_summary",
      "sync_status",
      "pit_youtube",
      "ai_usage",
      "notifications",
      "robot_readiness",
      "alerts",
      "team_todos",
      "subteam_upcoming",
      "quick_actions",
      "ask_ai",
    ]);
    expect([...DASHBOARD_WIDGET_TYPES].filter((type) => !original.has(type)).sort()).toEqual(
      [...HOME_WIDGET_TYPES].sort(),
    );
  });

  it("shows My day when a match is on the schedule and stays empty without one", async () => {
    const live = await loadHomeWidget(
      fakeClient({
        "home-widget:my_day": [
          {
            matchNumber: 12,
            compLevel: "qm",
            scheduledTime: "2026-03-14T15:00:00Z",
            redAlliance: { teamKeys: ["frc6925"] },
            blueAlliance: { teamKeys: ["frc254"] },
          },
        ],
      }),
      "my_day",
      ctx,
      stamp,
    );
    expect(live.status).toBe("live");
    expect(live.data?.matchLabel).toBe("qm 12");
    expect(live.data?.bumperCue).toBe("Switch to RED bumpers");

    const empty = await loadHomeWidget(fakeClient({}), "my_day", ctx, stamp);
    expect(empty.status).toBe("empty");
  });

  it("hides sponsor follow-ups for a school-funded team with no sponsors", async () => {
    const result = await loadHomeWidget(
      fakeClient({
        "home-widget:sponsor_followups": [{ id: "s1", name: "Acme", nextFollowUpOn: "2026-01-01" }],
      }),
      "sponsor_followups",
      { ...ctx, fundingModel: "school_funded_no_sponsors" },
      stamp,
    );
    expect(result.status).toBe("empty");
    expect(result.message).toMatch(/does not use sponsors/);
  });

  it("keeps venue weather off without a city, and live with a city and no invented temperature", async () => {
    const noCity = await loadHomeWidget(
      fakeClient({ "home-widget:weather_venue": [{ city: null, name: "Event" }] }),
      "weather_venue",
      ctx,
      stamp,
    );
    expect(noCity.status).toBe("empty");

    const withCity = await loadHomeWidget(
      fakeClient({
        "home-widget:weather_venue": [
          {
            city: "Houston",
            stateProv: "TX",
            country: "USA",
            startDate: "2099-01-01",
            endDate: "2099-01-03",
            name: "Event",
          },
        ],
      }),
      "weather_venue",
      ctx,
      stamp,
    );
    expect(withCity.status).toBe("live");
    expect(withCity.data?.city).toBe("Houston");
    expect(withCity.data?.isEventDay).toBe(false);
    expect(withCity.data).not.toHaveProperty("tempC");
  });

  it("marks event day from the event window and still never invents a temperature", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const result = await loadHomeWidget(
      fakeClient({
        "home-widget:weather_venue": [
          {
            city: "Houston",
            stateProv: "TX",
            country: "USA",
            startDate: today,
            endDate: today,
            name: "Event",
          },
        ],
      }),
      "weather_venue",
      ctx,
      stamp,
    );
    expect(result.status).toBe("live");
    expect(result.data).toMatchObject({ city: "Houston", isEventDay: true });
    expect(result.data).not.toHaveProperty("tempC");
  });

  it("shows files, chat, and budget only from real rows", async () => {
    const files = await loadHomeWidget(
      fakeClient({
        "home-widget:files_recent": [{ id: "f1", name: "pit-map.pdf", updatedAt: "t" }],
      }),
      "files_recent",
      ctx,
      stamp,
    );
    expect(files.status).toBe("live");
    expect((files.data?.items as Array<{ name: string }>)[0]?.name).toBe("pit-map.pdf");

    const chat = await loadHomeWidget(fakeClient({}), "team_chat", ctx, stamp);
    expect(chat.status).toBe("empty");

    const budget = await loadHomeWidget(
      fakeClient({
        "home-widget:budget_parts": [{ budgetUsd: "1000", spentUsd: "250" }],
        "home-widget:budget_parts-req": [{ count: "2" }],
      }),
      "budget_parts",
      ctx,
      stamp,
    );
    expect(budget.status).toBe("live");
    expect(budget.data?.remainingUsd).toBe(750);
    expect(budget.data?.pendingCount).toBe(2);
  });

  it("points every widget at a real in-app manual article", () => {
    for (const entry of WIDGET_CATALOG) {
      const slug = widgetRegistryMeta(entry).helpArticle;
      expect(getHelpArticle(slug), `${entry.type} → ${slug}`).toBeDefined();
    }
  });
});
