import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { signInAs } from "./session";
const orgId="6925a000-0000-4000-8000-000000000001";
test.use({actionTimeout:15000});
for(const width of [390,1440])test(`Teams analysis, comparison and saved offline view at ${width}px`,async({page,context},info)=>{
 test.setTimeout(180000);expect(await signInAs(context,"owner")).toBe(true);await page.setViewportSize({width,height:900});
 if(width===390){await page.route("**/api/theme",route=>route.fulfill({json:{theme:"dark",persisted:true}}));await page.addInitScript(()=>{localStorage.setItem("vantage-theme-pref","dark");localStorage.setItem("vantage-theme","dark");});}
 await page.goto(`/competition?tab=teams&orgId=${orgId}`);
 if(width===390) await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
 const rows=page.locator(".stp-row");await expect(rows.first()).toBeVisible({timeout:60000});expect(await rows.count()).toBeGreaterThan(1);
 const sort=page.getByRole("combobox",{name:"Sort robots",exact:true});await sort.selectOption("number");
 const numbers=(await page.locator(".stp-team").allTextContents()).map(Number);expect(numbers).toEqual([...numbers].sort((a,b)=>a-b));
 await rows.first().locator(".stp-row-main").click();await page.getByRole("button",{name:"Add to comparison",exact:true}).click();
 if(width===390)await page.getByRole("button",{name:"All robots",exact:false}).click();
 await rows.nth(1).locator(".stp-row-main").click();await page.getByRole("button",{name:"Add to comparison",exact:true}).click();
 await expect(page.getByRole("region",{name:"Compare robots",exact:true})).toBeVisible();
 if(width===390)await page.getByRole("button",{name:"All robots",exact:false}).click();
 await sort.selectOption("fit");await page.getByText("Adjust what makes a good pick",{exact:true}).click();
 const slider=page.getByRole("slider").first();await slider.focus();await slider.press("Home");await slider.press("ArrowRight");const weight=await slider.inputValue();
 await page.reload();await expect(rows.first()).toBeVisible({timeout:30000});await expect(page.getByRole("region",{name:"Compare robots",exact:true})).toBeVisible();
 await page.getByText("Adjust what makes a good pick",{exact:true}).click();await expect(slider).toHaveValue(weight);
 const scan=await new AxeBuilder({page}).include(".competition-teams").analyze();expect(scan.violations).toEqual([]);
 await page.keyboard.press("Control+Home");await page.screenshot({path:info.outputPath(`teams-${width}.png`)});
 const sections=page.getByRole("tablist",{name:"Competition sections",exact:true});
 await sections.getByRole("tab",{name:"Scout",exact:true}).click();
 await expect(page.getByRole("tablist",{name:"Scouting task",exact:true})).toBeVisible({timeout:30000});
 await context.setOffline(true);
 await sections.getByRole("tab",{name:"Teams",exact:true}).click();
 await expect(page.locator(".scout-cached-analysis")).toBeVisible({timeout:30000});await expect(rows.first()).toBeVisible();
 await context.setOffline(false);await expect(page.locator(".scout-cached-analysis")).toHaveCount(0,{timeout:30000});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test("one pick-list page creates, saves and reloads a new ordered list",async({page,context})=>{
 test.setTimeout(180000);expect(await signInAs(context,"owner")).toBe(true);await page.goto(`/competition?tab=picks&orgId=${orgId}`);
 const saved=page.getByRole("combobox",{name:"Saved pick list",exact:true});await expect(saved).toBeVisible({timeout:60000});await saved.selectOption("");
 const name=`Workflow check ${Date.now()}`;await page.getByLabel("List name",{exact:true}).fill(name);
 const pool=page.locator(".strategy-pick-pool");await pool.getByRole("button",{name:/Add to/}).first().click();
 const request=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/intel/pick-lists"&&response.request().method()==="POST");
 await page.getByRole("button",{name:"Save pick list",exact:true}).click();const response=await request;expect(response.status()).toBe(201);const body=await response.json();expect(body.id).toBeTruthy();
 const admin=process.env.DATABASE_ADMIN_URL!;expect(new URL(admin).hostname).toBe("127.0.0.1");expect(new URL(admin).pathname).toMatch(/(?:^|[_/-])(?:test|ci)(?:[_/-]|$)/);const db=new Pool({connectionString:admin,ssl:false});
 try {await page.reload();await saved.selectOption(body.id);await expect(page.getByLabel("List name",{exact:true})).toHaveValue(name);await expect(page.locator("[data-entry-id]")).toHaveCount(1);}
 finally {await db.query("DELETE FROM pick_lists WHERE org_id=$1 AND id=$2",[orgId,body.id]);await db.end();}
});

test("ranking saves retain discussion identities and reject stale or locked lists", async ({ context }) => {
  expect(await signInAs(context, "owner")).toBe(true);
  const api = context.request;
  const deskResponse = await api.get(`/api/strategy/pick-desk?orgId=${orgId}`);
  expect(deskResponse.ok()).toBe(true);
  const desk = await deskResponse.json();
  const teamKey = desk.candidates[0]?.teamKey;
  expect(teamKey).toBeTruthy();
  const body = { orgId, eventKey: desk.eventKey, name: `Identity acceptance ${Date.now()}`, entries: [{ teamKey, rank: 1, tier: "first", notes: "Keep discussion" }] };
  const created = await api.post("/api/intel/pick-lists", { data: body });
  expect(created.status()).toBe(201);
  const saved = await created.json();
  const admin = process.env.DATABASE_ADMIN_URL!;
  expect(new URL(admin).hostname).toBe("127.0.0.1");
  expect(new URL(admin).pathname).toMatch(/(?:^|[_/-])(?:test|ci)(?:[_/-]|$)/);
  const db = new Pool({ connectionString: admin, ssl: false });
  try {
    const read = async () => {
      const response = await api.get(`/api/picklist-collab?orgId=${orgId}&listId=${saved.id}`);
      expect(response.ok()).toBe(true);
      return response.json();
    };
    const before = await read();
    const entryId = before.entries[0].id;
    expect((await api.post("/api/picklist-collab", { data: { orgId, listId: saved.id, action: "cast-vote", entryId, weight: 2, comment: "Strong auto fit" } })).ok()).toBe(true);
    // A teammate's vote advanced the shared revision; the earlier editor cannot replace it.
    expect((await api.post("/api/intel/pick-lists", { data: { ...body, id: saved.id, baseRevision: saved.revision } })).status()).toBe(409);
    const latest = await (await api.get(`/api/strategy/pick-desk?orgId=${orgId}`)).json();
    const revision = latest.pickLists.find((list: { id: string }) => list.id === saved.id).revision;
    const updated = await api.post("/api/intel/pick-lists", { data: { ...body, id: saved.id, baseRevision: revision, entries: [{ ...body.entries[0], tier: "avoid" }] } });
    expect(updated.status()).toBe(201);
    const after = await read();
    expect(after.entries[0]).toMatchObject({ id: entryId, tier: "avoid", note: "Keep discussion" });
    expect(after.entries[0].votes).toHaveLength(1);
    expect(after.entries[0].votes[0]).toMatchObject({ weight: 2, comment: "Strong auto fit" });
    expect((await api.post("/api/picklist-collab", { data: { orgId, listId: saved.id, action: "update-list-status", status: "locked" } })).ok()).toBe(true);
    expect((await api.post("/api/intel/pick-lists", { data: { ...body, id: saved.id } })).status()).toBe(409);
    expect((await read()).entries[0].id).toBe(entryId);
  } finally {
    await db.query("DELETE FROM pick_lists WHERE org_id=$1 AND id=$2", [orgId, saved.id]);
    await db.end();
  }
});
