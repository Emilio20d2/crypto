import React from "react";
import { Loader2 } from "lucide-react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "icon";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "primary", size = "md", fullWidth, loading, children, disabled, style, ...props }, ref) => {
    
    const baseStyle: React.CSSProperties = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "8px",
      borderRadius: "var(--radius-sm)",
      fontWeight: 500,
      transition: "all var(--t-fast)",
      cursor: disabled || loading ? "not-allowed" : "pointer",
      opacity: disabled || loading ? 0.6 : 1,
      fontFamily: "inherit",
      outline: "none",
      width: fullWidth ? "100%" : "auto",
      ...style
    };

    const variantStyles: Record<string, React.CSSProperties> = {
      primary: {
        background: "var(--color-primary)",
        color: "var(--text-inverse)",
        border: "1px solid transparent",
      },
      secondary: {
        background: "var(--bg-surface)",
        color: "var(--text-primary)",
        border: "1px solid var(--border-color-strong)",
        boxShadow: "var(--shadow-sm)",
      },
      ghost: {
        background: "transparent",
        color: "var(--text-secondary)",
        border: "1px solid transparent",
      },
      danger: {
        background: "var(--color-danger)",
        color: "var(--text-inverse)",
        border: "1px solid transparent",
      },
      icon: {
        background: "transparent",
        color: "var(--text-secondary)",
        border: "1px solid transparent",
        padding: "8px",
      }
    };

    const sizeStyles: Record<string, React.CSSProperties> = {
      sm: { height: "var(--control-height-sm)", padding: "0 12px", fontSize: "12px" },
      md: { height: "var(--control-height)", padding: "0 16px", fontSize: "14px" },
      lg: { height: "var(--control-height-lg)", padding: "0 24px", fontSize: "16px" },
      icon: {} // icon size overrides handled in variant
    };

    const finalStyle = {
      ...baseStyle,
      ...variantStyles[variant],
      ...(variant !== "icon" ? sizeStyles[size] : {}),
    };

    return (
      <button
        ref={ref}
        className={`ui-button ${variant} ${className}`}
        disabled={disabled || loading}
        style={finalStyle}
        {...props}
      >
        {loading && <Loader2 size={16} className="lucide-spin" style={{ animation: "spin 1s linear infinite" }} />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
