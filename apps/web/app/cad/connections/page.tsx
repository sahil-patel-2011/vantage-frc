import CadConnections from "./connections-client";
export default async function CadConnectionsPage({searchParams}:{searchParams:Promise<{orgId?:string}>}){const{orgId}=await searchParams;if(!orgId)return<main className="content"><h1>Select an organization</h1></main>;return<CadConnections orgId={orgId}/>;}
