import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "Meeting-agenda autopilot", "VANTAGE /"];

const LEAVES = [
  { path: "/goals-tracker", heading: "Goals", related: ["Standup", "Meeting agenda", "Season plan"] },
  { path: "/standup-digest", heading: "Standup", related: ["Hours", "Goals", "Meeting agenda"] },
  { path: "/meeting-autopilot", heading: "Meeting agenda", related: ["Calendar", "Standup", "Goals"] },
] as const;

test("Goals / standup / meeting agenda speak student chrome", async ({ page }) => {
  test.setTimeout(120_000);
  for (const leaf of LEAVES) {
    await page.goto(leaf.path);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByRole("heading", { level: 1, name: leaf.heading })).toBeVisible();
    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${leaf.path} still shows ${phrase}`).not.toContainText(phrase);
    }
    const related = page.getByRole("navigation", { name: "Related team tools" });
    await expect(related).toBeVisible();
    for (const label of leaf.related) {
      await expect(related.getByRole("link", { name: label })).toBeVisible();
    }
    const setup = page.getByText("Needs setup", { exact: true });
    if (await setup.isVisible().catch(() => false)) {
      await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
      const choose = page.locator("main").getByRole("link", { name: "Choose your team" });
      if (await choose.count()) {
        await expect(choose).toHaveCount(1);
      }
    }
  }
});
