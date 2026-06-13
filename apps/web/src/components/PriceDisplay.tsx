import type { CSSProperties } from "react";

export interface PriceDisplayProps {
  value: number | null | undefined;
  currency?: string;
  className?: string;
  style?: CSSProperties;
  maximumFractionDigits?: number;
}

export function PriceDisplay({ value, currency = "EUR", className = "", style, maximumFractionDigits = 2 }: PriceDisplayProps) {
  if (value === null || value === undefined) {
    return null;
  }

  const formatted = new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency,
    maximumFractionDigits,
  }).format(value);

  return <span className={`ui-price-display ${className}`} style={style}>{formatted}</span>;
}
