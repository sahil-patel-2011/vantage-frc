import { expect, test } from "@playwright/test";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("Files, CAD, Print Farm, Event Day, and Logistics drop leftover engineering copy", async ({
  page,
}) => {
  for (const path of ["/files", "/cad", "/print-farm", "/command", "/logistics"]) {
    await page.goto(path);
    await expect(page.locator("body")).not.toContainText("Application error");
    await expect(page.getByText("object storage")).toHaveCount(0);
    await expect(page.getByText("setup required")).toHaveCount(0);
    await expect(page.getByText("shaded-view PNG")).toHaveCount(0);
    await expect(page.getByText("weighted round-robin")).toHaveCount(0);
    await expect(page.getByText("OctoPrint")).toHaveCount(0);
    await expect(page.getByText("Checksumming")).toHaveCount(0);
  }
});
