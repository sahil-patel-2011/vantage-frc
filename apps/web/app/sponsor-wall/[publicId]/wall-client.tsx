"use client";

// Public, read-only sponsor thank-you wall (no session). Mirrors the /support/[publicId]
// storefront pattern: fetch the tokenized public API, render published data only, and show an
// honest unavailable state when the wall is unpublished or the token is wrong.
import { useEffect, useState } from "react";
import { sponsorWallTierLabel } from "../../../lib/sponsor-wall";
import type { SponsorWallTier } from "../../../lib/sponsor-wall/types";

type PublicWallEntry = {
  id: string;
  sponsorName: string;
  tier: SponsorWallTier;
  logoUrl: string | null;
  websiteUrl: string | null;
  message: string | null;
};

type PublicWall = {
  orgName: string;
  teamNumber: number | null;
  headline: string;
  subtitle: string | null;
  theme: "light" | "dark" | "team";
  entries: PublicWallEntry[];
};

export default function WallClient({ publicId }: { publicId: string }) {
  const [wall, setWall] = useState<PublicWall | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void fetch(`/api/sponsor-wall/${encodeURIComponent(publicId)}`)
      .then(async (response) => {
        const data = (await response.json()) as PublicWall | { error?: string };
        if (!response.ok || !("entries" in data)) {
          throw new Error("error" in data && data.error ? data.error : "This sponsor wall is unavailable.");
        }
        setWall(data);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "This sponsor wall is unavailable."));
  }, [publicId]);

  if (error && !wall) {
    return (
      <main className="public-wall public-wall-light">
        <section className="public-wall-state">
          <span>Sponsor wall</span>
          <h1>That sponsor wall is unavailable.</h1>
          <p>{error}</p>
        </section>
      </main>
    );
  }

  if (!wall) {
    return (
      <main className="public-wall public-wall-light">
        <section className="public-wall-state">
          <p>Loading sponsor wall…</p>
        </section>
      </main>
    );
  }

  const teamLabel = wall.teamNumber ? `FRC Team ${wall.teamNumber}` : wall.orgName;

  return (
    <main className={`public-wall public-wall-${wall.theme}`}>
      <header className="public-wall-hero">
        <p className="public-wall-eyebrow">{teamLabel}</p>
        <h1>{wall.headline}</h1>
        {wall.subtitle ? <p className="public-wall-subtitle">{wall.subtitle}</p> : null}
      </header>
      {wall.entries.length === 0 ? (
        <section className="public-wall-state">
          <p>Sponsor recognitions are on the way — check back soon.</p>
        </section>
      ) : (
        <section className="public-wall-grid" aria-label="Sponsors">
          {wall.entries.map((entry) => (
            <article key={entry.id} className="public-wall-card">
              <span className="public-wall-tier">{sponsorWallTierLabel(entry.tier)}</span>
              {entry.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={entry.logoUrl} alt={`${entry.sponsorName} logo`} />
              ) : null}
              <strong>
                {entry.websiteUrl ? (
                  <a href={entry.websiteUrl} target="_blank" rel="noopener noreferrer">
                    {entry.sponsorName}
                  </a>
                ) : (
                  entry.sponsorName
                )}
              </strong>
              {entry.message ? <p>{entry.message}</p> : null}
            </article>
          ))}
        </section>
      )}
      <footer className="public-wall-footer">
        <p>Thank you for supporting {teamLabel}.</p>
      </footer>
    </main>
  );
}
