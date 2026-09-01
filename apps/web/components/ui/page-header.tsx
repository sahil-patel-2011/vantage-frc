import type { ReactNode } from "react";
import { breadcrumbForPath } from "../../lib/nav/product-nav";

type PageHeaderProps = {
  /** Explicit crumb trail. Prefer this or `navPath`, not both. */
  breadcrumbs?: ReactNode;
  /** When set, breadcrumbs default to `Group / Label` from product nav. */
  navPath?: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** Shared Soft-UI page chrome: breadcrumbs, title, optional description + trailing actions. */
export function PageHeader({ breadcrumbs, navPath, title, description, children, className }: PageHeaderProps) {
  const crumb = breadcrumbs ?? (navPath ? breadcrumbForPath(navPath) : null);
  return (
    <header className={["app-page-header", className].filter(Boolean).join(" ")}>
      <div>
        {crumb ? <span className="breadcrumbs">{crumb}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {children ? <div className="app-page-actions">{children}</div> : null}
    </header>
  );
}
