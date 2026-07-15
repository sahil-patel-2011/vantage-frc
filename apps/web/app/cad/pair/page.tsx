import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import PairClient from "./pair-client";
export default async function PairPage({searchParams}:{searchParams:Promise<{code?:string}>}){const session=await auth.api.getSession({headers:await headers()});if(!session)redirect(`/signin?next=%2Fcad%2Fpair`);const orgs=await withRls({userId:session.user.id},async client=>(await client.query<{id:string;name:string;role:string}>(`SELECT o.id,o.name,m.role FROM memberships m JOIN organizations o ON o.id=m.org_id WHERE m.user_id=$1 ORDER BY o.name`,[session.user.id])).rows);return<PairClient initialCode={(await searchParams).code??""} organizations={orgs}/>;}
