import React from "react";

export function Card({ children, className = "", style }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`ui-card ${className}`}
      style={{
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-lg)",
        border: "1px solid var(--border-color)",
        boxShadow: "var(--shadow-sm)",
        display: "flex",
        flexDirection: "column",
        ...style
      }}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`ui-card-header ${className}`}
      style={{
        padding: "var(--card-padding-desktop)",
        paddingBottom: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        ...style
      }}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <h3
      className={`ui-card-title ${className}`}
      style={{
        fontSize: "16px",
        fontWeight: 600,
        color: "var(--text-primary)",
        margin: 0,
        lineHeight: 1.2,
        ...style
      }}
    >
      {children}
    </h3>
  );
}

export function CardDescription({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <p
      className={`ui-card-description ${className}`}
      style={{
        fontSize: "13px",
        color: "var(--text-secondary)",
        margin: 0,
        ...style
      }}
    >
      {children}
    </p>
  );
}

export function CardContent({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`ui-card-content ${className}`}
      style={{
        padding: "0 var(--card-padding-desktop) var(--card-padding-desktop)",
        flex: 1,
        ...style
      }}
    >
      {children}
    </div>
  );
}

export function CardFooter({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`ui-card-footer ${className}`}
      style={{
        padding: "16px var(--card-padding-desktop)",
        borderTop: "1px solid var(--border-color)",
        display: "flex",
        alignItems: "center",
        ...style
      }}
    >
      {children}
    </div>
  );
}
