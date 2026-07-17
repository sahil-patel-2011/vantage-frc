import { describe,expect,it } from "vitest";
import { browserCommand,fusionAddinPaths,validatePluginEndpoint } from "../src/platform";
import { providerPolicy } from "../src/provider";
describe("desktop CAD onboarding safety",()=>{
 it("uses fixed browser executables without shell strings",()=>{
  const command=browserCommand("https://vantage.example/cad/pair?code=A%26calc","win32");
  expect(command.command).toBe("explorer.exe");expect(command.args).toHaveLength(1);expect(()=>browserCommand("file:///etc/passwd","linux")).toThrow("HTTP");
 });
 it("accepts only loopback Fusion plugin endpoints",()=>{
  expect(validatePluginEndpoint("http://127.0.0.1:32145").port).toBe("32145");
  expect(()=>validatePluginEndpoint("https://evil.example")).toThrow("loopback");
  expect(()=>validatePluginEndpoint("http://192.168.1.2:32145")).toThrow("loopback");
  expect(fusionAddinPaths("darwin","/Users/test")[0]).toContain("Autodesk Fusion 360");
  expect(fusionAddinPaths("linux","/home/test")).toEqual([]);
 });
 it("distinguishes provider billing and restricts Claude Code",()=>{
  expect(providerPolicy("managed",{platformAdmin:false,matchingDevice:false,privateSession:false,interactive:false,explicitOptIn:false}).billingSource).toContain("Vantage");
  expect(()=>providerPolicy("claude_code_personal",{platformAdmin:true,matchingDevice:false,privateSession:true,interactive:true,explicitOptIn:true})).toThrow("personal local");
  expect(providerPolicy("personal_byok",{platformAdmin:false,matchingDevice:true,privateSession:true,interactive:true,explicitOptIn:true}).consumerSubscriptionIsApiCredential).toBe(false);
 });
});
