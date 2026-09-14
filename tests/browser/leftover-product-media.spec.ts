import { test } from "@playwright/test";
import { assertLeftoverProductBoards } from "./leftover-product-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Media / Help / What’s new / Print farm boards speak student chrome", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await assertLeftoverProductBoards(page, [
    { path: "/media", heading: "Media" },
    { path: "/help", heading: "Help centre" },
    { path: "/whats-new", heading: "What’s new" },
    { path: "/print-farm", heading: "Print farm" },
  ]);
});
