"use client";

import { useEffect, useState } from "react";
import { MarketingDesktopWebLink } from "../../components/marketing/site-header";

type Platform = "mac" | "windows" | "other";
type MacChip = "arm64" | "x64";

export type MacDownloads = {
  /** One universal disk image, built on a Mac. Wins over the per-chip zips when both exist. */
  dmg: string | null;
  arm64: string | null;
  x64: string | null;
};

function detectPlatform(): Platform {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const hint = `${nav.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent}`.toLowerCase();
  if (/mac|iphone|ipad/.test(hint)) return "mac";
  if (/win/.test(hint)) return "windows";
  return "other";
}

/**
 * Every Mac browser still says "Intel Mac OS X". Chrome and Edge can say which chip it really is;
 * Safari cannot, so it stays on Apple silicon, which every Mac sold since 2020 has.
 */
async function detectMacChip(): Promise<MacChip> {
  const nav = navigator as Navigator & {
    userAgentData?: { getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }> };
  };
  try {
    const values = await nav.userAgentData?.getHighEntropyValues?.(["architecture"]);
    if (values?.architecture === "x86") return "x64";
  } catch {
    // No hint: keep Apple silicon.
  }
  return "arm64";
}

type Button = { key: "windows" | "mac"; href: string; label: string };

/**
 * One download button for the computer you are on, the other one beside it. The server
 * cannot know which computer that is, so the first paint shows both as equals and the
 * matching one becomes the primary the moment the page runs.
 */
export function DesktopDownloads({ windowsUrl, mac }: { windowsUrl: string | null; mac: MacDownloads }) {
  const [platform, setPlatform] = useState<Platform>("other");
  const [chip, setChip] = useState<MacChip>("arm64");
  useEffect(() => {
    const found = detectPlatform();
    setPlatform(found);
    if (found === "mac") void detectMacChip().then(setChip);
  }, []);

  // A universal DMG serves both chips. Without one, the zip for this Mac's chip, and the other
  // chip as a plain link underneath so an Intel owner is never stuck with the wrong file.
  const perChip = !mac.dmg && Boolean(mac.arm64 || mac.x64);
  const macChip: MacChip = perChip && !(chip === "x64" ? mac.x64 : mac.arm64) ? (chip === "x64" ? "arm64" : "x64") : chip;
  const macHref = mac.dmg ?? (macChip === "x64" ? mac.x64 : mac.arm64);
  const otherChip: MacChip = macChip === "arm64" ? "x64" : "arm64";
  const otherHref = perChip ? (otherChip === "x64" ? mac.x64 : mac.arm64) : null;

  const buttons = [
    windowsUrl ? { key: "windows" as const, href: windowsUrl, label: "Download for Windows" } : null,
    macHref ? { key: "mac" as const, href: macHref, label: "Download for Mac" } : null,
  ].filter((button): button is Button => Boolean(button));
  const ordered = [...buttons].sort((a, b) => Number(b.key === platform) - Number(a.key === platform));
  const primary = ordered.find((button) => button.key === platform) ?? null;
  return (
    <>
      <div className="actions">
        {ordered.map((button) => (
          <a key={button.key} className={`button ${button === primary || (!primary && buttons.length === 1) ? "primary" : "secondary"}`} href={button.href} download>
            {button.label}
          </a>
        ))}
        <MarketingDesktopWebLink primary={buttons.length === 0} />
      </div>
      {perChip && macHref ? (
        <p className="desktop-download-note">
          {macChip === "arm64" ? "Mac download is for Apple silicon (M1 and newer)." : "Mac download is for Intel Macs."}
          {otherHref ? (
            <>
              {" "}
              <a href={otherHref} download>
                {otherChip === "x64" ? "Intel Mac? Get the Intel version." : "Apple silicon Mac? Get that version."}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
