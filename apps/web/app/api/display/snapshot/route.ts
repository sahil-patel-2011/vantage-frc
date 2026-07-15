import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { getDisplayPool } from "@vantage/db/display";
import { headers } from "next/headers";

export async function GET(request:Request){try{const url=new URL(request.url);const token=url.searchParams.get("token");if(token){const result=await getDisplayPool().query<{snapshot:unknown}>('SELECT get_display_snapshot($1) AS snapshot',[token]);return Response.json(result.rows[0]?.snapshot??null);}
  const session=await auth.api.getSession({headers:await headers()});const orgId=url.searchParams.get("orgId");const boardId=url.searchParams.get("boardId");if(!session||!orgId||!boardId)return Response.json({error:"Authentication, orgId, and boardId are required"},{status:401});
  const snapshot=await withRls({userId:session.user.id,orgId},async(client)=>{
    const result=await client.query(`SELECT jsonb_build_object(
      'board',jsonb_build_object('id',b.id,'name',b.name,'preset',b.preset,'widgets',b.widgets),
      'organization',jsonb_build_object('name',o.name,'teamNumber',o.team_number),
      'activeEvent',jsonb_build_object('eventKey',c.active_event_key,'name',e.name),
      'nextMatch',(SELECT jsonb_build_object('matchKey',m.match_key,'compLevel',m.comp_level,'matchNumber',m.match_number,
       'scheduledTime',COALESCE(m.predicted_time,m.event_time),'redAlliance',m.red_alliance,'blueAlliance',m.blue_alliance)
       FROM matches_ref m WHERE m.event_key=c.active_event_key AND COALESCE(m.actual_time,m.predicted_time,m.event_time)>now()
       ORDER BY COALESCE(m.actual_time,m.predicted_time,m.event_time) LIMIT 1),
      'scouting',jsonb_build_object('assignments',(SELECT count(*) FROM scout_assignments a WHERE a.org_id=o.id AND a.event_key=c.active_event_key),
       'reports',(SELECT count(*) FROM match_scout_entries s WHERE s.org_id=o.id AND s.event_key=c.active_event_key),
       'openDisagreements',(SELECT count(*) FROM scout_disagreements d WHERE d.org_id=o.id AND d.event_key=c.active_event_key AND d.status='open')),
      'updatedAt',now()) AS snapshot FROM display_boards b JOIN organizations o ON o.id=b.org_id
      LEFT JOIN org_active_context c ON c.org_id=o.id LEFT JOIN events_ref e ON e.event_key=c.active_event_key
      WHERE b.id=$1 AND b.org_id=$2`,[boardId,orgId]);return result.rows[0]?.snapshot??null;
  });return Response.json(snapshot);}catch(error){return Response.json({error:error instanceof Error?error.message:"Display unavailable"},{status:400});}}
