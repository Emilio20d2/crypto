import { AlertCircle } from "lucide-react";

interface ErrorStateProps {
  message: string;
}

export function ErrorState({ message }: ErrorStateProps) {
  return (
    <div className="error-state">
      <AlertCircle size={32} aria-hidden="true" />
      <h3>Ha ocurrido un error</h3>
      <p>{message}</p>
    </div>
  );
}
