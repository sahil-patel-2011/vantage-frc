import { beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({session:null as {user:{id:string}}|null,seen:false,query:vi.fn()}));
vi.mock("next/headers",()=>({headers:async()=>new Headers()}));
vi.mock("@vantage/core",()=>({auth:{api:{getSession:async()=>state.session}}}));
vi.mock("@vantage/db",()=>({withRls:async (_context:unknown,work:(client:unknown)=>Promise<unknown>)=>work({query:state.query})}));
const {POST}=await import("../../app/api/account/tour/route");
const request=()=>new Request("https://vantage.test/api/account/tour",{method:"POST",headers:{"content-type":"application/json",origin:"https://vantage.test"},body:"{}"});
beforeEach(()=>{state.seen=false;state.session={user:{id:"user-a"}};state.query.mockReset().mockImplementation(async()=>{if(state.seen)return {rowCount:0,rows:[]};state.seen=true;return {rowCount:1,rows:[{user_id:"user-a"}]};});});
it("claims before first display and refuses concurrent browser replays",async()=>{
  const results=await Promise.all([POST(request()),POST(request()),POST(request())]);
  expect(await Promise.all(results.map(response=>response.json()))).toEqual([{start:true},{start:false},{start:false}]);
  expect(state.query.mock.calls[0]).toEqual([expect.stringContaining("app_tour_seen_at IS NULL AND onboarding_completed_at IS NOT NULL"),["user-a"]]);
});
it("requires sign-in without touching persistence",async()=>{state.session=null;expect((await POST(request())).status).toBe(401);expect(state.query).not.toHaveBeenCalled();});
it("rejects cross-origin requests and unknown fields",async()=>{
  const bad=new Request("https://vantage.test/api/account/tour",{method:"POST",headers:{"content-type":"application/json",origin:"https://other.test"},body:"{}"});
  expect((await POST(bad)).status).toBe(403);expect(state.query).not.toHaveBeenCalled();
});
