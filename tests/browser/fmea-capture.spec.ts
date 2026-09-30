import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

for (const width of [1280, 390]) {
  test(`failure capture retains drafts and saves full analysis at ${width}px`, async ({ page, context }, testInfo) => {
    test.setTimeout(90_000);
    page.setDefaultTimeout(15_000);
    expect(await signInAs(context, "owner")).toBe(true);
    const me = await context.request.get("/api/me");
    expect(me.ok()).toBe(true);
    const { orgId } = await me.json();
    expect(orgId).toBeTruthy();
    await page.setViewportSize({ width, height: 900 });
    // Exercise the no-subsystems case from the reported screenshot. All saves
    // still use the real authenticated API and the isolated fixture database.
    let rejectNextSave = true;
    let savedId: string | undefined;
    let seasonYear: number | undefined;
    await page.route("**/api/fmea**", async route => {
      if (route.request().method() === "GET") {
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        const data = await response.json();
        expect(data.status).toBe("live");
        seasonYear = data.seasonYear;
        await route.fulfill({ response, json: { ...data, subsystems: [] } });
      } else if (rejectNextSave) {
        rejectNextSave = false;
        await route.fulfill({ status: 503, json: { error: "Save temporarily unavailable. Try again." } });
      } else {
        await route.continue();
      }
    });
    const title = `Capture check ${width} ${Date.now()}`;
    try {
      await page.goto(`/build?tab=fmea&orgId=${encodeURIComponent(orgId)}`);
      const form = page.getByRole("form", { name: "Log a failure", exact: true });
      await expect(form).toBeVisible();
      await expect(form.getByLabel("Subsystem", { exact: true })).toHaveCount(1);
      await expect(form.getByLabel("Subsystem name", { exact: true })).toHaveCount(0);
      await expect(form.getByLabel("Root cause", { exact: true })).not.toBeVisible();
      await expect(form.locator("input:visible, select:visible, textarea:visible")).toHaveCount(6);
      await expect(form.getByRole("button")).toHaveCount(1);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`failure-capture-${width}.png`), fullPage: true });
      await testInfo.attach("Simplified capture", { path: testInfo.outputPath(`failure-capture-${width}.png`), contentType: "image/png" });
      await form.getByLabel("What happened?", { exact: true }).fill(title);
      await form.getByLabel("Subsystem", { exact: true }).fill("Intake");
      await form.getByLabel("Where", { exact: true }).selectOption("match");
      await form.getByLabel(/^Occurrence/).selectOption("2");
      await form.getByLabel(/^Severity/).selectOption("6");
      await form.getByLabel(/^Detection/).selectOption("3");
      await expect(form.locator(".fmea-preview")).toContainText("36");
      const disclosure = form.locator("summary");
      await disclosure.focus();
      await page.keyboard.press("Enter");
      await expect(form.getByLabel("Root cause", { exact: true })).toBeVisible();
      await form.getByLabel("Failure mode", { exact: true }).fill("Belt slips under load");
      await form.getByLabel("Root cause", { exact: true }).fill("Loose tensioner");
      await form.getByLabel("5 whys", { exact: true }).fill("Why did it slip?\nThe tensioner loosened.");
      await form.getByLabel("Fix", { exact: true }).fill("Retension and mark the fastener");
      const accessibility = await new AxeBuilder({ page }).include(".fmea-capture").analyze();
      expect(accessibility.violations).toEqual([]);
      await disclosure.click();
      await form.getByRole("button", { name: "Save failure", exact: true }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Save temporarily unavailable" })).toBeVisible();
      await expect(form.getByLabel("What happened?", { exact: true })).toHaveValue(title);
      await expect(form.getByLabel("Root cause", { exact: true })).toHaveValue("Loose tensioner");
      const savedResponse = page.waitForResponse(response => response.url().includes("/api/fmea") && response.request().method() === "POST");
      await form.getByRole("button", { name: "Save failure", exact: true }).click();
      const response = await savedResponse;
      expect(response.ok()).toBe(true);
      const data = await response.json();
      const rows = data.evaluations.filter((row: { failure: { title: string } }) => row.failure.title === title);
      expect(rows).toHaveLength(1);
      savedId = rows[0].failure.id;
      expect(rows[0]).toMatchObject({ rpn: 36, failure: { subsystemName: "Intake", context: "match", rootCause: "Loose tensioner", fix: "Retension and mark the fastener", fiveWhys: "Why did it slip?\nThe tensioner loosened." } });
      await expect(form.getByRole("status")).toHaveText("Failure saved.");
      await expect(form.getByLabel("What happened?", { exact: true })).toHaveValue("");
      await page.reload();
      const record = page.locator(".fmea-risk-row").filter({ hasText: title });
      await expect(record).toHaveCount(1);
      await expect(record).toContainText("Loose tensioner");
      await record.locator("summary").click();
      await expect(record).toContainText("The tensioner loosened.");
      await expect(record.getByRole("link")).toHaveCount(0);
      const related = page.locator(".fmea-related");
      await related.locator("summary").click();
      await expect(related.getByRole("navigation")).toBeVisible();
      await expect(related.getByRole("link")).toHaveCount(5);
    } finally {
      if (savedId) {
        const removed = await context.request.post("/api/fmea", { data: { orgId, seasonYear, action: "delete-failure", failureId: savedId } });
        expect(removed.ok()).toBe(true);
      }
    }
  });
}

test("failure capture switches between a registered subsystem and a custom name", async ({ page, context }) => {
  page.setDefaultTimeout(15_000);
  expect(await signInAs(context, "owner")).toBe(true);
  const identity = await (await context.request.get("/api/me")).json();
  await page.route("**/api/fmea**", async route => {
    const response = await route.fetch();
    const data = await response.json();
    expect(data.status).toBe("live");
    await route.fulfill({ response, json: { ...data, subsystems: [{ id: "00000000-0000-4000-8000-000000000001", name: "Drivetrain", robotLabel: "competition" }] } });
  });
  await page.goto(`/build?tab=fmea&orgId=${encodeURIComponent(identity.orgId)}`);
  const form = page.getByRole("form", { name: "Log a failure", exact: true });
  await form.getByLabel("Subsystem", { exact: true }).selectOption("00000000-0000-4000-8000-000000000001");
  await expect(form.getByLabel("Subsystem name", { exact: true })).toHaveCount(0);
  await form.getByLabel("Subsystem", { exact: true }).selectOption("");
  await expect(form.getByLabel("Subsystem name", { exact: true })).toBeVisible();
  await form.getByLabel("Subsystem name", { exact: true }).fill("Climber");
  await expect(form.getByLabel("Subsystem name", { exact: true })).toHaveValue("Climber");
});