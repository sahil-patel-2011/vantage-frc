import { describe, expect, it } from "vitest";
import { CONTEXT_ACTIONS, hubNavigationSections } from "./hub-navigation";
import { hubById, PRODUCT_HUBS } from "./hubs";
describe("task navigation",()=>{
 it("opens competition to collection and keeps six distinct event tasks",()=>{
   const hub=hubById("competition");expect(hub.defaultTab).toBe("scouting");
   expect(hubNavigationSections(hub,hub.tabs).map(entry=>entry.id)).toEqual(["scouting","teams","strategy","picks","command","match-checklist"]);
 });
 it("doesn't expose strategy or picks when their permission root is unavailable",()=>{
   const hub=hubById("competition");const allowed=hub.tabs.filter(tab=>tab.id!=="strategy"&&tab.group!=="strategy");
   expect(hubNavigationSections(hub,allowed).some(tab=>tab.id==="picks")).toBe(false);
 });
 it("keeps every workspace selector short and all contextual links registered",()=>{
   for(const hub of PRODUCT_HUBS){expect(hubNavigationSections(hub,hub.tabs).length).toBeLessThanOrEqual(6);}
   for(const [key,actions] of Object.entries(CONTEXT_ACTIONS)){
     const [id]=key.split(":");const hub=hubById(id as Parameters<typeof hubById>[0]);
     expect(actions.length).toBeLessThanOrEqual(3);
     for(const action of actions) expect(hub.tabs.some(tab=>tab.id===action.id),key+":"+action.id).toBe(true);
   }
 });
});
