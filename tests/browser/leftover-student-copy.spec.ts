import { expect, test } from "@playwright/test";
import { waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Files, CAD, and Print Farm drop leftover engineering copy", async ({ page }) => {
  test.setTimeout(90_000);
  for (const path of ["/files", "/cad", "/print-farm"]) {
    await page.goto(path);
    await waitForLoadingGone(page);
    await expect(page.getByText("object storage")).toHaveCount(0);
    await expect(page.getByText("setup required")).toHaveCount(0);
    await expect(page.getByText("shaded-view PNG")).toHaveCount(0);
    await expect(page.getByText("weighted round-robin")).toHaveCount(0);
    await expect(page.getByText("OctoPrint")).toHaveCount(0);
    await expect(page.getByText("Checksumming")).toHaveCount(0);
  }
});
