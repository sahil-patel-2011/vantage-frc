import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "Hard cut-off", "Hosted by Vantage", "3D Print Farm", "Inspection copilot"];

const LEAVES = [
  { path: "/team/usage", heading: /Where the team's AI spend goes|Choose your team|Usage/ },
  { path: "/team/budgets", heading: /Chat limits|Choose your team/ },
  { path: "/files", heading: "Files" },
  { path: "/media", heading: "Media" },
  { path: "/help", heading: "Help centre" },
  { path: "/whats-new", heading: "What’s new" },
  { path: "/print-farm", heading: "Print farm" },
  { path: "/team/knowledge", heading: "Playbook" },
  { path: "/inspection", heading: /Inspection|Robot Inspection/ },
  { path: "/scout-accuracy", heading: /Scout Accuracy|Choose your team/ },
] as const;

test("leftover-product boards speak student chrome", async ({ page }) => {
  test.setTimeout(180_000);
  for (const leaf of LEAVES) {
    await page.goto(leaf.path);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByRole("heading", { name: leaf.heading }).first()).toBeVisible();
    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${leaf.path} still shows ${phrase}`).not.toContainText(phrase);
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
