interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

import { Button } from "./Button";

export function ErrorState({ title = "Ha ocurrido un error", message, onRetry, className = "" }: ErrorStateProps) {
  return (
    <div className={`error-container ${className}`}>
      <div className="error-title">{title}</div>
      <p style={{ margin: "0 0 16px 0", maxWidth: 400 }}>{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  );
}
