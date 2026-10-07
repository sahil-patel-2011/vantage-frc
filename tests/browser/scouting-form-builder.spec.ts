import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { signInAs } from "./session";

test.use({ actionTimeout: 15_000 });

test("ordinary scouts can preview published forms without admin controls or misleading setup prompts", async ({ page, context }) => {
  expect(await signInAs(context, "member")).toBe(true);
  const orgId = (await (await context.request.get("/api/me")).json()).orgId;
  await page.goto(`/competition?tab=forms&orgId=${orgId}`);
  const builder = page.locator(".sfb-page");
  const schemas = await context.request.get(`/api/scouting/schemas?orgId=${orgId}`);
  expect(schemas.ok()).toBe(true);
  expect((await schemas.json()).canManageSchemas).toBe(false);
  await expect(builder.getByLabel("Form title", { exact: true })).toBeDisabled();
  await expect(builder.getByRole("button", { name: "Add question", exact: true })).toBeDisabled();
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
          orgId, year: initialData.year, type, baseSchemaId: initialData.schemas.find((schema: {type:string; id:string}) => schema.type === type)?.id ?? null,
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
      await builder.getByRole("button", { name: "Expand all questions", exact: true }).click();
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
        const refreshUrl = "**/api/scouting/schemas?*";
        // A confirmed POST is sufficient even when a follow-up read is unavailable.
        await page.route(refreshUrl, route => route.fulfill({ status: 503, json: { error: "Refresh unavailable" } }));
        try {
          const responsePromise = page.waitForResponse(r => r.url().endsWith("/api/scouting/schemas") && r.request().method() === "POST");
          await publish.click();
          const response = await responsePromise;
          expect(response.status()).toBe(201);
          const result = await response.json();
          schemas.push(result.id);
          await expect(builder.locator(".sfb-published-card")).toContainText("Published");
          await expect(publish).toHaveCount(0);
          await expect(types).toBeEnabled();
          return result.id as string;
        } finally {
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


test("a delegated custom scouting lead can publish but cannot administer people, and revocation takes effect", async ({page,context,browser}) => {
  test.setTimeout(120_000);
  expect(await signInAs(context,"member")).toBe(true);
  const me=await (await context.request.get("/api/me")).json();
  const orgId=me.orgId as string, memberId=me.userId as string;
  const owner=await browser.newContext(); expect(await signInAs(owner,"owner")).toBe(true);
  const members=await (await owner.request.get(`/api/organizations/members?orgId=${orgId}`)).json();
  const prior=members.members.find((row:{userId:string})=>row.userId===memberId);
  expect(prior).toBeTruthy();
  const db=new URL(process.env.DATABASE_ADMIN_URL!); expect(["127.0.0.1","localhost"]).toContain(db.hostname); expect(db.pathname).toContain("vantage_ci");
  const pool=new Pool({connectionString:db.href,ssl:false}); let key=`lead-${randomUUID()}`; const created:string[]=[];
  try {
    const saved=await owner.request.post("/api/organizations/role-profiles",{data:{orgId,action:"save",key,name:"Journey scouting lead",baseRole:"scout",capabilities:["manage_scouting"],hubAccess:{competition:["scouting"]}}});
    expect(saved.ok(),await saved.text()).toBe(true);
    const savedProfile=(await saved.json()).profile; key=savedProfile.key;
    expect(savedProfile.hubAccess).toEqual({competition:[]});
    const applied=await owner.request.post("/api/organizations/role-profiles",{data:{orgId,action:"apply",key,userId:memberId}});
    expect(applied.ok(),await applied.text()).toBe(true);
    expect((await context.request.get(`/api/organizations/members?orgId=${orgId}`)).status()).toBe(403);
    const setup=await (await context.request.get(`/api/scouting/schemas?orgId=${orgId}`)).json(); expect(setup.canManageSchemas).toBe(true);
    const schema=await context.request.post("/api/scouting/schemas",{data:{orgId,year:setup.year,type:"pit",baseSchemaId:setup.schemas.find((entry:{type:string;id:string})=>entry.type==="pit")?.id??null,definition:{title:key,fields:[{key:"notes",label:"Notes",type:"text",required:false}]}}});
    expect(schema.status(),await schema.text()).toBe(201); created.push((await schema.json()).id);
    await page.goto(`/competition?tab=forms&orgId=${orgId}`);
    const builder=page.locator(".sfb-page");
    await builder.getByRole("combobox",{name:"Form type",exact:true}).selectOption("pit");
    await expect(builder.getByLabel("Form title",{exact:true})).toBeEnabled();
    await builder.getByLabel("Form title",{exact:true}).fill(`${key} edited`);
    const published=page.waitForResponse(response=>response.url().endsWith("/api/scouting/schemas") && response.request().method()==="POST");
    await builder.getByRole("button",{name:"Publish changes",exact:true}).click(); const response=await published;
    expect(response.status(),await response.text()).toBe(201); created.push((await response.json()).id);
    await page.reload(); await expect(builder.getByLabel("Form title",{exact:true})).toHaveValue(`${key} edited`);
    const revoked=await owner.request.patch("/api/organizations/members",{data:{orgId,userId:memberId,action:"set_capabilities",capabilities:prior.capabilities ?? []}});
    expect(revoked.ok(),await revoked.text()).toBe(true);
    await page.reload(); await expect(builder.getByLabel("Form title",{exact:true})).toBeDisabled();
    const forbidden=await context.request.post("/api/scouting/schemas",{data:{orgId,year:setup.year,type:"pit",definition:{title:"Denied",fields:[{key:"notes",label:"Notes",type:"text",required:false}]}}});
    expect(forbidden.status()).toBe(403);
  } finally {
    await owner.request.patch("/api/organizations/members",{data:{orgId,userId:memberId,action:"set_capabilities",capabilities:prior.capabilities ?? []}});
    await owner.request.patch("/api/organizations/members",{data:{orgId,userId:memberId,action:"set_hub_access",hubAccess:members.hubAccessByUser[memberId] ?? []}});
    await owner.request.post("/api/organizations/role-profiles",{data:{orgId,action:"delete",key}});
    if(created.length) await pool.query("DELETE FROM scout_schemas WHERE org_id=$1 AND id=ANY($2::uuid[])",[orgId,created]);
    await pool.end(); await owner.close();
  }
});
