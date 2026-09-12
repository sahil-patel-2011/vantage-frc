import { test } from "@playwright/test";
import { assertChromeSnapshotLeaf } from "./leftover-chrome-snapshot-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("/safety paints a heading instead of leftover VANTAGE chrome", async ({ page }) => {
  await assertChromeSnapshotLeaf(page, { path: "/safety", heading: "Safety log" });
});

test("/match-debrief paints a heading instead of leftover VANTAGE chrome", async ({ page }) => {
  await assertChromeSnapshotLeaf(page, { path: "/match-debrief", heading: "Match debrief" });
});
