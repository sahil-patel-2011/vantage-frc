import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "VANTAGE /", "TBA/Statbotics", "team_event_metrics", "Sync reference data"];

test("student-week hubs speak student chrome", async ({ page }) => {
  test.setTimeout(120_000);
  const routes = [
    "/dashboard",
    "/competition",
    "/scouting",
    "/strategy",
    "/video",
    "/business",
    "/cad/setup",
    "/chat",
    "/consent",
    "/match-checklist",
    "/match-sim",
  ];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.locator("body")).not.toContainText("Application error");
    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${route} still shows ${phrase}`).not.toContainText(phrase);
    }
  }

  await page.goto("/chat");
  await expect(page.locator("body")).not.toContainText("Application error");
  const empty = page.getByRole("button", { name: "New private chat" });
  if (await empty.count()) {
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
    await expect(page.locator(".ch-empty-actions a")).toHaveCount(0);
  }
});
