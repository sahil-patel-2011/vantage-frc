import { getShowcasePool } from "@vantage/db/showcase";
import { publicErrorMessage } from "../../../../lib/security/public-error";
export async function GET(request:Request){try{const token=new URL(request.url).searchParams.get("token");if(!token)throw new Error("Showcase token is required");const result=await getShowcasePool().query<{snapshot:unknown}>(`SELECT get_showcase_snapshot($1) AS snapshot`,[token]);return Response.json(result.rows[0]?.snapshot??null);}catch(error){return Response.json({error:publicErrorMessage(error,"Showcase unavailable")},{status:400});}}
