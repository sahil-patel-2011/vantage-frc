import { Children, type ReactNode } from "react";
import { breadcrumbForPath } from "../../lib/nav/product-nav";
import { PageToolbar } from "./page-toolbar";

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

/**
 * Shared page chrome: breadcrumbs, title, and the page toolbar on the right.
 *
 * DEPRECATED 2026-10-26: showing the first two children and filing the rest
 * under "Page options" without a primary / quiet / More split. Children now
 * go through PageToolbar.
 */
export function PageHeader({ breadcrumbs, navPath, title, description, children, className }: PageHeaderProps) {
  const crumb = breadcrumbs ?? (navPath ? breadcrumbForPath(navPath) : null);
  const toolbarLabel = typeof title === "string" ? title : "Page";
  const hasToolbar = Children.toArray(children).length > 0;
  return (
    <header className={["app-page-header", "scan-header", className].filter(Boolean).join(" ")}>
      <div>
        {crumb ? <span className="breadcrumbs">{crumb}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {hasToolbar ? <PageToolbar className="app-page-actions" label={toolbarLabel}>{children}</PageToolbar> : null}
    </header>
  );
}
