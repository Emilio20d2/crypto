import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", error, ...props }, ref) => (
    <input
      ref={ref}
      className={`ui-input ${error ? "is-invalid" : ""} ${className}`}
      {...props}
    />
  )
);

Input.displayName = "Input";
