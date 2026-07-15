import DisplaySetup from "./setup-client";
export default async function DisplayPage({searchParams}:{searchParams:Promise<{orgId?:string}>}){const{orgId}=await searchParams;if(!orgId)return<main className="content"><h1>Select an organization</h1></main>;return<DisplaySetup orgId={orgId}/>;}
