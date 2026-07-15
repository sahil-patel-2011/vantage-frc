import { createRequire } from "node:module";
import { chmod,mkdir,readFile,rm,writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
const require=createRequire(import.meta.url),service="vantage-cad",account="device-token",fallback=join(homedir(),".vantage-cad","credentials.json");
type Keytar={getPassword(service:string,account:string):Promise<string|null>;setPassword(service:string,account:string,value:string):Promise<void>;deletePassword(service:string,account:string):Promise<boolean>};
function keytar():Keytar|null{try{return require("keytar") as Keytar;}catch{return null;}}
export async function saveDeviceCredential(value:Record<string,string>){const serialized=JSON.stringify(value),native=keytar();if(native){await native.setPassword(service,account,serialized);return"OS credential storage";}await mkdir(join(homedir(),".vantage-cad"),{recursive:true});await writeFile(fallback,serialized,{encoding:"utf8",mode:0o600});await chmod(fallback,0o600);return"permission-restricted local file (install optional keytar for OS credential storage)";}
export async function loadDeviceCredential(){const native=keytar(),value=native?await native.getPassword(service,account):await readFile(fallback,"utf8").catch(()=>null);return value?JSON.parse(value) as Record<string,string>:null;}
export async function clearDeviceCredential(){const native=keytar();if(native)await native.deletePassword(service,account);await rm(fallback,{force:true});}
export function credentialStorageStatus(){return keytar()?"OS credential storage available":"OS credential helper unavailable; 0600 fallback will be used";}
