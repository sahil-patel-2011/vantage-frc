import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";
import { gotoAsTeam } from "./active-org";

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 720 },
] as const;

test.beforeEach(async ({ context }) => {
  await signInFixture(context);
});

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} event-day shells`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("scouting hub stays empty/setup and never DEMO", async ({ page }) => {
      await page.goto("/scouting");
      await expect(page.getByRole("tab", { name: "Scout", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Choose your team" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
      await expect(page.getByText("Deterministic demo")).toHaveCount(0);
    });

    test("offline shell reports real outbox copy only", async ({ page }) => {
      await page.goto("/offline");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText("Deterministic demo")).toHaveCount(0);
      await expect(page.getByText("65%")).toHaveCount(0);
    });
  });
}

test("strategy empty setup hides fabricated probabilities", async ({ page }) => {
  await page.goto("/strategy");
  await expect(page.getByRole("tab", { name: "Strategy" })).toBeVisible();
  await expect(page.getByText("65%")).toHaveCount(0);
  await expect(page.getByText("Deterministic demo")).toHaveCount(0);
});

test("Event day identifies the actual selected event inside Competition", async ({ page, context }) => {
  const signed = await signInAs(context, "owner");
  test.skip(!signed, "needs the seeded owner session");
  const orgId = await gotoAsTeam(page, "/competition");
  expect(orgId).toBeTruthy();
  const response = await page.request.get(`/api/command?orgId=${orgId}`);
  expect(response.ok()).toBe(true);
  const snapshot = await response.json() as { eventName: string; eventKey: string };
  expect(snapshot.eventKey).toBeTruthy();
  await expect(page.getByRole("region", { name: "Selected event", exact: true })).toContainText(snapshot.eventName || snapshot.eventKey);
  await expect(page.getByRole("heading", { level: 1, name: "Competition" })).toHaveCount(1);
});

test("scout P2P relay renders without invented mesh counts", async ({ page }) => {
  await page.goto("/scout-p2p-relay");
  await expect(page.getByRole("heading", { name: "Pit mesh" })).toBeVisible();
  await expect(page.getByText("Deterministic demo")).toHaveCount(0);
});

test("exit interviews render without invented wiki copy", async ({ page }) => {
  await page.goto("/exit-interview");
  await expect(page.getByRole("heading", { name: "Graduation Exit Interviews" })).toBeVisible();
  await expect(page.getByText("Deterministic demo")).toHaveCount(0);
});
