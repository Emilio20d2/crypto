import React from "react";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", error, children, ...props }, ref) => (
    <select
      ref={ref}
      className={`ui-select ${error ? "is-invalid" : ""} ${className}`}
      {...props}
    >
      {children}
    </select>
  )
);

Select.displayName = "Select";
