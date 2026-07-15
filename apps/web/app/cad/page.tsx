import CadWorkspace from "./cad-client";
export default async function CadPage({searchParams}:{searchParams:Promise<{orgId?:string}>}){const{orgId}=await searchParams;if(!orgId)return<main className="content"><h1>Select an organization</h1></main>;return<CadWorkspace orgId={orgId}/>;}
