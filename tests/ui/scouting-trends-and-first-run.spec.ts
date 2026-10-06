import { expect, test } from "@playwright/test";
import { accessible, isolateUi, orgId, userId } from "./fixture";
import { contrastRatio } from "../../apps/web/lib/branding/colors";

for (const width of [390, 1440]) test(`product surfaces and browser chrome share the chosen palette at ${width}px`, async ({page,context}) => {
  await page.setViewportSize({width,height:950}); await isolateUi(page,context);
  await page.emulateMedia({reducedMotion:"reduce",colorScheme:"light"});
  await page.goto(`/account?tab=appearance&orgId=${orgId}`);
  const themes=page.getByRole("group",{name:"Color theme",exact:true});
  for (const name of ["Light","Dark"]) {
    await themes.getByRole("radio",{name,exact:true}).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme",name.toLowerCase());
    const palettes=await page.evaluate(() => {
      const read=(node:Element)=>Object.fromEntries(["bg","surface","ink","muted","accent","accent-ink","positive","critical","warning","alliance-blue"].map(key=>[key,getComputedStyle(node).getPropertyValue(`--${key}`).trim()]));
      return {root:read(document.documentElement),body:read(document.body)};
    });
    expect(palettes.body).toEqual(palettes.root);
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content",palettes.root.bg);
    for (const token of ["ink","muted","accent","positive","critical","warning","alliance-blue"]) expect(contrastRatio(palettes.body[token],palettes.body.surface)).toBeGreaterThanOrEqual(4.5);
    await accessible(page,".theme-setting");
  }
  await page.emulateMedia({colorScheme:"dark"});
  await themes.getByRole("radio",{name:/^System/}).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme","dark");
  await page.emulateMedia({colorScheme:"light"});
  await expect(page.locator("html")).toHaveAttribute("data-theme","light");
});

for (const [width,theme] of [[390,"dark"],[1440,"light"]] as const) test(`event trends show evidence and filter real answers at ${width}px ${theme}`,async({page,context},info)=>{
  await page.setViewportSize({width,height:950}); await isolateUi(page,context,theme);
  const fields=[{key:"tower_level",label:"Endgame tower climb",type:"select",options:["none","L1","L2","L3","could_not_see"]},{key:"fuel",label:"Fuel scored",type:"number",config:{unit:"fuel"}}];
  const report=(qm:number,tower:unknown,fuel:unknown,confidence="normal")=>({eventKey:"2026test",matchKey:`2026test_qm${qm}`,confidence,fields,payload:{tower_level:tower,fuel}});
  await page.route("**/api/scouting/teams?**",route=>route.fulfill({json:{status:"needs_formula",eventKey:"2026test",message:"No scoring formula",observations:[
    {teamKey:"frc254",reports:[report(1,"none",0),report(1,"none",2),report(2,"none",4),report(10,"none",6),report(11,"none",8)]},
    {teamKey:"frc6925",reports:[report(1,"L1",10),report(2,"could_not_see",null),report(10,"L3",20),report(11,"L3",30),report(12,"none",0,"low")]},
    {teamKey:"frc118",reports:[report(1,null,null)]},
  ]}}));
  await page.goto(`/competition?tab=teams&orgId=${orgId}`);
  const trends=page.getByRole("region",{name:"Event scouting trends"});
  await expect(trends).toContainText("1 of 2 observed robots have no climb recorded");
  await expect(trends).toContainText("7/9"); await expect(trends).toContainText("Q1–Q2"); await expect(trends).toContainText("Q10–Q11");
  await trends.getByText("Contributing answers",{exact:true}).click();
  await expect(trends.getByRole("table").getByRole("row")).toHaveCount(8);
  await trends.getByLabel("Include low-confidence reports",{exact:true}).check();
  await expect(trends).toContainText("8/10");
  await trends.getByLabel("Trend metric",{exact:true}).selectOption("fuel");
  await expect(trends).toContainText("9.88 fuel");
  await accessible(page,".stp-observations"); await trends.scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath(`trends-${width}-${theme}.png`)});
});

test("custom role editing preserves tab limits and scouting leads can be assigned",async({page,context})=>{
  await page.setViewportSize({width:390,height:950}); await isolateUi(page,context);
  const roles=[{key:"scout",name:"Scout",description:"Match collection",baseRole:"scout",capabilities:[] as string[],hubAccess:{competition:["scouting","event-day"]} as Record<string,string[]>}];
  const applied:unknown[]=[]; const writes:typeof roles=[];
  await page.route("**/api/organizations/members?**",route=>route.fulfill({json:{members:[{userId,name:"Ada",email:"ada@example.test",role:"scout"}]}}));
  await page.route("**/api/organizations/role-profiles**",route=>{
    if(route.request().method()==="POST"){
      const body=route.request().postDataJSON();
      if(body.action==="apply")applied.push(body);else if(body.action==="save"){writes.push(body);const prior=roles.findIndex(role=>role.key===body.key);const normalized={...body,key:body.key.toLowerCase().replace(/[^a-z0-9]+/g,"-")};if(prior>=0)roles.splice(prior,1,normalized);else roles.push(normalized);}
      return route.fulfill({json:{success:true}});
    }
    return route.fulfill({json:{actorRole:"owner",profiles:roles}});
  });
  await page.goto(`/team/admin/presets?orgId=${orgId}`);
  await page.getByRole("button",{name:"Edit",exact:true}).click();
  await page.getByLabel("Name",{exact:true}).fill("Match scout");
  await page.getByRole("button",{name:"Save profile",exact:true}).click();
  await expect.poll(()=>writes.length).toBe(1);
  expect(writes[0]?.hubAccess).toEqual({competition:["scouting","event-day"]});
  await page.getByRole("button",{name:"New custom role",exact:true}).click();
  await page.getByLabel("Name",{exact:true}).fill("Scouting lead");
  await page.getByRole("checkbox",{name:/Scouting lead/}).check();
  await expect(page.getByRole("checkbox",{name:/^Competition/})).toBeChecked();
  await page.getByRole("button",{name:"Save profile",exact:true}).click();
  await expect.poll(()=>writes.length).toBe(2);
  expect(writes[1]?.capabilities).toContain("manage_scouting");
  expect(writes[1]?.baseRole).toBe("scout");
  const role=page.locator(".rpf-list > li").filter({has:page.getByText("Scouting lead",{exact:true})});
  await role.getByRole("combobox").selectOption(userId);
  await role.getByRole("button",{name:"Apply",exact:true}).click();
  await expect.poll(()=>applied.length).toBe(1);
  expect(applied[0]).toMatchObject({action:"apply",orgId,userId,key:"scouting-lead"});
  await accessible(page,".rpf");
});

test("signed-in accounts never see automatic cookie prompts, but can change consent explicitly",async({page,context})=>{
  await isolateUi(page,context); await context.clearCookies({name:"vantage-analytics-consent"});
  await page.goto(`/dashboard?orgId=${orgId}`);
  await expect(page.getByRole("button",{name:"Edit Home — rearrange, add, or remove widgets",exact:true})).toBeVisible();
  await expect(page.locator(".consent-banner")).toHaveCount(0);
  expect(await page.evaluate(()=>document.cookie)).not.toContain("granted");
  await page.goto("/privacy#analytics");
  await expect(page.getByRole("region",{name:"Product analytics choice"})).toBeVisible();
  await page.getByRole("button",{name:"Only necessary cookies",exact:true}).click();
  await expect(page.locator(".consent-banner")).toHaveCount(0);
  await page.goto(`/competition?tab=scouting&orgId=${orgId}`);
  await expect(page.locator(".consent-banner")).toHaveCount(0);
});

test("the first-run walkthrough is claimed once and never reappears after reload or lost browser markers",async({page,context})=>{
  await isolateUi(page,context,"light",{firstRun:true}); let seen=false;let claims=0;
  await page.route("**/api/me**",route=>route.fulfill({json:{authenticated:true,userId,orgId,name:"Ada",role:"owner",teamNumber:6925,memberships:[{orgId,orgName:"Test Robotics",role:"owner",teamNumber:6925}],hubAccess:null,onboardingComplete:true,appTourSeen:seen,memberSince:new Date().toISOString()}}));
  await page.route("**/api/account/tour",route=>{claims++;const start=!seen;seen=true;return route.fulfill({json:{start}});});
  await page.goto(`/dashboard?orgId=${orgId}`);
  await expect(page.getByRole("dialog",{name:"Tour of Vantage"})).toBeVisible();
  await page.getByRole("button",{name:"Skip",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Tour of Vantage"})).toHaveCount(0);
  await page.evaluate(()=>localStorage.removeItem("vantage.tour.v1")); await page.reload();
  await expect(page.getByRole("button",{name:"Edit Home — rearrange, add, or remove widgets",exact:true})).toBeVisible();
  await expect(page.getByRole("dialog",{name:"Tour of Vantage"})).toHaveCount(0);
  expect(claims).toBe(1);
  await page.goto(`/account?orgId=${orgId}`);
  await expect(page.getByRole("heading",{name:"Account",level:1})).toBeVisible();
  await expect(page.getByRole("button",{name:/Replay the tour/})).toHaveCount(0);
});

for (const motion of ["no-preference", "reduce"] as const) test(`dialogs release focus cleanly when closing with ${motion} motion`, async ({page, context}) => {
  await isolateUi(page, context); await page.emulateMedia({reducedMotion:motion});
  await page.goto(`/account?tab=appearance&orgId=${orgId}`);
  const trigger=page.getByRole("button",{name:"Reset Home to default",exact:true});
  await trigger.click(); const dialog=page.getByRole("dialog",{name:"Reset Home to default?",exact:true});
  await expect(dialog).toBeVisible(); await dialog.getByRole("button",{name:"Cancel",exact:true}).click();
  await expect(trigger).toBeFocused(); await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-closing="true"]')).toHaveCount(0);
  await trigger.click(); await expect(dialog).toBeVisible(); await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
});


test("direct robot lookup hydrates consistently and Teams follows browser history", async ({page,context}) => {
  await isolateUi(page,context);
  const errors:string[]=[]; page.on("pageerror",error=>errors.push(error.message));
  await page.goto(`/scout/teams?orgId=${orgId}&team=254`);
  const views=page.getByRole("tablist",{name:"Team view",exact:true});
  await expect(views.getByRole("tab",{name:"Team lookup",exact:true})).toHaveAttribute("aria-selected","true");
  await views.getByRole("tab",{name:"Our scouting",exact:true}).click();
  await expect(page).toHaveURL(/sub=scouting/);
  await page.reload();
  await expect(views.getByRole("tab",{name:"Our scouting",exact:true})).toHaveAttribute("aria-selected","true");
  await page.evaluate(() => { const url=new URL(location.href);url.searchParams.set("sub","lookup");history.pushState(null,"",url); });
  await expect(views.getByRole("tab",{name:"Team lookup",exact:true})).toHaveAttribute("aria-selected","true");
  await page.goBack();
  await expect(views.getByRole("tab",{name:"Our scouting",exact:true})).toHaveAttribute("aria-selected","true");
  expect(errors).toEqual([]);
});


test("legacy pick links open the one ranking and discussion workspace", async ({page,context}) => {
  await isolateUi(page,context);
  await page.goto(`/strategy?tab=picks&orgId=${orgId}`);
  await expect(page).toHaveURL(url=>url.pathname==="/competition" && url.searchParams.get("tab")==="picks" && url.searchParams.get("orgId")===orgId);
  await expect(page.getByRole("heading",{level:1,name:"Pick list",exact:true})).toBeVisible();
  await expect(page.getByTestId("pick-list-workspace")).toBeVisible();
  await expect(page.getByRole("button",{name:"Team discussion",exact:true})).toBeVisible();
});


for (const viewport of [{width:320,height:667},{width:844,height:390},{width:768,height:1024}]) test(`search destinations remain polished and reachable at ${viewport.width}x${viewport.height}`, async ({page,context}) => {
  await isolateUi(page,context); await page.setViewportSize(viewport);
  await page.route("**/api/search?**",route=>route.fulfill({json:{status:"ready",results:Array.from({length:8},(_,index)=>({title:`Scouting help ${index+1}`,subtitle:"Saved team data and scouting guidance",href:`/help?entry=${index+1}`,sourceLabel:"Help"}))}}));
  await page.goto(`/competition?tab=teams&orgId=${orgId}`);
  const opener=page.getByRole("button",{name:viewport.width<1100?"Menu and search":"Search pages, tools, and team data",exact:true});
  await opener.click();
  const panel=page.getByRole("complementary",{name:"Product navigation",exact:true});
  const search=panel.getByRole("combobox",{name:"Search pages, tools, and your team's data",exact:true});await search.fill("scouting");
  const results=panel.getByRole("listbox",{name:"Search results",exact:true});
  await expect(results.getByRole("option",{name:/Scouting help 8/})).toBeVisible();
  const reachable=(id:string)=>page.locator(id).evaluate(el=>{const rect=el.getBoundingClientRect();return rect.top>=0 && rect.bottom<=innerHeight && el.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2));});
  await search.press("ArrowUp");
  await expect.poll(async()=>reachable(`#${await search.getAttribute("aria-activedescendant")}`)).toBe(true);
  const last=results.getByRole("option").last();await last.focus();
  await expect.poll(()=>last.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})).toBe(true);
  expect(await results.getByRole("option").first().evaluate(el=>getComputedStyle(el).display)).toBe("grid");
  await accessible(page,".soft-drawer");
  await page.keyboard.press("Escape");await expect(opener).toBeFocused();
});
