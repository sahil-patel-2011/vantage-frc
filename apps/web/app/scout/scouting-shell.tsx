"use client";

import "../product-styles";
import "./scouting-shell.css";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { crossProductHref } from "../../lib/products/products";

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

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/me${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`)
      .then((response) => (response.ok ? (response.json() as Promise<Me>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        setMe(data);
        if (!orgId && data.orgId) {
          const next = new URLSearchParams(params.toString());
          next.set("orgId", data.orgId);
          router.replace(`${pathname}?${next.toString()}`);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Re-resolve only when the team in the URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const team = me?.teamNumber ? `Team ${me.teamNumber}` : me?.orgName ?? null;
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
        <a className="scouting-back" href={crossProductHref("vantage", "/dashboard", orgId)}>
          Back to Vantage
        </a>
      </header>
      <div id="scouting-main" className="scouting-main">
        {children}
      </div>
    </div>
  );
}
