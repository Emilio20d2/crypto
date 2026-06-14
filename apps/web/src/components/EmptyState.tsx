import React from "react";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export function EmptyState({ icon, title, description }: EmptyStateProps) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      padding: "48px 24px",
      color: "var(--text-secondary)"
    }}>
      <div style={{ color: "var(--text-muted)", marginBottom: "16px" }}>
        {icon}
      </div>
      <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-primary)", margin: "0 0 8px 0" }}>
        {title}
      </h3>
      <p style={{ fontSize: "14px", maxWidth: "320px", margin: 0, lineHeight: 1.5 }}>
        {description}
      </p>
    </div>
  );
}
