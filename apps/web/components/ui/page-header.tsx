import type { ReactNode } from "react";

type PageHeaderProps = {
  breadcrumbs: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/** Shared Soft-UI page chrome: breadcrumbs, title, optional description + trailing actions. */
export function PageHeader({ breadcrumbs, title, description, children, className }: PageHeaderProps) {
  return (
    <header className={["app-page-header", className].filter(Boolean).join(" ")}>
      <div>
        <span className="breadcrumbs">{breadcrumbs}</span>
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </header>
  );
}
