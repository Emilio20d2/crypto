import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "Cargando..." }: LoadingStateProps) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      padding: "48px 24px",
      color: "var(--text-muted)"
    }}>
      <Loader2 size={32} className="lucide-spin" style={{ animation: "spin 1s linear infinite", marginBottom: "16px" }} />
      <p style={{ fontSize: "14px", margin: 0 }}>{message}</p>
    </div>
  );
}
