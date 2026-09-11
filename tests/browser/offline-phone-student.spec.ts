import { expect, test, type Page } from "@playwright/test";
import { signInFixture } from "./session";

const LAST_COPY = /last copy on this device/i;

const HOURS_READY = {
  status: "ready",
  context: {
    orgId: "org-1",
    orgName: "Phone Snapshot Team",
    teamNumber: 1234,
    role: "member",
    userId: "user-1",
  },
  records: [],
  policy: { seasonGoalHours: 0, seasonStart: null },
  members: [],
};

const BATTERIES_READY = {
  status: "ready",
  context: { orgId: "org-1", orgName: "Phone Snapshot Team", teamNumber: 1234, role: "member" },
  packs: [],
  logs: [],
  rotation: [],
  summary: {
    active: 0,
    competitionReady: 0,
    needAttention: 0,
    retired: 0,
    cartReady: 0,
    cartCooling: 0,
  },
};

const FMEA_LIVE = {
  status: "live",
  orgId: "org-1",
  teamNumber: 1234,
  seasonYear: 2026,
  seasons: [2026],
  evaluations: [],
  summary: {
    total: 0,
    active: 0,
    byLevel: { low: 0, moderate: 0, high: 0, critical: 0 },
    byStatus: { open: 0, fixing: 0, verified: 0, closed: 0 },
    byContext: [],
    bySubsystem: [],
    topFailures: [],
    needsFix: [],
    highestRpn: 0,
    avgRpn: 0,
  },
  repeatAlerts: [],
  batterySignals: [],
  subsystems: [],
  inspectionItems: [],
  inventoryItems: [],
  computedAt: "2026-09-11T00:00:00.000Z",
};

const EVENT_READINESS_SETUP = {
  status: "setup_required",
  message: "Pick an event to track readiness.",
  steps: [],
  orgId: "org-1",
  teamNumber: 1234,
  eventCandidates: [],
  plans: [],
  today: "2026-09-11",
};

async function failedRefreshKeepsBoard(
  page: Page,
  options: {
    path: string;
    api: string;
    body: unknown;
    heading: string;
    keep: RegExp | string;
  },
) {
  let fail = false;
  await page.route(options.api, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    if (fail) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":"nope"}',
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(options.body),
    });
  });
  await page.goto(options.path);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(options.heading);
  await expect(page.locator("body")).toContainText(options.keep);
  fail = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(options.heading);
  await expect(page.locator("body")).toContainText(options.keep);
  await expect(page.locator("body")).toContainText(LAST_COPY);
  await expect(page.locator("body")).not.toContainText(/something went wrong/i);
}

test.describe("offline phone student boards keep the last copy", () => {
  test.beforeEach(async ({ context }) => {
    await signInFixture(context);
  });

  test("Hours keeps the last board after a failed refresh", async ({ page }) => {
    await failedRefreshKeepsBoard(page, {
      path: "/hours",
      api: "**/api/hours**",
      body: HOURS_READY,
      heading: "Shop hours",
      keep: /Phone Snapshot Team/,
    });
  });

  test("Batteries keeps the last board after a failed refresh", async ({ page }) => {
    await failedRefreshKeepsBoard(page, {
      path: "/batteries",
      api: "**/api/batteries**",
      body: BATTERIES_READY,
      heading: "Batteries",
      keep: /Phone Snapshot Team/,
    });
  });

  test("FMEA keeps the last board after a failed refresh", async ({ page }) => {
    await failedRefreshKeepsBoard(page, {
      path: "/fmea",
      api: "**/api/fmea**",
      body: FMEA_LIVE,
      heading: "Failure Log (FMEA)",
      keep: /No failures logged yet/,
    });
  });

  test("Event readiness keeps the last board after a failed refresh", async ({ page }) => {
    await failedRefreshKeepsBoard(page, {
      path: "/event-readiness",
      api: "**/api/event-readiness**",
      body: EVENT_READINESS_SETUP,
      heading: "Event Readiness",
      keep: /Pick an event to track readiness/,
    });
  });
});
