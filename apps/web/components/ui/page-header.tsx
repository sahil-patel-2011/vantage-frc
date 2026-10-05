import { Children, type ReactNode } from "react";
import { breadcrumbForPath } from "../../lib/nav/product-nav";
import { PageOptions } from "./page-options";

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
  const actions = Children.toArray(children);
  return (
    <header className={["app-page-header", "scan-header", className].filter(Boolean).join(" ")}>
      <div>
        {crumb ? <span className="breadcrumbs">{crumb}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions.length ? <div className="app-page-actions">{actions.slice(0, 2)}{actions.length > 2 ? <PageOptions>{actions.slice(2)}</PageOptions> : null}</div> : null}
    </header>
  );
}
