import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { signInAs } from "./session";

test.use({ actionTimeout: 15_000 });

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
      "SELECT team_key FROM teams_ref t WHERE NOT EXISTS (SELECT 1 FROM pit_scout_entries p WHERE p.org_id=$1 AND p.event_key=$2 AND p.team_key=t.team_key AND p.scout_user_id=$3) ORDER BY team_key LIMIT 1",
      [orgId, initialData.eventKey, me.userId],
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
      await expect(builder.getByLabel("Form title", { exact: true })).toHaveValue(`${marker} match starter`);
      const types = builder.getByRole("navigation", { name: "Form type" });
      await builder.getByLabel("Form title", { exact: true }).fill(`${marker} Match`);
      await builder.locator(".sfb-question").first().getByLabel("Label", { exact: true }).fill("Cycle notes");
      await builder.getByRole("button", { name: "Add question", exact: true }).click();
      const question = builder.locator(".sfb-question").last();
      await question.getByLabel("Label", { exact: true }).fill("Drive preference");
      await question.getByLabel(/^Answer type/).selectOption("dropdown");
      await question.getByLabel("Option 1", { exact: true }).fill("Swerve");
      await question.getByLabel("Option 2", { exact: true }).fill("Tank");
      await builder.getByRole("button", { name: "Move question 2 up", exact: true }).click();
      await expect(builder.locator(".sfb-question").first().getByLabel("Label", { exact: true })).toHaveValue("Drive preference");
      await types.getByRole("button", { name: "Pit form", exact: true }).click();
      await builder.getByLabel("Form title", { exact: true }).fill(`${marker} Pit`);
      await builder.locator(".sfb-question").first().getByLabel("Label", { exact: true }).fill("Robot detail");
      await types.getByRole("button", { name: "Match form", exact: true }).click();
      await expect(builder.getByLabel("Form title", { exact: true })).toHaveValue(`${marker} Match`);
      await expect(builder.locator(".sfb-question")).toHaveCount(2);
      await expect(builder.getByLabel("Option 1", { exact: true })).toHaveValue("Swerve");
      await builder.getByLabel("Edit or preview", { exact: true }).selectOption("preview");
      const preview = builder.locator(".sfb-tablet");
      await expect(preview).toContainText("Drive preference");
      await preview.getByRole("textbox", { name: "Cycle notes", exact: true }).fill("Preview only");
      await builder.getByLabel("Edit or preview", { exact: true }).selectOption("edit");
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
        const responsePromise = page.waitForResponse(r => r.url().endsWith("/api/scouting/schemas") && r.request().method() === "POST");
        await publish.click();
        const response = await responsePromise;
        expect(response.status()).toBe(201);
        const result = await response.json();
        schemas.push(result.id);
        await expect(builder.locator(".sfb-published-card")).toContainText("Published");
        await expect(publish).toHaveCount(0);
        return result.id as string;
      }
      const matchSchema = await publishCurrent();
      await types.getByRole("button", { name: "Pit form", exact: true }).click();
      await expect(builder.getByLabel("Form title", { exact: true })).toHaveValue(`${marker} Pit`);
      await expect(builder.locator(".sfb-question").first().getByLabel("Label", { exact: true })).toHaveValue("Robot detail");
      const pitSchema = await publishCurrent();
      await page.reload();
      await expect(builder.getByLabel("Form title", { exact: true })).toHaveValue(`${marker} Match`);
      await expect(builder.locator(".sfb-question").first().getByLabel("Label", { exact: true })).toHaveValue("Drive preference");
      const persisted = await (await context.request.get(`/api/scouting/schemas?orgId=${orgId}`)).json();
      expect(persisted.schemas.find((s: { id: string }) => s.id === matchSchema).definition.fields[0].options).toEqual(["Swerve", "Tank"]);
      expect(persisted.schemas.find((s: { id: string }) => s.id === pitSchema).definition.fields[0]).toMatchObject({ key: "notes", label: "Robot detail" });
      await types.getByRole("button", { name: "Pit form", exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath(`scouting-builder-${width}.png`), fullPage: true });
      await page.goto(`/competition?tab=scouting&scoutTab=pit&teamKey=${encodeURIComponent(teamKey)}&orgId=${orgId}`);
      await page.getByRole("textbox", { name: "Robot detail", exact: true }).fill(`${marker} observed robot`);
      await page.getByRole("button", { name: "Save this pit", exact: true }).click();
      await expect.poll(async () => {
        const result = await pool.query("SELECT schema_id,payload FROM pit_scout_entries WHERE org_id=$1 AND schema_id=$2", [orgId, pitSchema]);
        return result.rows.map(row => ({ schema: row.schema_id, notes: row.payload.notes }));
      }, { timeout: 30_000 }).toEqual([{ schema: pitSchema, notes: `${marker} observed robot` }]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      // Only versions and entries created by this journey in the guarded scratch DB.
      await pool.query("DELETE FROM pit_scout_entries WHERE org_id=$1 AND schema_id=ANY($2::uuid[])", [orgId, schemas]);
      await pool.query("DELETE FROM scout_schemas WHERE org_id=$1 AND id=ANY($2::uuid[])", [orgId, schemas]);
      await pool.end();
    }
  });
}