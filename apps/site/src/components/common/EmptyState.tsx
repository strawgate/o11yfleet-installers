import type { ReactNode } from "react";

type EmptyStateIcon = "box" | "plug" | "key" | "users" | "file" | "activity" | "search";

interface EmptyStateProps {
  icon?: EmptyStateIcon;
  title: string;
  description?: string;
  children?: ReactNode;
}

const PATHS: Record<EmptyStateIcon, ReactNode> = {
  box: (
    <>
      <path d="M3 6.5 8 3l5 3.5v5L8 15l-5-3.5v-5Z" />
      <path d="m3.5 6.8 4.5 2.7 4.5-2.7M8 9.5V15" />
    </>
  ),
  plug: (
    <>
      <path d="M6 2v4M10 2v4M4.5 6h7v2.5A3.5 3.5 0 0 1 8 12v2" />
      <path d="M8 14h3" />
    </>
  ),
  key: (
    <>
      <circle cx="5.5" cy="10.5" r="2.5" />
      <path d="m7.4 8.6 5.1-5.1M10.5 5.5l1.2 1.2M9 7l1 1" />
    </>
  ),
  users: (
    <>
      <circle cx="6" cy="6" r="2.3" />
      <path d="M2 13c0-2.1 1.8-3.5 4-3.5s4 1.4 4 3.5" />
      <path d="M11 8.5c1.6.2 3 1.4 3 3.2M10.5 4a2 2 0 0 1 0 4" />
    </>
  ),
  file: (
    <>
      <path d="M4 2.5h5l3 3v8A1.5 1.5 0 0 1 10.5 15h-5A1.5 1.5 0 0 1 4 13.5v-11Z" />
      <path d="M9 2.5v3h3M6 9h4M6 12h3" />
    </>
  ),
  activity: <path d="M2 8h3l2-5 3 10 2-5h3" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </>
  ),
};

export function EmptyState({ icon = "box", title, description, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
          {PATHS[icon]}
        </svg>
      </span>
      <div>
        <div className="empty-state-title">{title}</div>
        {description ? <p>{description}</p> : null}
      </div>
      {children ? <div className="empty-state-actions">{children}</div> : null}
    </div>
  );
}
