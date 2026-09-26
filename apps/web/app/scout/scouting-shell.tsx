"use client";

import "../product-styles";
import "./scouting-shell.css";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { crossProductHref, isScoutingPath, isSharedPath, productForHost, scoutingTwin } from "../../lib/products/products";
import { ShellOutboxStatus } from "../../components/shell-outbox-status";

type Me = { orgId?: string | null; orgName?: string | null; teamNumber?: number | null; authenticated?: boolean };

export const SCOUTING_NAV = [
  { href: "/scout", label: "Home", match: (path: string) => path === "/scout" },
  { href: "/scout/entry", label: "Scout", match: (path: string) => path.startsWith("/scout/entry") },
  { href: "/scout/teams", label: "Teams", match: (path: string) => path.startsWith("/scout/teams") },
  { href: "/scout/predict", label: "Predict", match: (path: string) => path.startsWith("/scout/predict") },
  { href: "/scout/picklist", label: "Pick list", match: (path: string) => path.startsWith("/scout/picklist") },
] as const;

/**
 * The Scouting product's frame.
 *
 * Deliberately not Vantage's shell: no drawer of forty tools, no hubs. A
 * scouter at an event needs five places and a way back. Everything inside is
 * the same code Vantage runs — the pages under /scout re-use the feature
 * clients — so the products differ in focus, not in behaviour or data.
 *
 * Team context: the feature pages read ?orgId=. Arriving without one (a
 * bookmark, the bare Scouting host) this fills it in from the person's active
 * team, so nobody is asked to "choose your team" twice.
 */
export function ScoutingShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/scout";
  const params = useSearchParams();
  const router = useRouter();
  const orgId = params.get("orgId");
  const [me, setMe] = useState<Me | null>(null);
  const [meSettled, setMeSettled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/me${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`)
      .then((response) => (response.ok ? (response.json() as Promise<Me>) : null))
      .then((data) => {
        if (cancelled) return;
        setMeSettled(true);
        if (!data) return;
        setMe(data);
        if (!orgId && data.orgId) {
          const next = new URLSearchParams(params.toString());
          next.set("orgId", data.orgId);
          router.replace(`${pathname}?${next.toString()}`);
        }
      })
      .catch(() => {
        if (!cancelled) setMeSettled(true);
      });
    return () => {
      cancelled = true;
    };
    // Re-resolve only when the team in the URL changes.
  }, [orgId]);

  // A link inside the Scouting app to a Vantage-only page ("Open pick desk", "Open Pick clock")
  // is a relative path on this host. Followed as-is it bounced off the product redirect (in the
  // worst case back to itself) and arrived signed out. Send it through the sign-in handoff instead.
  useEffect(() => {
    if (productForHost(window.location.host) !== "scouting") return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname.startsWith("/api/") || isScoutingPath(url.pathname) || isSharedPath(url.pathname)) return;
      if (scoutingTwin(url.pathname)) return;
      event.preventDefault();
      window.location.assign(crossProductHref("vantage", `${url.pathname}${url.search}${url.hash}`, orgId));
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [orgId]);

  const team = me?.teamNumber ? `Team ${me.teamNumber}` : me?.orgName ?? null;
  // Without ?orgId the pages would render "Choose your team" for the moment it takes to
  // look the team up, then swap to the real page. Hold them until the answer is in: a
  // team fills the URL (and this clears), no team lets the page ask, a failure lets it try.
  const resolvingTeam = !orgId && (!meSettled || Boolean(me?.orgId));
  const withOrg = (href: string) => (orgId ? `${href}?orgId=${encodeURIComponent(orgId)}` : href);

  return (
    <div className="scouting-product">
      <a className="soft-skip-link" href="#scouting-main">
        Skip to main content
      </a>
      <header className="scouting-bar">
        <a className="scouting-brand" href={withOrg("/scout")} aria-label="Vantage Scouting home">
          <span className="scouting-mark" aria-hidden="true">
            V
          </span>
          <span>
            <strong>Scouting</strong>
            {team ? <small>{team}</small> : null}
          </span>
        </a>
        <nav className="scouting-tabs" aria-label="Scouting">
          {SCOUTING_NAV.map((item) => (
            <a
              key={item.href}
              href={withOrg(item.href)}
              aria-current={item.match(pathname) ? "page" : undefined}
              className={item.match(pathname) ? "is-active" : undefined}
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="scouting-bar-end">
          {/* Queued entries go when the signal is back, from any Scouting page — not only
              from the Scout tab. The pill shows only while something is waiting. */}
          <ShellOutboxStatus orgId={orgId} scoutPath="/scout/entry" />
          <a className="scouting-back" href={crossProductHref("vantage", "/dashboard", orgId)}>
            Back to Vantage
          </a>
        </div>
      </header>
      <div id="scouting-main" className="scouting-main" aria-busy={resolvingTeam || undefined}>
        {resolvingTeam ? <p className="scouting-resolving">Opening your team…</p> : children}
      </div>
    </div>
  );
}
