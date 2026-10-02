import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInAs } from "./session";

test.use({ actionTimeout: 15_000 });

for (const width of [390, 1440]) {
  test(`writing stays focused and preserves draft details at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(180_000);
    expect(await signInAs(context, "owner")).toBe(true);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/ai?tab=writer&orgId=6925a000-0000-4000-8000-000000000001");
    const writer = page.locator(".writer-page");
    await expect(writer.getByLabel("What are you writing?")).toBeVisible({ timeout: 30_000 });
    const profile = writer.locator(".writer-profile");
    await expect(profile).not.toHaveAttribute("open");
    await profile.locator("summary").click();
    await writer.getByLabel("Mission (1–2 sentences)", { exact: true }).fill("We teach students engineering through robotics.");
    await profile.locator("summary").click();
    const format = writer.getByLabel("What are you writing?");
    await format.selectOption("sponsorship_ask");
    await writer.getByLabel("Sponsor / org name").fill("Local sponsor");
    await writer.getByLabel("Contact name", { exact: true }).fill("Alex");
    await writer.getByLabel("Ask amount ($)", { exact: true }).fill("2500");
    const details = writer.locator(".writer-more-details");
    await details.locator("summary").click();
    await writer.getByLabel("Your name", { exact: true }).fill("Student");
    await writer.getByLabel("Your role", { exact: true }).fill("Captain");
    await writer.getByLabel("Tier (optional)").fill("Gold");
    await details.locator("summary").click();
    await writer.getByRole("button", { name: "Create draft", exact: true }).click();
    const draft = writer.getByLabel("Draft (edit before sending)");
    await expect(draft).toHaveValue(/Local sponsor/);
    await expect(draft).toHaveValue(/engineering through robotics/);
    await expect(draft).toHaveValue(/Student, Captain/);
    await expect(draft).toHaveValue(/2,500/);
    await draft.fill("My unsaved edited draft");
    await details.locator("summary").click();
    await details.locator("summary").click();
    await expect(draft).toHaveValue("My unsaved edited draft");
    for (const kind of ["cold_intro", "renewal", "thank_you", "grant_followup", "grant"]) {
      await format.selectOption(kind);
      await writer.getByRole("button", { name: "Create draft", exact: true }).click();
      await expect(draft).not.toHaveValue("");
    }
    await format.selectOption("sponsorship_ask");
    await expect(writer.getByLabel("Sponsor / org name")).toHaveValue("Local sponsor");
    await expect(writer.getByLabel("Ask amount ($)", { exact: true })).toHaveValue("2500");
    await page.route("**/api/writer", route => route.request().method() === "POST" ? route.fulfill({ status: 412, json: { status: "setup_required", code: "setup_required", message: "Pair Claude Code with an API key." } }) : route.continue());
    await writer.getByRole("button", { name: "Draft with AI", exact: true }).click();
    const connect = writer.getByRole("link", { name: "Connect AI", exact: true });
    await expect(connect).toHaveAttribute("href", /\/ai\/connect\?orgId=/);
    await expect(writer).not.toContainText("Pair Claude Code");
    await expect(draft).not.toHaveValue("");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const audit = await new AxeBuilder({ page }).include(".writer-composer").include(".writer-profile").analyze();
    expect(audit.violations).toEqual([]);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`writer-${width}.png`), fullPage: true });
    if (width === 1440) {
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
      const darkAudit = await new AxeBuilder({ page }).include(".writer-composer").analyze();
      expect(darkAudit.violations).toEqual([]);
      await page.screenshot({ path: info.outputPath("writer-dark.png"), fullPage: true });
      await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
    }
    await connect.click();
    await expect(page.getByRole("heading", { name: "Connect AI", exact: true })).toBeVisible();
    const orgId = new URL(page.url()).searchParams.get("orgId");
    const methods = page.locator(".ai-connect-method");
    await expect(methods).toHaveCount(2);
    for (const link of await methods.all()) expect(new URL(await link.getAttribute("href") ?? "", page.url()).searchParams.get("orgId")).toBe(orgId);
    const setupAudit = await new AxeBuilder({ page }).include(".ai-connect-page").analyze();
    expect(setupAudit.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`connect-ai-${width}.png`), fullPage: true });
  });
}
