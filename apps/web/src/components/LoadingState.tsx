interface LoadingStateProps {
  text?: string;
  className?: string;
}

export function LoadingState({ text = "Cargando...", className = "" }: LoadingStateProps) {
  return (
    <div className={`ui-loading-state ${className}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px" }}>
      <div className="btn-loading" style={{ width: 24, height: 24, marginBottom: 16 }}></div>
      <div style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>{text}</div>
    </div>
  );
}
