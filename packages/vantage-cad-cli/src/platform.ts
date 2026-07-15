import { access } from "node:fs/promises";
import { homedir,platform as osPlatform } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
export function browserCommand(url:string,platform=osPlatform()){const parsed=new URL(url);if(!["http:","https:"].includes(parsed.protocol))throw new Error("Only HTTP(S) onboarding URLs may be opened");if(platform==="win32")return{command:"explorer.exe",args:[parsed.toString()]};if(platform==="darwin")return{command:"open",args:[parsed.toString()]};return{command:"xdg-open",args:[parsed.toString()]};}
export async function openBrowser(url:string){const value=browserCommand(url),child=spawn(value.command,value.args,{detached:true,stdio:"ignore",shell:false});child.unref();}
export function fusionAddinPaths(platform=osPlatform(),home=homedir()){if(platform==="win32")return[join(process.env.APPDATA??join(home,"AppData","Roaming"),"Autodesk","Autodesk Fusion 360","API","AddIns")];if(platform==="darwin")return[join(home,"Library","Application Support","Autodesk","Autodesk Fusion 360","API","AddIns")];return[];}
export async function detectFusionPrerequisites(){const paths=fusionAddinPaths(),existing:string[]=[];for(const path of paths)if(await access(path).then(()=>true).catch(()=>false))existing.push(path);return{supported:osPlatform()==="win32"||osPlatform()==="darwin",paths,existing};}
export function validatePluginEndpoint(value:string){const url=new URL(value);if(url.protocol!=="http:"||!["127.0.0.1","localhost","::1"].includes(url.hostname))throw new Error("Fusion plugin endpoint must be loopback HTTP");return url;}
