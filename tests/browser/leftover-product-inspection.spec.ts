import { test } from "@playwright/test";
import { assertLeftoverProductBoards } from "./leftover-product-walk";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

test("leftover Playbook / Inspection / Scout Accuracy boards speak student chrome", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await assertLeftoverProductBoards(page, [
    { path: "/team/knowledge", heading: /Playbook|Team|Choose your team/ },
    { path: "/inspection", heading: /Inspection|Robot Inspection/ },
    { path: "/scout-accuracy", heading: /Accuracy|Choose your team/ },
  ]);
});
