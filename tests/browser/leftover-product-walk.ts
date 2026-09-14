import { expect, type Page } from "@playwright/test";
import { waitForLoadingGone } from "./ready";

export const LEFTOVER_PRODUCT_BANNED = [
  "Setup required",
  "Hard cut-off",
  "Hosted by Vantage",
  "3D Print Farm",
  "Inspection copilot",
] as const;

export type LeftoverProductLeaf = {
  path: string;
  heading: string | RegExp;
};

export async function assertLeftoverProductBoards(
  page: Page,
  leaves: readonly LeftoverProductLeaf[],
): Promise<void> {
  for (const leaf of leaves) {
    await page.goto(leaf.path);
    await waitForLoadingGone(page);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByRole("heading", { name: leaf.heading }).first()).toBeVisible();
    for (const phrase of LEFTOVER_PRODUCT_BANNED) {
      await expect(page.locator("body"), `${leaf.path} still shows ${phrase}`).not.toContainText(
        phrase,
      );
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
}
