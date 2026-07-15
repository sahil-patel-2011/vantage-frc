import { describe,expect,it } from "vitest";
import { strToU8,zipSync } from "fflate";
import { csvHeader,csvRow,createExportRegistry,inspectExportManifest } from "../src";
describe("secure CSV exports",()=>{
 it("uses RFC 4180 quoting and neutralizes spreadsheet formulas",()=>{
  expect(csvHeader(["name","notes"],true)).toBe('\uFEFF"name","notes"\r\n');
  expect(csvRow(["name","notes"],{name:"Alpha, Beta",notes:'=HYPERLINK("bad")'})).toBe('"Alpha, Beta","\'=HYPERLINK(""bad"")"\r\n');
 });
 it("registers only explicit redacted domains",()=>{
  const text=JSON.stringify([...createExportRegistry().values()].map(item=>({id:item.id,columns:item.columns})));
  for(const secret of["api_key","token_hash","password","encrypted_secret","mfa","otp","session_token","display_token"])expect(text).not.toContain(secret);
 });
 it("reads a versioned ZIP manifest",()=>{
  const manifest={format:"Vantage Team Data Export",version:1,files:[]};
  expect(inspectExportManifest(zipSync({"manifest.json":strToU8(JSON.stringify(manifest))}))).toEqual(manifest);
 });
});
