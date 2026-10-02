import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { signInAs } from "./session";

test.use({ actionTimeout: 15_000 });

test("members can collaborate on team forms without misleading setup prompts", async ({ page, context }) => {
  expect(await signInAs(context, "member")).toBe(true);
  const orgId = (await (await context.request.get("/api/me")).json()).orgId;
  await page.goto(`/competition?tab=forms&orgId=${orgId}`);
  const builder = page.locator(".sfb-page");
  const schemas = await context.request.get(`/api/scouting/schemas?orgId=${orgId}`);
  expect(schemas.ok()).toBe(true);
  expect((await schemas.json()).canManageSchemas).toBe(true);
  await expect(builder.getByLabel("Form title", { exact: true })).toBeEnabled();
  await expect(builder.getByRole("button", { name: "Add question", exact: true })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Forms", exact: true })).toHaveCount(1);
  await expect(builder.getByRole("heading", { name: "Scouting forms", exact: true })).toHaveCount(0);
  await expect(builder.getByRole("heading", { name: "Choose your team", exact: true })).toHaveCount(0);
  await builder.getByRole("navigation", { name: "Form workspace" }).getByRole("button", { name: "Preview", exact: true }).click();
  await expect(builder.getByRole("heading", { name: "What scouts see", exact: true })).toBeVisible();
});

for (const width of [1280, 390]) {
  test(`scouting builder publishes usable forms and retains type drafts at ${width}px`, async ({ page, context }, testInfo) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner")).toBe(true);
    const me = await (await context.request.get("/api/me")).json();
    const orgId = me.orgId as string;
    expect(orgId).toBeTruthy();
    const url = new URL(process.env.DATABASE_ADMIN_URL!);
    expect(["127.0.0.1", "localhost"]).toContain(url.hostname);
    expect(url.pathname).toMatch(/(?:^|[_/])(?:test|ci)(?:[_/]|$)|vantage_ci/);
    const pool = new Pool({ connectionString: url.href, ssl: false });
    const marker = `Builder ${randomUUID()}`;
    const initial = await context.request.get(`/api/scouting/schemas?orgId=${orgId}`);
    expect(initial.ok()).toBe(true);
    const initialData = await initial.json();
    expect(initialData.eventKey).toBeTruthy();
    expect(initialData.canManageSchemas).toBe(true);
    const unscouted = await pool.query(
      "SELECT team_key FROM teams_ref t WHERE NOT EXISTS (SELECT 1 FROM pit_scout_entries p WHERE p.org_id=$1 AND p.event_key=$2 AND p.team_key=t.team_key) ORDER BY team_key LIMIT 1",
      [orgId, initialData.eventKey],
    );
    expect(unscouted.rowCount).toBe(1);
    const teamKey = unscouted.rows[0].team_key as string;
    const schemas: string[] = [];
    try {
      // Two tiny published fixtures keep the journey focused on edits made in
      // the actual builder. Existing team versions remain untouched underneath.
      for (const type of ["match", "pit"]) {
        const response = await context.request.post("/api/scouting/schemas", { data: {
          orgId, year: initialData.year, type,
          definition: { title: `${marker} ${type} starter`, fields: [{ key: "notes", label: "Notes", type: "text", widget: "short", required: false }] },
        } });
        expect(response.status()).toBe(201);
        schemas.push((await response.json()).id);
      }
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/competition?tab=forms&orgId=${orgId}`);
      const builder = page.locator(".sfb-page");
      await expect(builder.getByLabel("Form title", { exact: true })).toHaveValue(`${marker} pit starter`);
      const types = builder.getByRole("combobox", { name: "Form type", exact: true });
      await types.selectOption("match");
      await builder.getByLabel("Form title", { exact: true }).fill(`${marker} Match`);
      await builder.locator(".sfb-question").first().getByLabel("Label", { exact: true }).fill("Cycle notes");
      await builder.getByRole("button", { name: "Add question", exact: true }).click();
      const question = builder.locator(".sfb-question").last();
      await question.getByLabel("Label", { exact: true }).fill("Drive preference");
      await question.getByLabel(/^Answer type/).selectOption("dropdown");
      await question.getByLabel("Option 1", { exact: true }).fill("Swerve");
      await question.getByLabel("Option 2", { exact: true }).fill("Tank");
      await expect(question.getByRole("button", { name: "Duplicate", exact: true })).toHaveCount(0);
      await question.getByRole("button", { name: "Question 2 actions: More", exact: true }).click();
      await page.getByRole("menuitem", { name: /^Duplicate/ }).click();
      await expect(builder.locator(".sfb-question")).toHaveCount(3);
      async function removeCopy() {
        await builder.getByRole("button", { name: "Question 3 actions: More", exact: true }).click();
        await page.getByRole("menuitem", { name: /^Remove/ }).click();
        await expect(builder.locator(".sfb-question")).toHaveCount(3);
        await page.getByRole("menuitem", { name: /^Confirm: Remove/ }).click();
        await expect(builder.locator(".sfb-question")).toHaveCount(2);
      }
      await removeCopy();
      await builder.getByRole("button", { name: "Undo", exact: true }).click();
      await expect(builder.locator(".sfb-question")).toHaveCount(3);
      await removeCopy();
      // Reorder with the question's drag handle; the arrow keys are its keyboard form.
      await builder.getByRole("button", { name: /^Move question 2:/ }).focus();
      await page.keyboard.press("ArrowUp");
      await expect(builder.locator(".sfb-question").first().getByLabel("Label", { exact: true })).toHaveValue("Drive preference");
      await types.selectOption("pit");
      await builder.getByLabel("Form title", { exact: true }).fill(`${marker} Pit`);
      await builder.locator(".sfb-question").first().getByLabel("Label", { exact: true }).fill("Robot detail");
      await types.selectOption("match");
      await expect(builder.getByLabel("Form title", { exact: true })).toHaveValue(`${marker} Match`);
      await expect(builder.locator(".sfb-question")).toHaveCount(2);
      await expect(builder.getByLabel("Option 1", { exact: true })).toHaveValue("Swerve");
      await builder.getByRole("navigation", { name: "Form workspace" }).getByRole("button", { name: "Preview", exact: true }).click();
      const preview = builder.locator(".sfb-tablet");
      await expect(preview).toContainText("Drive preference");
      await preview.getByRole("textbox", { name: "Cycle notes", exact: true }).fill("Preview only");
      await builder.getByRole("navigation", { name: "Form workspace" }).getByRole("button", { name: "Questions", exact: true }).click();
      let failPublish = true;
      await page.route("**/api/scouting/schemas", async route => {
        if (route.request().method() === "POST" && failPublish) {
          failPublish = false;
          await route.fulfill({ status: 503, json: { error: "Publish temporarily unavailable" } });
        } else await route.continue();
      });
      const publish = builder.locator(".sfb-publish-actions").getByRole("button", { name: "Publish changes", exact: true });
      await publish.click();
      await expect(builder.locator(".sfb-message")).toHaveText("Publish temporarily unavailable");
      await expect(builder.getByLabel("Form title", { exact: true })).toHaveValue(`${marker} Match`);
      async function publishCurrent() {
        let release!: () => void;
        let refreshBlocked = false;
        const refresh = new Promise<void>(resolve => { release = resolve; });
        const refreshUrl = "**/api/scouting/schemas?*";
        await page.route(refreshUrl, async route => {
          const response = await route.fetch();
          refreshBlocked = true;
          await refresh;
          await route.fulfill({ response });
        });
        try {
          const responsePromise = page.waitForResponse(r => r.url().endsWith("/api/scouting/schemas") && r.request().method() === "POST");
          await publish.click();
          const response = await responsePromise;
          expect(response.status()).toBe(201);
          const result = await response.json();
          schemas.push(result.id);
          await expect.poll(() => refreshBlocked).toBe(true);
          await expect(types).toBeDisabled();
          await expect(builder.locator(".sfb-published-card")).toHaveCount(0);
          release();
          await expect(builder.locator(".sfb-published-card")).toContainText("Published");
          await expect(publish).toHaveCount(0);
          await expect(types).toBeEnabled();
          return result.id as string;
        } finally {
          release();
          await page.unroute(refreshUrl);
        }
      }
      const matchSchema = await publishCurrent();
      await types.selectOption("pit");
      await expect(builder.getByLabel("Form title", { exact: true })).toHaveValue(`${marker} Pit`);
      await expect(builder.locator(".sfb-question").first().getByLabel("Label", { exact: true })).toHaveValue("Robot detail");
      const pitSchema = await publishCurrent();
      await page.reload();
      await expect(builder.getByLabel("Form title", { exact: true })).toHaveValue(`${marker} Pit`);
      await types.selectOption("match");
      await expect(builder.getByLabel("Form title", { exact: true })).toHaveValue(`${marker} Match`);
      await expect(builder.locator(".sfb-question").first().getByLabel("Label", { exact: true })).toHaveValue("Drive preference");
      const persisted = await (await context.request.get(`/api/scouting/schemas?orgId=${orgId}`)).json();
      expect(persisted.schemas.find((s: { id: string }) => s.id === matchSchema).definition.fields[0].options).toEqual(["Swerve", "Tank"]);
      expect(persisted.schemas.find((s: { id: string }) => s.id === pitSchema).definition.fields[0]).toMatchObject({ key: "notes", label: "Robot detail" });
      await types.selectOption("pit");
      await page.screenshot({ path: testInfo.outputPath(`scouting-builder-${width}.png`), fullPage: true });
      await page.goto(`/competition?tab=scouting&scoutTab=pit&teamKey=${encodeURIComponent(teamKey)}&orgId=${orgId}`);
      await page.getByRole("textbox", { name: "Robot detail", exact: true }).fill(`${marker} observed robot`);
      await page.getByRole("button", { name: "Save this pit", exact: true }).click();
      await expect.poll(async () => {
        const result = await pool.query("SELECT schema_id,payload FROM pit_scout_entries WHERE org_id=$1 AND schema_id=$2", [orgId, pitSchema]);
        return result.rows.map(row => ({ schema: row.schema_id, notes: row.payload.notes }));
      }, { timeout: 30_000 }).toEqual([{ schema: pitSchema, notes: `${marker} observed robot` }]);
      await page.goto(`/competition?tab=forms&orgId=${orgId}`);
      await builder.getByRole("navigation", { name: "Form workspace" }).getByRole("button", { name: "Responses", exact: true }).click();
      await builder.locator(".sfb-responses").getByLabel("Team number", { exact: true }).fill(teamKey.replace(/^frc/, ""));
      await expect(builder.locator(".sfb-responses")).toContainText("1 response");
      await builder.getByRole("navigation", { name: "Response view" }).getByRole("button", { name: "Table", exact: true }).click();
      await expect(builder.getByRole("table")).toContainText(`${marker} observed robot`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      // Only versions and entries created by this journey in the guarded scratch DB.
      await pool.query("DELETE FROM pit_scout_entries WHERE org_id=$1 AND schema_id=ANY($2::uuid[])", [orgId, schemas]);
      await pool.query("DELETE FROM scout_schemas WHERE org_id=$1 AND id=ANY($2::uuid[])", [orgId, schemas]);
      await pool.end();
    }
  });
}
