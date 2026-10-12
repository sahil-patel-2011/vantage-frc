"use client";

import { useEffect, useState } from "react";
import { VantageLogo } from "../../components/brand";
import { Button } from "../../components/ui";
import { bannerLinks, readSheetCopies, type CachedCopy } from "../../lib/outage/sheet-copies";
import "../join-team/join-team.css";
import "./backup-mode-notice.css";

type Link = CachedCopy & { team: string | null };

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The sign-in page while Vantage runs in backup mode (VANTAGE_BACKUP_MODE): there is no database
 * to sign in against, so instead of a form that can only fail it says what is going on and opens
 * the team's spreadsheet copy, the one this device remembered while Vantage worked
 * (lib/outage/sheet-copies.ts). Every page that needs data lands here.
 */
export function BackupModeNotice({ returning }: { returning: boolean }) {
  const [links, setLinks] = useState<Link[]>([]);

  useEffect(() => {
    setLinks(bannerLinks(readSheetCopies(storage()), null));
  }, []);

  return (
    <main className="join-team-page backup-notice-page">
      <section className="join-team-card backup-notice" aria-labelledby="backup-notice-title">
        <VantageLogo />
        <p className="backup-notice-status" role="status">
          <span aria-hidden="true" className="backup-notice-dot" />
          Backup mode
        </p>
        <h1 id="backup-notice-title">Vantage is running from its backup</h1>
        <p className="app-muted">
          The team server is offline for now, so sign-in is paused{returning ? " and that page will open again once it is back" : ""}.
          Nothing is lost: each team’s data is in its Google Sheets copy.
        </p>
        {links.length ? (
          <div className="backup-notice-links">
            {links.map((link) => (
              <Button key={link.url} as="a" variant="primary" href={link.url} target="_blank" rel="noopener noreferrer">
                Open {links.length > 1 && link.team ? `${link.team}’s` : "your team’s"} copy
                {link.kind === "excel" ? " (Excel)" : " (Google Sheets)"}
              </Button>
            ))}
          </div>
        ) : (
          <p className="backup-notice-hint">
            Looking for your team’s data? Its Google Sheets copy is in Google Drive; your team owner can share it.
          </p>
        )}
        <ul className="backup-notice-facts">
          <li>Scouting entries already saved on a phone stay on it and send when Vantage is back.</li>
          <li>New teams can still join the waitlist.</li>
        </ul>
        <p>
          <Button as="a" variant={links.length ? "secondary" : "primary"} href="/#waitlist">
            Join the waitlist
          </Button>
        </p>
        <p className="join-team-alternative">
          <a href="/">Back to Vantage</a>
        </p>
      </section>
    </main>
  );
}
