import { describe, expect, it } from "vitest";
import { hubBarSections } from "./hub-bar";
import { hubNavigationSections } from "./hub-navigation";
import { hubById, PRODUCT_HUBS } from "./hubs";
describe("task navigation",()=>{
 it("opens competition to collection with six sections; forms and assignments live in More tools",()=>{
   const hub=hubById("competition");expect(hub.defaultTab).toBe("scouting");
   expect(hubNavigationSections(hub,hub.tabs).map(entry=>entry.id)).toEqual(["scouting","teams","strategy","picks","command","match-checklist"]);
 });
 it("doesn't expose strategy or picks when their permission root is unavailable",()=>{
   const hub=hubById("competition");const allowed=hub.tabs.filter(tab=>tab.id!=="strategy"&&tab.group!=="strategy");
   expect(hubNavigationSections(hub,allowed).some(tab=>tab.id==="picks")).toBe(false);
 });
 it("keeps every place to six sections at most",()=>{
   for(const hub of PRODUCT_HUBS){expect(hubNavigationSections(hub,hub.tabs).length,hub.id).toBeLessThanOrEqual(6);}
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
