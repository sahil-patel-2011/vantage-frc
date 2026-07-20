import "./help.css";

/** Tiny Soft-UI deep-link into a Help tutorial — keep chrome light. */
export function HowToUseLink({
  slug,
  label = "How to use this",
  className,
}: {
  slug: string;
  label?: string;
  className?: string;
}) {
  return (
    <a className={["help-howto", className].filter(Boolean).join(" ")} href={`/help/${slug}`}>
      <span aria-hidden="true">?</span>
      {label}
    </a>
  );
}
