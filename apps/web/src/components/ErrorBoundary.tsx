
import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMsg: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMsg: ""
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMsg: error.message };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="error-container">
          <h1 className="error-title">Ha ocurrido un error inesperado</h1>
          <p>La aplicación no pudo cargar correctamente esta vista.</p>
          <pre style={{ background: "#F3F4F6", padding: 16, borderRadius: 8, marginTop: 16, textAlign: "left" }}>
            {this.state.errorMsg}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            style={{ marginTop: 24, padding: "10px 20px", background: "var(--brand-primary)", color: "white", border: "none", borderRadius: "var(--radius-md)", cursor: "pointer" }}
          >
            Recargar aplicación
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
