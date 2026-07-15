import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { downloadExport } from "@vantage/export-center";
import { headers } from "next/headers";
export async function GET(request:Request){try{const session=await auth.api.getSession({headers:await headers()});if(!session)return Response.json({error:"Authentication required"},{status:401});const token=new URL(request.url).searchParams.get("token");if(!token)throw new Error("Download token is required");const archive=await withRls({userId:session.user.id},client=>downloadExport(client,token));return new Response(archive,{headers:{"content-type":"application/zip","content-disposition":`attachment; filename="vantage-team-export-${new Date().toISOString().slice(0,10)}.zip"`,"cache-control":"private, no-store"}});}catch(error){return Response.json({error:error instanceof Error?error.message:"Export download failed"},{status:400});}}
