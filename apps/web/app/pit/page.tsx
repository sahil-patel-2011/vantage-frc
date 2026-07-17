import type { Metadata } from "next";
import "./pit-command.css";
import PitCommandClient from "./pit-command-client";
export const metadata: Metadata = { title: "Pit Command — Vantage", description: "FRC robot release, battery health, maintenance, and issue tracking." };
export default async function PitCommandPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><span className="eyebrow">VANTAGE / PIT COMMAND</span><h1>Select a team workspace</h1><p>Pit Command keeps robot-release evidence private to one team workspace.</p><a className="text-button" href="/dashboard">Back to dashboard</a></main>;
  return <PitCommandClient orgId={orgId} />;
}
