import SecurityClient from "./security-client";
export default async function SecurityPage({searchParams}:{searchParams:Promise<{orgId?:string;stepup?:string;returnTo?:string}>}){const params=await searchParams;return<SecurityClient orgId={params.orgId} stepUp={params.stepup==="1"} returnTo={params.returnTo}/>;}
