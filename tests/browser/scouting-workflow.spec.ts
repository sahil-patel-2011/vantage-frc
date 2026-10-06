import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { signInAs } from "./session";
import { actionHistory, type SyncEntry } from "@vantage/scouting";
const orgId="6925a000-0000-4000-8000-000000000001";
test.use({actionTimeout:15000});
for(const offline of [false,true]) test(`phase scouting, undo, review and ${offline?"offline recovery":"real API save"}`,async({page,context},info)=>{
 test.setTimeout(180000);expect(await signInAs(context,"owner")).toBe(true);
 await page.setViewportSize({width:offline?390:1440,height:900});
 const response=await page.request.get(`/api/scouting/bootstrap?orgId=${orgId}`);expect(response.status()).toBe(200);
 const data=await response.json();expect(data.eventKey).toBeTruthy();expect(data.matches.length).toBeGreaterThan(0);
 const connectionString=process.env.DATABASE_ADMIN_URL!;expect(new URL(connectionString).hostname).toBe("127.0.0.1");expect(new URL(connectionString).pathname).toMatch(/test|ci/i);
 const pool=new Pool({connectionString,ssl:false});
 const marker=`${offline?"Offline":"Online"} workflow ${randomUUID()}`;
 let submitted: { entries: SyncEntry[] } | undefined;
 try {
 const prior=await pool.query("SELECT match_key FROM match_scout_entries WHERE org_id=$1 AND event_key=$2 AND team_key=$3 AND scout_user_id=$4",[orgId,data.eventKey,"frc254",data.scoutIdentity.userId]);
 const match=data.matches.find((candidate:{matchKey:string})=>!prior.rows.some(row=>row.match_key===candidate.matchKey));
 expect(match,"The fixture needs a match without this owner's 254 report").toBeTruthy();
 const bootstrap={...data,assignments:[],recentEntries:[],myEntries:[],scouted:[],matches:[{...match,actualTime:null,postResultTime:null,winningAlliance:null,predictedTime:new Date(Date.now()+600000).toISOString(),redAlliance:{teamKeys:["frc254","frc118","frc6925"]},blueAlliance:{teamKeys:["frc1114","frc2056","frc971"]}}]};
 await page.route("**/api/scouting/bootstrap?**",route=>route.fulfill({json:bootstrap}));
 await page.goto(`/competition?orgId=${orgId}`);
 const auto=page.getByLabel("Auto points",{exact:true});await expect(auto).toBeVisible({timeout:60000});
 await page.emulateMedia({reducedMotion:"reduce"});
 await page.clock.install({time:new Date()});
 const phase=page.getByRole("tablist",{name:"Match form section",exact:true});
 await page.getByRole("button",{name:"Start match timer when auto starts",exact:true}).click();
 await expect(phase.getByRole("tab",{name:"Auto",exact:true})).toHaveAttribute("aria-selected","true");await expect(page.getByLabel("Teleop cycles",{exact:true})).toHaveCount(0);
 await page.screenshot({path:info.outputPath(offline?"scout-auto-phone.png":"scout-auto-desktop.png")});
 await auto.fill("7");await page.getByRole("button",{name:"Undo last action",exact:true}).click();await expect(auto).toHaveValue("");
 await auto.fill("7");
 await page.clock.fastForward(24000);await expect(phase.getByRole("tab",{name:"Teleop",exact:true})).toHaveAttribute("aria-selected","true");await expect(auto).toHaveCount(0);
 await page.getByLabel("Teleop cycles",{exact:true}).fill("8");
 await page.clock.fastForward(110000);await expect(phase.getByRole("tab",{name:"Endgame",exact:true})).toHaveAttribute("aria-selected","true");
 await phase.getByRole("tab",{name:"Review",exact:true}).click();await expect(auto).toHaveValue("7");await expect(page.getByLabel("Teleop cycles",{exact:true})).toHaveValue("8");
 await page.getByLabel("Robot's points",{exact:true}).fill("47");
 await page.getByLabel("Notes",{exact:true}).fill(marker);
 await page.clock.fastForward(30000);await expect(phase.getByRole("tab",{name:"Review",exact:true})).toHaveAttribute("aria-selected","true");
 const audit=await new AxeBuilder({page}).include(".scout-context-bar").analyze();expect(audit.violations).toEqual([]);
 await page.screenshot({path:info.outputPath(offline?"scout-review-offline.png":"scout-review-online.png")});
 let blockSync=offline;
 await page.route("**/api/scouting/sync",route=>blockSync?route.abort():route.continue());
 page.on("request",request=>{if(request.method()==="POST"&&new URL(request.url()).pathname==="/api/scouting/sync")submitted=request.postDataJSON();});
 if(offline) await context.setOffline(true);
 await page.locator(".scout-save-button").click();
 await expect(page.locator("#scout-save-confirmation")).toContainText("Saved 254");
 if(offline){
  await expect(page.locator("#scout-save-confirmation")).toContainText("Kept on this phone");
  await expect(page.locator(".scout-sync-pill")).toContainText("1 queued");
  await context.setOffline(false);
  await page.reload();await expect(page.locator(".scout-sync-pill")).toContainText("1 queued",{timeout:30000});
  await context.setOffline(true);
  await expect(page.locator(".scout-sync-pill")).toContainText("Offline");
  blockSync=false;
  // Reconnection may drain the queue before a manual Sync button can be clicked.
  await context.setOffline(false);
 }
 await page.clock.resume();
 await expect.poll(()=>submitted?.entries?.[0]?.clientId,{timeout:30000}).toBeTruthy();
 if (!submitted?.entries[0]) throw new Error("Scouting did not submit an entry.");
 const entry=submitted.entries[0];expect(entry.payload.autoPoints).toBe(7);expect(entry.payload.teleopCycles).toBe(8);
 expect(actionHistory(entry.payload)?.events.some(event=>event.undoOf)).toBe(true);
  await expect.poll(async()=>{const rows=await pool.query("SELECT payload FROM match_scout_entries WHERE org_id=$1 AND client_id=$2",[orgId,entry.clientId]);return rows.rows[0]?.payload?.autoPoints;},{timeout:30000}).toBe(7);
  const teamView=await page.request.get(`/api/scouting/teams?orgId=${orgId}`);expect(teamView.status()).toBe(200);expect(JSON.stringify(await teamView.json())).toContain("frc254");
  await expect(page.locator(".scout-sync-pill")).toContainText("0 queued",{timeout:30000});
 } finally {
  await context.setOffline(false);
  await pool.query("DELETE FROM scout_sync_receipts WHERE org_id=$1 AND server_entry_id IN (SELECT id FROM match_scout_entries WHERE org_id=$1 AND payload->>'notes'=$2)",[orgId,marker]);
  await pool.query("DELETE FROM match_scout_entries WHERE org_id=$1 AND payload->>'notes'=$2",[orgId,marker]);
  await pool.end();
 }
});
