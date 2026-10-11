/**
 * The bug: an oval body, six legs, two antennae, drawn as line art in currentColor so it takes the
 * colour of whatever holds it (the corner button, the account menu row). Decorative; the control
 * around it carries the name.
 */
export function FeedbackBugIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* head, then the oval body with its centre seam */}
      <path d="M9.4 7.8V6.6a2.6 2.6 0 0 1 5.2 0v1.2" />
      <path d="M12 20.5c-3.2 0-5.6-2.5-5.6-5.6v-3.1c0-2.2 1.8-4 4-4h3.2c2.2 0 4 1.8 4 4v3.1c0 3.1-2.4 5.6-5.6 5.6Z" />
      <path d="M12 11v9.5" />
      {/* two antennae */}
      <path d="M10.2 4.8 8.6 3.2M13.8 4.8l1.6-1.6" />
      {/* six legs */}
      <path d="M6.6 10.6 3.2 9M6.4 14.2H2.6M7.2 17.6l-3.4 2" />
      <path d="M17.4 10.6 20.8 9M17.6 14.2h3.8M16.8 17.6l3.4 2" />
    </svg>
  );
}
