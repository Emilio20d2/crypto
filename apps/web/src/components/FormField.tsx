import React from "react";

interface FormFieldProps {
  label: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormField({ label, error, htmlFor, children, className = "" }: FormFieldProps) {
  return (
    <div className={`form-group ${className}`}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {error && <span className="error-msg">{error}</span>}
    </div>
  );
}
