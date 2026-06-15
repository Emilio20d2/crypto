export const eurFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

export const compactEurFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  notation: "compact",
  maximumFractionDigits: 2,
});

export function formatMoney(value: number | null | undefined, fallback = "No disponible en Coinbase") {
  return typeof value === "number" && Number.isFinite(value) ? eurFormatter.format(value) : fallback;
}

export function formatCrypto(value: number | null | undefined, fallback = "No disponible en Coinbase") {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("es-ES", { maximumFractionDigits: 8 })
    : fallback;
}

export function formatPercent(value: number | null | undefined, fallback = "No disponible en Coinbase") {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toLocaleString("es-ES", { maximumFractionDigits: 2 })}%`;
}

export function formatAllocation(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.abs(value) <= 1 ? value * 100 : value));
}

export function formatDateTime(timestamp: number | null | undefined) {
  if (!timestamp) return "No disponible";
  return new Date(timestamp).toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTime(timestamp: number | null | undefined) {
  if (!timestamp) return "No disponible";
  return new Date(timestamp).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
