import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = "Cargando..." }: LoadingStateProps) {
  return (
    <div className="loading-state">
      <Loader2 size={32} className="spin" aria-hidden="true" />
      <p>{message}</p>
    </div>
  );
}
