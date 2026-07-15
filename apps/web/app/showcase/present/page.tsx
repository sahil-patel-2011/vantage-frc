import ShowcasePresentation from "./presentation-client";
export default async function PresentPage({searchParams}:{searchParams:Promise<{token?:string;orgId?:string;deckId?:string}>}){return<ShowcasePresentation params={await searchParams}/>;}
