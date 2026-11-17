import { describe, expect, it } from "vitest";
import { hubBarSections } from "./hub-bar";
import { hubNavigationSections } from "./hub-navigation";
import { hubById, PRODUCT_HUBS } from "./hubs";
describe("task navigation",()=>{
 it("opens competition to collection with three sections; the rest live in More tools",()=>{
   const hub=hubById("competition");expect(hub.defaultTab).toBe("scouting");
   expect(hubNavigationSections(hub,hub.tabs).map(entry=>entry.id)).toEqual(["scouting","strategy","command"]);
   const team=hubById("team");
   expect(hubNavigationSections(team,team.tabs).map(entry=>entry.label)).toEqual(["Calendar","Chat","People","Tasks"]);
   const business=hubById("business");
   expect(hubNavigationSections(business,business.tabs).map(entry=>entry.label)).toEqual(["Overview","Money","Sponsors"]);
 });
 it("doesn't expose strategy or picks when their permission root is unavailable",()=>{
   const hub=hubById("competition");const allowed=hub.tabs.filter(tab=>tab.id!=="strategy"&&tab.group!=="strategy");
   expect(hubNavigationSections(hub,allowed).some(tab=>tab.id==="picks")).toBe(false);
 });
 it("keeps every place to four sections at most",()=>{
   for(const hub of PRODUCT_HUBS.filter(entry=>!entry.hidden)){expect(hubNavigationSections(hub,hub.tabs).length,hub.id).toBeLessThanOrEqual(4);}
 });
 it("leaves a pinned app off the page bar, and keeps the section you are on", () => {
   const sections = [
     { id: "scouting" }, { id: "forms" }, { id: "teams" }, { id: "strategy" }, { id: "command" },
   ];
   const pins = ["/competition?tab=scouting", "/competition?tab=teams", "/competition?tab=strategy"];
   expect(hubBarSections("/competition", sections, pins, "scouting").map((section) => section.id)).toEqual([
     "scouting", "forms", "command",
   ]);
   expect(hubBarSections("/competition", sections, pins, "teams").map((section) => section.id)).toEqual([
     "forms", "teams", "command",
   ]);
 });
 it("does not grant forms or assignments when the scouting workspace is denied",()=>{
   const hub=hubById("competition");const allowed=hub.tabs.filter(tab=>tab.id!=="scouting");
   expect(hubNavigationSections(hub,allowed).some(tab=>tab.id==="forms"||tab.id==="scout-coverage-live")).toBe(false);
 });
});
