import { AlertCircle } from "lucide-react";

interface ErrorStateProps {
  message: string;
}

export function ErrorState({ message }: ErrorStateProps) {
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
      <AlertCircle size={32} color="var(--color-danger)" style={{ marginBottom: "16px" }} />
      <h3 style={{ fontSize: "16px", fontWeight: 600, color: "var(--color-danger)", margin: "0 0 8px 0" }}>
        Ha ocurrido un error
      </h3>
      <p style={{ fontSize: "14px", maxWidth: "320px", margin: 0, lineHeight: 1.5 }}>
        {message}
      </p>
    </div>
  );
}
