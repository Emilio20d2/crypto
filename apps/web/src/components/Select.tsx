import React from "react";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", error, style, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`ui-select ${className}`}
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
          appearance: "none",
          backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%2364748b%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 12px top 50%",
          backgroundSize: "10px auto",
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
      >
        {children}
      </select>
    );
  }
);
Select.displayName = "Select";
