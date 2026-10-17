"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/ui";
import { friendlyErrorMessage } from "../../../lib/ui/friendly-error";

type Result = { state: "in" | "out"; clockIn: string; clockOut: string | null };

function timeOf(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function duration(from: string, to: string) {
  const minutes = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/**
 * Where the door QR lands: checks the signed-in member in, or out if they were in, once, as soon
 * as the page opens, and says which in big words.
 */
export default function CheckinClient() {
  const [result, setResult] = useState<Result | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [orgId, setOrgId] = useState("");
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const params = new URLSearchParams(window.location.search);
    const org = params.get("orgId") ?? "";
    setOrgId(org);
    void (async () => {
      try {
        const response = await fetch("/api/hours/door", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId: org, w: params.get("w"), s: params.get("s") }),
        });
        const data = (await response.json().catch(() => ({}))) as Result & { error?: string };
        if (!response.ok) {
          setProblem(data.error ?? "Check-in didn't go through.");
          return;
        }
        setResult(data);
        // The code is single-use from here: drop it from the address so a refresh doesn't toggle again.
        window.history.replaceState({}, "", `/hours?orgId=${encodeURIComponent(org)}`);
      } catch (error) {
        setProblem(friendlyErrorMessage(error, "Check-in didn't go through."));
      }
    })();
  }, []);

  return (
    <main className="module-page door-page">
      {result ? (
        <div className={`checkin-result is-${result.state}`} role="status">
          <strong>{result.state === "in" ? "You're checked in" : "You're checked out"}</strong>
          <p className="app-muted">
            {result.state === "in"
              ? `At ${timeOf(result.clockIn)}. Scan the door code again when you leave.`
              : `At ${timeOf(result.clockOut)}, after ${duration(result.clockIn, result.clockOut!)}.`}
          </p>
          <Button as="a" variant="secondary" href={orgId ? `/hours?orgId=${encodeURIComponent(orgId)}` : "/hours"}>
            See your hours
          </Button>
        </div>
      ) : problem ? (
        <div className="checkin-result" role="alert">
          <strong>Not checked in</strong>
          <p>{problem}</p>
        </div>
      ) : (
        <p className="app-muted" role="status">Checking you in…</p>
      )}
    </main>
  );
}
