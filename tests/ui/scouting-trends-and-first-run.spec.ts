import { expect, test } from "@playwright/test";
import { accessible, isolateUi, orgId, userId } from "./fixture";

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
