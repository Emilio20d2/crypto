import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", error, style, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`ui-input ${className}`}
        style={{
          width: "100%",
          height: "var(--control-height)",
          padding: "0 12px",
          background: "var(--bg-surface)",
          border: `1px solid ${error ? "var(--color-danger)" : "var(--border-color-strong)"}`,
          borderRadius: "var(--radius-sm)",
          fontSize: "14px",
          color: "var(--text-primary)",
          outline: "none",
          transition: "all var(--t-fast)",
          boxShadow: error ? "0 0 0 3px rgba(239, 68, 68, 0.1)" : "none",
          ...style
        }}
        onFocus={(e) => {
          if (!error) {
            e.target.style.borderColor = "var(--color-primary)";
            e.target.style.boxShadow = "0 0 0 3px var(--border-focus)";
          }
          if (props.onFocus) props.onFocus(e);
        }}
        onBlur={(e) => {
          if (!error) {
            e.target.style.borderColor = "var(--border-color-strong)";
            e.target.style.boxShadow = "none";
          }
          if (props.onBlur) props.onBlur(e);
        }}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
