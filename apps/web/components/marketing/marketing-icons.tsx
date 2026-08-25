/**
 * Inline stroke icons for marketing surfaces. Matches the product's icon
 * language: 24px grid, currentColor stroke, round caps, no fills.
 */

export type MIconName =
  | "chat"
  | "table"
  | "cap"
  | "wifi"
  | "phone"
  | "users"
  | "shield"
  | "lock"
  | "key"
  | "clipboard"
  | "target"
  | "flag"
  | "wrench"
  | "calendar"
  | "coins";

const paths: Record<MIconName, React.ReactNode> = {
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
  table: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </>
  ),
  cap: (
    <>
      <path d="M22 9 12 4 2 9l10 5 10-5z" />
      <path d="M6 11.5V16c0 1.6 2.7 3 6 3s6-1.4 6-3v-4.5" />
    </>
  ),
  wifi: (
    <>
      <path d="m2 2 20 20" />
      <path d="M5 12.5a10 10 0 0 1 4.3-2.5M12.5 5a15 15 0 0 1 9.5 3.5" />
      <path d="M8.5 16a6 6 0 0 1 5.2-1.6M2 8.5a15 15 0 0 1 3.3-2.2" />
      <path d="M12 19.5h.01" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <path d="M11 18h2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5a3.5 3.5 0 0 1 0 7M17.5 14.5a6.5 6.5 0 0 1 4 5.5" />
    </>
  ),
  shield: <path d="m12 3 8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z" />,
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15.5" r="4" />
      <path d="M11 12.5 20 3.5M16 7.5l3 3" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4a3 3 0 0 1 6 0" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12h.01" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h13l-2.5 4L18 12H5" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 10h17M8 2.5V7M16 2.5V7" />
    </>
  ),
  coins: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15 9.3c-.6-1-1.7-1.5-3-1.5-1.8 0-3 .9-3 2.2 0 2.9 6 1.5 6 4.3 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.6-3.2-1.6" />
      <path d="M12 6v1.8M12 16.2V18" />
    </>
  ),
};

export function MIcon({ name, size = 18 }: { name: MIconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
