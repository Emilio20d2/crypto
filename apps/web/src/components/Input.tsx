import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`ui-input ${error ? "error" : ""} ${className}`}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";
