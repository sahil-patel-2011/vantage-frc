import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { signInAs } from "./session";
import type { Bootstrap } from "../../apps/web/app/scouting/scouting-model";
import { MATCH_CAPTURE_KEY } from "../../packages/scouting/src";

const orgId = "6925a000-0000-4000-8000-000000000001";
function testDatabase() {
  const url = new URL(process.env.DATABASE_ADMIN_URL!);
  expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
  expect(url.pathname).toMatch(/test|ci/i);
  return new Pool({ connectionString: url.href, ssl: false });
}

test.use({ actionTimeout: 15_000 });
for (const width of [320, 390, 1440]) {
  test(`real match answers, correction and reload keep one report at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner")).toBe(true);
    const db = testDatabase();
    const marker = `Scouting correction ${randomUUID()}`;
    let schemaId: string | undefined;
    try {
      // Each correction story publishes its own custom form; it cannot inherit
      // whichever season/editor questions another story last selected.
      const setup=await (await context.request.get(`/api/scouting/schemas?orgId=${orgId}`)).json();
      const published=await context.request.post("/api/scouting/schemas",{data:{orgId,year:setup.year,type:"match",baseSchemaId:setup.schemas.find((entry:{type:string;id:string})=>entry.type==="match")?.id??null,definition:{title:marker,fields:[
        {key:"autoPoints",label:"Auto points",type:"number",config:{requireObservation:true,scoutPhase:"auto",min:0,integer:true}},
        {key:"notes",label:"Notes",type:"text",required:false},
      ]}}});
      expect(published.status(),await published.text()).toBe(201); schemaId=(await published.json()).id;
      const response = await context.request.get(`/api/scouting/bootstrap?orgId=${orgId}`);
      expect(response.ok()).toBe(true);
      const data = await response.json() as Bootstrap;
      const match = data.matches.find(match => !match.actualTime && match.redAlliance?.teamKeys?.length) ?? data.matches[0];
      const team = match.redAlliance?.teamKeys?.[0];
      expect(team).toBeTruthy();
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      if (width === 390) {
        await page.route("**/api/theme", route => route.fulfill({ json: { theme: "dark", persisted: true } }));
        await page.addInitScript(() => { localStorage.setItem("vantage-theme-pref", "dark"); localStorage.setItem("vantage-theme", "dark"); });
      }
      const href = `/competition?orgId=${orgId}&matchKey=${match.matchKey}&teamKey=${team}`;
      await page.goto(href);
      const task = page.getByRole("tablist", { name: "Scouting task", exact: true });
      await expect(task.getByRole("tab", { name: "Match", exact: true })).toHaveAttribute("aria-selected", "true");
      const auto = page.getByRole("spinbutton", { name: "Auto points", exact: true });
      await expect(auto).toBeVisible({ timeout: 60_000 });
      await page.getByRole("button", { name: "Auto points: record zero", exact: true }).click();
      await expect(auto).toHaveValue("0");
      await page.getByRole("button", { name: "Auto points: clear answer", exact: true }).click();
      await expect(auto).toHaveValue("");
      await page.getByRole("button", { name: "Auto points: one more", exact: true }).click();
      await page.getByRole("button", { name: "Auto points: one more", exact: true }).click();
      await page.getByRole("button", { name: "Undo last answer", exact: true }).click();
      await expect(auto).toHaveValue("1");
      await page.getByRole("textbox", { name: "Notes", exact: true }).fill(marker);
      const activity = page.getByRole("region", { name: "Live match activity", exact: true });
      const epoch = Date.now();
      await page.clock.setFixedTime(new Date(epoch));
      await page.getByRole("button", { name: "Start match timer when auto starts", exact: true }).click();
      await page.clock.setFixedTime(new Date(epoch + 1000));
      await expect(activity).toContainText("0:01 elapsed");
      await activity.getByRole("button", { name: "Shooting", exact: true }).click();
      await page.clock.setFixedTime(new Date(epoch + 11000));
      await expect(activity).toContainText("0:11 elapsed");
      await activity.getByRole("button", { name: "Stop shooting", exact: true }).click();
      await activity.getByLabel("Fuel released in last shooting bout", { exact: true }).fill("20");
      await page.getByRole("tablist", { name: "Match form section", exact: true }).getByRole("tab", { name: "Review", exact: true }).click();
      await page.getByRole("radio", { name: "Guessing", exact: true }).click();
      await page.locator(".scout-save-button").click();
      await expect(page.locator(".scout-save-button")).toHaveText("Tap again to save");
      await page.locator(".scout-save-button").click();
      await expect(page.locator("#scout-save-confirmation")).toContainText(`Saved ${team!.replace("frc", "")}`);
      const saved = async () => (await db.query("SELECT client_id, payload, confidence FROM match_scout_entries WHERE org_id=$1 AND payload->>'notes'=$2", [orgId, marker])).rows;
      await expect.poll(async () => (await saved()).length).toBe(1);
      const clientId = (await saved())[0].client_id;
      expect((await saved())[0].payload.autoPoints).toBe(1);
      expect((await saved())[0].confidence).toBe("low");
      const captured = (await saved())[0].payload[MATCH_CAPTURE_KEY];
      expect(captured).toMatchObject({ version: 1, seasonYear: 2026, bouts: [{ kind: "shooting", startMs: 1000, endMs: 11000, count: 20 }] });
      await page.getByRole("button", { name: "Fix it", exact: true }).click();
      await expect(auto).toHaveValue("1");
      await auto.fill("9");
      await page.locator(".scout-save-button").click();
      await expect.poll(async () => (await saved())[0]?.payload.autoPoints).toBe(9);
      expect((await saved()).map(row => row.client_id)).toEqual([clientId]);
      expect((await saved())[0].payload[MATCH_CAPTURE_KEY]).toEqual(captured);
      await page.goto(href);
      await expect(auto).toHaveValue("9", { timeout: 30_000 });
      await expect(page.locator(".scout-answers")).toContainText("You already scouted");
      await expect(page.getByRole("radio", { name: "Guessing", exact: true })).toBeChecked();
      await activity.getByText("Review recorded activity", { exact: true }).click();
      await expect(activity).toContainText("20 in 10.0s");
      const audit = await new AxeBuilder({ page }).include(".scout-page").analyze();
      expect(audit.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`match-correction-${width}.png`), fullPage: true });
    } finally {
      await db.query("DELETE FROM match_scout_entries WHERE org_id=$1 AND payload->>'notes'=$2", [orgId, marker]);
      if(schemaId) await db.query("DELETE FROM scout_schemas WHERE org_id=$1 AND id=$2",[orgId,schemaId]);
      await db.end();
    }
  });
}

for (const width of [390, 1440]) {
  test(`pit search, save and cancel leave a fresh robot selection at ${width}px`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    expect(await signInAs(context, "owner")).toBe(true);
    const db = testDatabase();
    const marker = `Pit reset ${randomUUID()}`;
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/competition?orgId=${orgId}`);
      const tasks = page.getByRole("tablist", { name: "Scouting task", exact: true });
      await tasks.getByRole("tab", { name: "Pit", exact: true }).click();
      const team = page.getByRole("textbox", { name: "Team number", exact: true });
      await expect(team).toHaveValue("");
      await expect(page.getByRole("textbox", { name: "Notes", exact: true })).toHaveCount(0);
      await page.reload();
      await expect(tasks.getByRole("tab", { name: "Pit", exact: true })).toHaveAttribute("aria-selected", "true");
      await team.fill("0");
      await expect(team).toHaveValue("0");
      await expect(team).toHaveAttribute("aria-invalid", "true");
      const search = page.getByRole("searchbox", { name: "Find an unvisited pit", exact: true });
      await search.fill("9999");
      await page.getByRole("button", { name: /^Pit scout team 9999/ }).click();
      await expect(team).toHaveValue("9999");
      await page.getByRole("textbox", { name: "Notes", exact: true }).fill(marker);
      await page.locator(".scout-save-button").click();
      await expect(page.locator("#scout-save-confirmation")).toContainText("Saved pit report for 9999");
      await expect(team).toHaveValue("");
      await expect(page.getByRole("textbox", { name: "Notes", exact: true })).toHaveCount(0);
      await expect.poll(async () => (await db.query("SELECT count(*)::int AS n FROM pit_scout_entries WHERE org_id=$1 AND payload->>'notes'=$2", [orgId, marker])).rows[0].n).toBe(1);
      await expect(page.getByRole("button", { name: /^Pit scout team 9999/ })).toHaveCount(0);
      await search.fill("118");
      await page.getByRole("button", { name: /^Pit scout team 118/ }).click();
      await expect(page.getByRole("textbox", { name: "Notes", exact: true })).toHaveValue("");
      await page.getByRole("textbox", { name: "Notes", exact: true }).fill("Discard this draft");
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: "Cancel report", exact: true }).click();
      await expect(team).toHaveValue("");
      await expect(page.getByRole("textbox", { name: "Notes", exact: true })).toHaveCount(0);
      const audit = await new AxeBuilder({ page }).include(".scout-page").analyze();
      expect(audit.violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`pit-reset-${width}.png`), fullPage: true });
    } finally {
      await db.query("DELETE FROM pit_scout_entries WHERE org_id=$1 AND payload->>'notes'=$2", [orgId, marker]);
      await db.end();
    }
  });
}
