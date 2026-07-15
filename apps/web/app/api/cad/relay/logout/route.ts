import { createHash } from "node:crypto";
import { getCadRelayPool } from "@vantage/db/cad-relay";
export async function POST(request:Request){const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");if(!token)return Response.json({error:"Device token required"},{status:401});await getCadRelayPool().query(`UPDATE cad_relay_devices SET revoked_at=now(),status='revoked',updated_at=now() WHERE token_hash=$1`,[createHash("sha256").update(token).digest("hex")]);return Response.json({success:true});}
