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
 const admin=process.env.DATABASE_ADMIN_URL!;expect(new URL(admin).hostname).toBe("127.0.0.1");expect(new URL(admin).pathname).toMatch(/_test_/);const db=new Pool({connectionString:admin,ssl:false});
 try {await page.reload();await saved.selectOption(body.id);await expect(page.getByLabel("List name",{exact:true})).toHaveValue(name);await expect(page.locator("[data-entry-id]")).toHaveCount(1);}
 finally {await db.query("DELETE FROM pick_lists WHERE org_id=$1 AND id=$2",[orgId,body.id]);await db.end();}
});
