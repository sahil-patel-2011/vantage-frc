"use client";

import { useEffect, useState } from "react";
import { MarketingDesktopWebLink } from "../../components/marketing/site-header";

type Platform = "mac" | "windows" | "other";

function detectPlatform(): Platform {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const hint = `${nav.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  if (/mac|iphone|ipad/.test(hint)) return "mac";
  if (/win/.test(hint)) return "windows";
  return "other";
}

/**
 * One download button for the computer you are on, the other one beside it. The server
 * cannot know which computer that is, so the first paint shows both as equals and the
 * matching one becomes the primary the moment the page runs.
 */
export function DesktopDownloads({ windowsUrl, macUrl }: { windowsUrl: string | null; macUrl: string | null }) {
  const [platform, setPlatform] = useState<Platform>("other");
  useEffect(() => setPlatform(detectPlatform()), []);
  const buttons = [
    windowsUrl ? { key: "windows" as const, href: windowsUrl, label: "Download for Windows" } : null,
    macUrl ? { key: "mac" as const, href: macUrl, label: "Download for Mac" } : null,
  ].filter((button): button is { key: "windows" | "mac"; href: string; label: string } => Boolean(button));
  const ordered = [...buttons].sort((a, b) => Number(b.key === platform) - Number(a.key === platform));
  const primary = ordered.find((button) => button.key === platform) ?? null;
  return (
    <div className="actions">
      {ordered.map((button) => (
        <a key={button.key} className={`button ${button === primary || (!primary && buttons.length === 1) ? "primary" : "secondary"}`} href={button.href} download>
          {button.label}
        </a>
      ))}
      <MarketingDesktopWebLink primary={buttons.length === 0} />
    </div>
  );
}
