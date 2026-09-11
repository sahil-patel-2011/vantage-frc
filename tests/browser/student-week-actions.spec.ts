import { expect, test } from "@playwright/test";
import { expectReadyOr, waitForLoadingGone } from "./ready";
import { signInAs, signInFixture } from "./session";

test.beforeEach(async ({ context }) => {
  const signed = await signInAs(context, "owner");
  if (!signed) await signInFixture(context);
});

const BANNED = ["Connect TBA", "The Blue Alliance", "TBA/Statbotics", "Setup required", "OAuth", "ONSHAPE_"];

test("student this week can walk Home → My Day/Scout → Video paste → CAD link", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto("/dashboard");
  await waitForLoadingGone(page);
  const now = page.getByTestId("dash-now");
  await expect(now).toBeVisible();
  await expect(now.getByText("What to do now")).toBeVisible();
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Home still shows ${phrase}`).not.toContainText(phrase);
  }
  const homeCta = now.getByRole("link").first();
  await expect(homeCta).toBeVisible();
  const emptyNow = await now.getByText("Nothing you have to do right now").count();
  if (emptyNow) {
    await expect(homeCta).toHaveText(/Open My Day/i);
  }

  await homeCta.click();
  await waitForLoadingGone(page);
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `after Home CTA still shows ${phrase}`).not.toContainText(
      phrase,
    );
  }
  if (page.url().includes("/my-day") || page.url().includes("tab=my-day")) {
    const scout = page.getByRole("link", { name: "Scout this match" });
    if (await scout.count()) {
      await scout.first().click();
      await expect(page.locator("body")).not.toContainText("Application error");
    }
  }

  await page.goto("/scouting");
  await waitForLoadingGone(page);
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Scouting still shows ${phrase}`).not.toContainText(phrase);
  }
  const views = page.getByRole("navigation", { name: "Scouting views" });
  const denied = page.getByRole("heading", { name: /You don't have access to this/i });
  const setup = page.getByRole("link", {
    name: /Choose your team|Set active event|Open Form builder/i,
  });
  await expect(views.or(denied).or(setup.first())).toBeVisible({ timeout: 15_000 });
  if (await views.count()) {
    await expect(views.getByRole("button", { name: "Match" })).toBeVisible();
    const save = page.getByRole("button", { name: /Save this match|Save on this phone/i });
    if (await save.count()) {
      await expect(save.first()).toBeVisible();
    }
    await views.getByRole("button", { name: "Pit" }).click();
    await expect(views.getByRole("button", { name: "Pit" })).toHaveAttribute("aria-current", "page");
    const pitSave = page.getByRole("button", { name: /Save this pit|Save on this phone/i });
    if (await pitSave.count()) {
      await expect(pitSave.first()).toBeVisible();
    }
  } else if (await denied.count()) {
    // Hub access is not seeded on the local fixture org — honest denial, not a spinner.
    await expect(page.getByRole("link", { name: "Back to Home" })).toBeVisible();
  } else {
    await expect(setup.first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Next actions" })).toHaveCount(0);
  }

  await page.goto("/video-analysis");
  await waitForLoadingGone(page);
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `Video still shows ${phrase}`).not.toContainText(phrase);
  }
  const paste = page.getByRole("region", { name: "Paste a video" });
  const chooseTeam = page.getByRole("link", { name: "Choose your team" });
  const onPaste = await expectReadyOr(page, paste, chooseTeam);
  if (onPaste) {
    await expect(page.getByRole("button", { name: "Analyze this video" })).toBeVisible();
    const field = paste.getByLabel("Video link");
    if (await field.count()) {
      await field.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      await expect(page.getByRole("button", { name: "Analyze this video" })).toBeVisible();
    }
  }

  await page.goto("/cad-vault");
  await waitForLoadingGone(page);
  await expect(
    page.getByRole("heading", {
      name: /Choose your team|Link a CAD document|Link an Onshape or Fusion document/i,
    }).first(),
  ).toBeVisible({ timeout: 12_000 });
  for (const phrase of BANNED) {
    await expect(page.locator("body"), `CAD vault still shows ${phrase}`).not.toContainText(phrase);
  }
  await expect(page.getByRole("heading", { name: "Could not load the CAD vault" })).toHaveCount(0);
  const linkCad = page.getByRole("link", { name: "Link a CAD document" }).or(
    page.getByRole("heading", { name: /Link an Onshape or Fusion document|Link a CAD document/i }),
  );
  if (await page.getByRole("heading", { name: "Choose your team" }).count()) {
    await expect(page.getByRole("link", { name: "Choose your team" })).toBeVisible();
  } else {
    await expect(linkCad.first()).toBeVisible();
  }

  await page.goto("/build?tab=cad");
  await waitForLoadingGone(page);
  for (const phrase of ["OAuth", "ONSHAPE_", "Setup required"]) {
    await expect(page.locator("body"), `CAD tab still shows ${phrase}`).not.toContainText(phrase);
  }
});
