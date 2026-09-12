import { test } from "@playwright/test";
import { assertChromeSnapshotLeaf } from "./leftover-chrome-snapshot-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("/incident-heatmap paints a heading instead of leftover VANTAGE chrome", async ({ page }) => {
  await assertChromeSnapshotLeaf(page, { path: "/incident-heatmap", heading: "Incident Heatmap" });
});

test("/auton-path-library paints a heading instead of leftover VANTAGE chrome", async ({ page }) => {
  await assertChromeSnapshotLeaf(page, { path: "/auton-path-library", heading: "Auton paths" });
});
