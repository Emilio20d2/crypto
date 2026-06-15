import type { ReactNode } from "react";

type SlotProps = {
  children?: ReactNode;
  className?: string;
};

function cx(base: string, className = "") {
  return className ? `${base} ${className}` : base;
}

export function Card({ children, className = "" }: SlotProps) {
  return <section className={cx("ui-card", className)}>{children}</section>;
}

export function CardHeader({ children, className = "" }: SlotProps) {
  return <header className={cx("ui-card-header", className)}>{children}</header>;
}

export function CardTitle({ children, className = "" }: SlotProps) {
  return <h3 className={cx("ui-card-title", className)}>{children}</h3>;
}

export function CardDescription({ children, className = "" }: SlotProps) {
  return <p className={cx("ui-card-description", className)}>{children}</p>;
}

export function CardActions({ children, className = "" }: SlotProps) {
  return <div className={cx("ui-card-actions", className)}>{children}</div>;
}

export function CardContent({ children, className = "" }: SlotProps) {
  return <div className={cx("ui-card-content", className)}>{children}</div>;
}

export function CardFooter({ children, className = "" }: SlotProps) {
  return <footer className={cx("ui-card-footer", className)}>{children}</footer>;
}
