"use client";

import { usePathname } from "next/navigation";
import type { MouseEvent } from "react";
import { aiSkillById, aiSkillForPage, askAiHref, type AskAiLink } from "../lib/ai-skills/catalog";
import { Icon } from "./icon";
import "./ask-ai-button.css";

/**
 * The page as Ask AI should hear it, read when the link is used: "/business" with
 * "?tab=sponsors&orgId=…" → "/business?tab=sponsors" — the tab is part of the page, the rest is not.
 */
function pageFromLocation(pathname: string): { page: string; search: string } {
  const search = typeof window === "undefined" ? "" : window.location.search;
  const tab = new URLSearchParams(search).get("tab");
  return { page: tab ? `${pathname}?tab=${tab}` : pathname, search };
}

/**
 * The one way into Ask AI from a page: a quiet sparkles chip that opens the assistant on this
 * page's skill, with this page's context. It replaces the per-feature "Draft with AI",
 * "Expand with AI" and "Analyze" buttons and panels — every page reaches the AI the same way.
 *
 * `skill` defaults to the page's own skill (lib/ai-skills/catalog `pages`). `prompt` puts a
 * starter in the box; it is never sent until the person presses Send.
 */
export function AskAiButton({
  orgId,
  skill,
  prompt,
  about,
  sponsorId,
  teamKey,
  matchKey,
  label = "Ask AI",
  className,
}: Omit<AskAiLink, "from" | "mode"> & { label?: string; className?: string }) {
  const pathname = usePathname() ?? "/";
  const resolved = (skill ? aiSkillById(skill) : aiSkillForPage(pathname))?.id ?? null;
  const link = { orgId, skill: resolved, prompt, about, sponsorId, teamKey, matchKey };
  const href = askAiHref({ ...link, from: pathname });
  const name = aiSkillById(resolved)?.name;
  return (
    <a
      className={["ask-ai-chip", className].filter(Boolean).join(" ")}
      href={href}
      title={name ? `Ask AI — opens on ${name}` : "Ask AI"}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        const { page, search } = pageFromLocation(pathname);
        const pageSkill = skill ? resolved : (aiSkillForPage(pathname, search)?.id ?? resolved);
        event.currentTarget.href = askAiHref({ ...link, skill: pageSkill, from: page });
      }}
    >
      <Icon name="sparkles" />
      <span>{label}</span>
    </a>
  );
}

/**
 * The top bar's sparkles button: the same link, pre-set to whatever skill the current page has.
 * On a page without an obvious AI job it opens Ask AI and lets the assistant choose.
 */
export function AskAiTopbarLink({
  orgId,
  className,
  label,
}: {
  orgId: string | null;
  className?: string;
  /** Shown beside the icon (the desktop sidebar's row); the top bar is icon-only. */
  label?: string;
}) {
  const pathname = usePathname() ?? "/";
  const pageSkill = aiSkillForPage(pathname)?.id ?? null;
  const onAskAi = pathname === "/ai" || pathname.startsWith("/ai/");
  const href = onAskAi ? askAiHref({ orgId }) : askAiHref({ orgId, skill: pageSkill, from: pageSkill ? pathname : null });
  return (
    <a
      className={className}
      data-tour="ask-ai"
      href={href}
      aria-label={label ? undefined : "Ask AI"}
      aria-current={onAskAi && label ? "page" : undefined}
      title="Ask AI — one assistant for sponsors, strategy, the pit and more"
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (onAskAi) return;
        const { page, search } = pageFromLocation(pathname);
        const skill = aiSkillForPage(pathname, search)?.id ?? null;
        event.currentTarget.href = askAiHref({ orgId, skill, from: skill ? page : null });
      }}
    >
      <Icon name="sparkles" />
      {label ? <span>{label}</span> : null}
    </a>
  );
}
