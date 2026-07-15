import ShowcaseClient from "./showcase-client";
export default async function ShowcasePage({searchParams}:{searchParams:Promise<{orgId?:string}>}){const{orgId}=await searchParams;if(!orgId)return<main className="content"><h1>Select an organization</h1></main>;return<ShowcaseClient orgId={orgId}/>;}
