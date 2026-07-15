import KioskClient from "./kiosk-client";
export default async function KioskPage({searchParams}:{searchParams:Promise<{orgId?:string;boardId?:string;token?:string}>}){return<KioskClient params={await searchParams}/>;}
