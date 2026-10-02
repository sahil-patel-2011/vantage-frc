import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { signInAs } from "./session";
import { openNav } from "./nav";

test.use({ actionTimeout: 15_000 });

for (const width of [390, 1440]) {
  test(`scouting without an event saves, recovers offline, syncs once, and isolates identity at ${width}px`, async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner")).toBe(true);
    const orgId = "6925a000-0000-4000-8000-000000000001";
    const marker = `No-event journey ${randomUUID()}`;
    const dbUrl = process.env.DATABASE_ADMIN_URL ?? process.env.TEST_DATABASE_ADMIN_URL;
    expect(dbUrl, "The no-event journey requires a scratch database").toBeTruthy();
    const url = new URL(dbUrl!);
    expect(["127.0.0.1", "localhost"]).toContain(url.hostname);
    expect(url.pathname).toMatch(/test|ci/i);
    const pool = new Pool({ connectionString: dbUrl, ssl: false });
    const old = (await pool.query("SELECT active_event_key FROM org_active_context WHERE org_id=$1", [orgId])).rows[0]?.active_event_key;
    await pool.query("UPDATE org_active_context SET active_event_key=NULL WHERE org_id=$1", [orgId]);
    const ids: string[] = [];
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/competition?tab=scouting&orgId=${orgId}`);
      await page.getByRole("link", { name: "Practice scouting", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Practice scouting" })).toBeVisible();
      await expect(page.getByRole("radio", { name: "Pit", exact: true })).toBeChecked();
      await expect(page.getByLabel("Match name", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "Game", exact: true })).toHaveValue("2026");
      await page.getByLabel("Team number", { exact: true }).fill("6925");
      await page.getByRole("button", { name: "Start scouting", exact: true }).click();
      await page.getByRole("textbox", { name: "Notes", exact: true }).fill(marker);
      await expect.poll(() => page.evaluate((value) => Object.keys(localStorage).some((key) => key.startsWith("free-scout:") && (localStorage.getItem(key) ?? "").includes(value)), marker)).toBe(true);
      await page.reload();
      await expect(page.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue(marker);
      await context.setOffline(true);
      await page.getByRole("button", { name: "Save report", exact: true }).click();
      await expect(page.getByText("Waiting to upload", { exact: true })).toBeVisible();
      await context.setOffline(false);
      await expect.poll(async () => (await pool.query("SELECT count(*)::int AS count FROM free_scout_reports WHERE org_id=$1 AND payload->>'notes'=$2", [orgId, marker])).rows[0].count, { timeout: 30_000 }).toBe(1);
      const response = await context.request.get(`/api/scouting/free-reports?orgId=${orgId}`);
      expect(response.ok()).toBe(true);
      const data = await response.json();
      const rows = data.reports.filter((row: { payload: { notes?: string } }) => row.payload.notes === marker);
      expect(rows).toHaveLength(1);
      ids.push(rows[0].id);
      expect(rows[0].payload.notes).toBe(marker);
      const reportRow = page.locator(".free-scout-report").filter({ hasText: `Team 6925` }).filter({ hasText: "Pit scouting" }).last();
      expect(rows[0]).not.toHaveProperty("eventKey");
      const replay = await context.request.post("/api/scouting/free-reports", { data: { orgId, userId: data.userId, report: rows[0] } });
      expect(replay.ok()).toBe(true);
      const stored = await pool.query("SELECT count(*)::int AS count FROM free_scout_reports WHERE id=$1", ids);
      expect(stored.rows[0].count).toBe(1);
      const spoof = await context.request.post("/api/scouting/free-reports", { data: { orgId, userId: randomUUID(), report: rows[0] } });
      expect(spoof.status()).toBe(403);
      const otherOrg = await context.request.get(`/api/scouting/free-reports?orgId=${randomUUID()}`);
      expect(otherOrg.status()).toBe(403);
      expect((await pool.query("SELECT active_event_key FROM org_active_context WHERE org_id=$1", [orgId])).rows[0].active_event_key).toBeNull();
      await reportRow.locator("summary").click();
      await expect(page.locator(".free-scout-report").filter({ hasText: marker }).first().getByText(marker, { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`free-scout-${width}.png`), fullPage: true });
    } finally {
      await context.setOffline(false);
      for (const id of ids) await context.request.delete("/api/scouting/free-reports", { data: { orgId, id } });
      // Only this journey's marker, including a row saved just before an assertion failed.
      await pool.query("DELETE FROM free_scout_reports WHERE org_id=$1 AND payload->>'notes'=$2", [orgId, marker]);
      await pool.query("UPDATE org_active_context SET active_event_key=$2 WHERE org_id=$1", [orgId, old ?? null]);
      await pool.end();
    }
  });
}

test("compact navigation keeps search, keyboard dismissal, and every workspace reachable", async ({ page, context }, testInfo) => {
  expect(await signInAs(context, "owner")).toBe(true);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Edit Home — rearrange, add, or remove widgets" })).toBeVisible({ timeout: 25_000 });
    const opener = page.getByRole("button", { name: "Menu and search" });
    await openNav(page);
    const drawer = page.getByRole("complementary", { name: "Product navigation" });
    for (const name of ["Home", "Scouting"]) await expect(drawer.getByRole("link", { name: new RegExp(`^${name} `) })).toBeVisible();
    for (const name of ["Competition tools", "Team", "Build", "Business", "AI"]) {
      const section = drawer.locator(".main-menu-section").filter({ has: page.locator("summary").filter({ hasText: new RegExp(`^${name}$`) }) });
      await section.locator("summary").click();
      await expect(section.getByRole("navigation", { name, exact: true }).getByRole("link").first()).toBeVisible();
      await section.locator("summary").click();
    }
    await expect(drawer.getByRole("link", { name: "Logistics", exact: true })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: /Show .* tools/ })).toHaveCount(0);
    const workspace = drawer.getByRole("link", { name: /^Scouting / });
    await drawer.evaluate(async (node) => {
      await Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {})));
    });
    const box = await workspace.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(48);
    await drawer.getByRole("combobox").fill("logistics");
    await expect(drawer.getByRole("option").filter({ hasText: /Logistics|Travel/ }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(opener).toBeFocused();
    await opener.click();
    await page.screenshot({ path: testInfo.outputPath(`navigation-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
  }
});
