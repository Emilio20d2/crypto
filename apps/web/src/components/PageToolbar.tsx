import type { ReactNode } from "react";

export function PageToolbar({
  title,
  eyebrow,
  meta,
  actions,
}: {
  title: string;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-toolbar">
      <div className="page-toolbar-copy">
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {meta && <div className="page-meta">{meta}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}
