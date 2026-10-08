import type { ReactNode, SVGProps } from "react";
import type { ProductNavIcon } from "../lib/nav/product-nav";

export type IconName = ProductNavIcon;

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const PATHS: Record<IconName, ReactNode> = {
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16 16 5 5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 7H3s3 0 3-7" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  home: (
    <>
      <path d="m4 11 8-7 8 7" />
      <path d="M6 10v10h12V10" />
    </>
  ),
  swords: <><path d="M5 21V4c5-4 9 4 14 0v10c-5 4-9-4-14 0" /><path d="M10 3v10m5-8v10M5 8c5-4 9 4 14 0" /></>,
  scout: (
    <>
      <path d="M3 14 6 5h3l1 9m4 0 1-9h3l3 9M10 10h4" />
      <circle cx="6.5" cy="16" r="4.5" /><circle cx="17.5" cy="16" r="4.5" />
    </>
  ),
  stats: <path d="M5 19V10m7 9V5m7 14v-7" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  chat: (
    <>
      <path d="M5 6h14v9H9l-4 4V6z" />
      <circle cx="9" cy="10.5" r=".8" fill="currentColor" />
      <circle cx="12" cy="10.5" r=".8" fill="currentColor" />
      <circle cx="15" cy="10.5" r=".8" fill="currentColor" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  clipboard: (
    <>
      <rect x="6" y="5" width="12" height="16" rx="2" />
      <path d="M9 5V4h6v1M9 11h6M9 15h4" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-2h6l2 2h3v11H4V8z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 19a6 6 0 0 1 12 0M16 8a3 3 0 1 1 0 6m2 5a5 5 0 0 0-3-4.5" />
    </>
  ),
  bolt: <path d="M13 2 5 14h6l-1 8 8-12h-6l1-8z" />,
  cube: (
    <>
      <path d="m12 2 9 5-9 5-9-5 9-5Z" />
      <path d="m3 7 9 5 9-5v10l-9 5-9-5V7Z" />
    </>
  ),
  code: <path d="m8 8-4 4 4 4m8-8 4 4-4 4m-2-11-2 14" />,
  display: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="m10 3-.5 2-2 .9-1.9-.6-2 3.4 1.4 1.5v2.3l-1.4 1.6 2 3.4 2-.6 1.9 1 .5 2.1h4l.5-2.1 2-1 1.9.6 2-3.4-1.4-1.6v-2.3l1.4-1.5-2-3.4-2 .6-1.9-.9L14 3z" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-5.3 7-11a7 7 0 1 0-14 0c0 5.7 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  back: <path d="M15 6 9 12l6 6" />,
  form: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 7h8M11 12h5M11 17h5" /><circle cx="8" cy="12" r=".7" fill="currentColor" /><circle cx="8" cy="17" r=".7" fill="currentColor" /></>,
  assignment: <><circle cx="8" cy="7" r="3" /><path d="M2 20v-2a6 6 0 0 1 12 0v2M16 6h6m-6 5h6m-6 5 2 2 4-4" /></>,
  rank: <><path d="M4 20v-7h5v7m0 0V5h6v15m0 0v-10h5v10M2 20h20" /></>,
  book: <><path d="M12 5v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2z" /></>,
  sparkles: (
    <>
      <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
    </>
  ),
  play: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l6 3.5-6 3.5v-7z" />
    </>
  ),
  logout: (
    <>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 8l4 4-4 4M14 12H4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  shield: <path d="M12 3l7 3v5.5c0 4.3-2.9 8-7 9.5-4.1-1.5-7-5.2-7-9.5V6l7-3z" />,
  activity: <path d="M3 12h4l3 8 4-16 3 8h4" />,
  database: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  // Venue weather had a computer monitor.
  cloud: <path d="M7 18h10a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.1 9.2 4.5 4.5 0 0 0 7 18z" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </>
  ),
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={18} height={18} {...STROKE} {...props}>
      {PATHS[name]}
    </svg>
  );
}
