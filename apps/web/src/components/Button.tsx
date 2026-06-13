import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size    = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  const cls = [
    "btn",
    `btn-${variant}`,
    size === "sm" ? "btn-sm" : "",
    loading ? "btn-loading" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={cls} disabled={disabled || loading} {...props}>
      {loading ? " " : children}
    </button>
  );
}

export function IconButton({
  variant = "ghost",
  size = "md",
  loading = false,
  disabled,
  children,
  className = "",
  ...props
}: ButtonProps) {
  const cls = [
    "btn",
    "btn-icon",
    `btn-${variant}`,
    size === "sm" ? "btn-sm" : "",
    loading ? "btn-loading" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={cls} disabled={disabled || loading} {...props}>
      {loading ? " " : children}
    </button>
  );
}
