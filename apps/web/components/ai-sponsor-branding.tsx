"use client";

import { useEffect, useState } from "react";
import "./ai-sponsor-branding.css";

type ActiveBrand = {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  tier: string;
  aiCoverage: string;
  brandTagline: string | null;
};

/**
 * Soft name/logo treatment for active platform AI sponsors.
 * Degrades to nothing when none are active — never DEMO partners.
 */
export function AiSponsorBranding({ className }: { className?: string }) {
  const [sponsors, setSponsors] = useState<ActiveBrand[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/platform-sponsors")
      .then(async (response) => {
        const data = (await response.json()) as { sponsors?: ActiveBrand[] };
        if (!cancelled) setSponsors(Array.isArray(data.sponsors) ? data.sponsors : []);
      })
      .catch(() => {
        if (!cancelled) setSponsors([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!sponsors || sponsors.length === 0) return null;

  return (
    <aside
      className={`ai-sponsor-branding${className ? ` ${className}` : ""}`}
      aria-label="AI partners"
    >
      <span className="ai-sponsor-branding__eyebrow">With</span>
      <ul className="ai-sponsor-branding__list">
        {sponsors.map((sponsor) => {
          const inner = (
            <>
              {sponsor.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote partner logos; URLs are https-only from admin
                <img src={sponsor.logoUrl} alt="" className="ai-sponsor-branding__logo" />
              ) : null}
              <span className="ai-sponsor-branding__name">{sponsor.name}</span>
              {sponsor.brandTagline ? (
                <span className="ai-sponsor-branding__tag">{sponsor.brandTagline}</span>
              ) : null}
            </>
          );
          return (
            <li key={sponsor.id} className="ai-sponsor-branding__item">
              {sponsor.websiteUrl ? (
                <a href={sponsor.websiteUrl} target="_blank" rel="noreferrer noopener">
                  {inner}
                </a>
              ) : (
                <span className="ai-sponsor-branding__static">{inner}</span>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
