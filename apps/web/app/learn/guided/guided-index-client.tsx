"use client";

import { useEffect, useState } from "react";

export type GuidedIndexGroup = {
  id: string;
  title: string;
  intro: string;
  numbered: boolean;
  tracks: Array<{ id: string; title: string; summary: string; steps: number; time: string; audience: string }>;
};

type Summary = { tracks: Record<string, number>; isLead: boolean };

function orgFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("orgId");
  } catch {
    return null;
  }
}

/**
 * The track list with the signed-in student's own progress on each card ("3 of 9 done"), and the
 * Team progress link only for the owners and admins it is for (A5-27). Before the progress loads,
 * or when it can't, the cards read exactly as they did.
 */
export function GuidedIndexClient({ groups }: { groups: GuidedIndexGroup[] }) {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    const org = orgFromUrl();
    let cancelled = false;
    void fetch(`/api/guided${org ? `?orgId=${encodeURIComponent(org)}` : ""}`, { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as Summary) : null))
      .then((data) => {
        if (!cancelled && data && typeof data.tracks === "object") setSummary(data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {summary?.isLead ? (
        <p className="guided-meta guided-lead-note">
          <a className="guided-team-link" href="/learn/guided/team">
            Team progress
          </a>{" "}
          shows every member&apos;s steps and the sign-offs waiting for you.
        </p>
      ) : null}
      {groups.map((group) =>
        group.tracks.length ? (
          <section key={group.id} className="guided-group" aria-labelledby={`guided-${group.id}`}>
            <h2 id={`guided-${group.id}`}>{group.title}</h2>
            <p>{group.intro}</p>
            <ol className="guided-track-list">
              {group.tracks.map((track, index) => {
                const done = Math.min(summary?.tracks[track.id] ?? 0, track.steps);
                return (
                  <li key={track.id}>
                    <a href={`/learn/guided/${track.id}`}>
                      <strong>
                        {group.numbered ? `${index + 1}. ` : ""}
                        {track.title}
                      </strong>
                      <span>{track.summary}</span>
                      <small>
                        {summary && done > 0
                          ? done === track.steps
                            ? `All ${track.steps} steps done`
                            : `${done} of ${track.steps} steps done`
                          : `${track.steps} steps`}{" "}
                        · {track.time} · {track.audience}
                      </small>
                    </a>
                  </li>
                );
              })}
            </ol>
          </section>
        ) : null,
      )}
    </>
  );
}
