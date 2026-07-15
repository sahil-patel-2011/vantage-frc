import { createHash, randomBytes } from "node:crypto";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

const presets = ["next_match","win_prediction","robot_readiness","event_command","scouting_coverage","custom"];
const widgetTypes = ["next_match","prediction","strategy","robot_readiness","event_status","scouting_coverage","alerts","team_intel"];
async function current(){const value=await auth.api.getSession({headers:await headers()});if(!value)throw new Error("Authentication required");return value;}
const fail=(error:unknown)=>Response.json({error:error instanceof Error?error.message:"Display request failed"},{status:400});

export async function GET(request:Request){try{const session=await current();const orgId=new URL(request.url).searchParams.get("orgId");if(!orgId)throw new Error("orgId is required");const data=await withRls({userId:session.user.id,orgId},async(client)=>({
  boards:(await client.query(`SELECT id,name,preset,widgets,updated_at AS "updatedAt" FROM display_boards WHERE org_id=$1 ORDER BY name`,[orgId])).rows,
  tokens:(await client.query(`SELECT id,board_id AS "boardId",label,expires_at AS "expiresAt",revoked_at AS "revokedAt",last_used_at AS "lastUsedAt" FROM display_tokens WHERE org_id=$1 ORDER BY created_at DESC`,[orgId])).rows,
}));return Response.json(data);}catch(error){return fail(error);}}

export async function POST(request:Request){try{const session=await current();const body=await request.json() as Record<string,unknown>;const orgId=String(body.orgId??"");if(!orgId)throw new Error("orgId is required");
  const result=await withRls({userId:session.user.id,orgId},async(client)=>{
    const admin=await client.query(`SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,[orgId,session.user.id]);if(!admin.rowCount)throw new Error("Organization administrator access required");
    if(body.action==="token"){const token=randomBytes(32).toString("base64url");const hash=createHash("sha256").update(token).digest("hex");const row=await client.query<{id:string}>(`INSERT INTO display_tokens(org_id,board_id,token_hash,label,created_by,expires_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[orgId,body.boardId,hash,String(body.label??"Pit TV"),session.user.id,body.expiresAt??null]);return{id:row.rows[0]!.id,token};}
    if(!presets.includes(String(body.preset)))throw new Error("Invalid display preset");const widgets=Array.isArray(body.widgets)?body.widgets:[];if(widgets.some((widget)=>!widget||typeof widget!=="object"||!widgetTypes.includes(String((widget as Record<string,unknown>).type))))throw new Error("Invalid display widget");
    const row=await client.query<{id:string}>(`INSERT INTO display_boards(id,org_id,name,preset,widgets,created_by) VALUES(COALESCE($1::uuid,gen_random_uuid()),$2,$3,$4,$5::jsonb,$6) ON CONFLICT(id) DO UPDATE SET name=excluded.name,preset=excluded.preset,widgets=excluded.widgets,updated_at=now() RETURNING id`,[body.id??null,orgId,String(body.name??"").trim(),body.preset,JSON.stringify(widgets),session.user.id]);return{id:row.rows[0]!.id};
  });return Response.json(result,{status:201});}catch(error){return fail(error);}}

export async function PATCH(request:Request){try{const session=await current();const body=await request.json() as {orgId?:string;tokenId?:string};if(!body.orgId||!body.tokenId)throw new Error("Invalid token action");await withRls({userId:session.user.id,orgId:body.orgId},client=>client.query("UPDATE display_tokens SET revoked_at=now() WHERE id=$1 AND org_id=$2",[body.tokenId,body.orgId]));return Response.json({success:true});}catch(error){return fail(error);}}
