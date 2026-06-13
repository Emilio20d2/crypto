import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", error, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`ui-select ${error ? "error" : ""} ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  }
);
Select.displayName = "Select";
