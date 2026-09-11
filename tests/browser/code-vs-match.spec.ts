import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Setup required", "Code-vs-Match Detective", "VANTAGE /"];

const LEAVES = [
  { path: "/code-perf", heading: "Code vs match", related: ["Code Coach", "Deploy log", "CAD"] },
  { path: "/software-versions", heading: "Software versions", related: ["CAN-bus map", "Code", "Tuning log"] },
] as const;

test("Code vs match / Software versions speak student chrome", async ({ page }) => {
  test.setTimeout(120_000);
  for (const leaf of LEAVES) {
    await page.goto(leaf.path);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByRole("heading", { level: 1, name: leaf.heading })).toBeVisible();
    for (const phrase of BANNED) {
      await expect(page.locator("body"), `${leaf.path} still shows ${phrase}`).not.toContainText(phrase);
    }
    const related = page.getByRole("navigation", { name: "Related build tools" });
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
