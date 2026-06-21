export type CoinbaseMoneyLike = number | string | { value?: unknown; currency?: string } | null | undefined;

export function moneyValue(input: CoinbaseMoneyLike): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (input && typeof input === "object") {
    const parsed = Number(input.value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function stringAmount(input: unknown): string | null {
  if (!input) return null;
  if (typeof input === "string") return input;
  if (typeof input === "number" && Number.isFinite(input)) return String(input);
  if (typeof input === "object" && "value" in input) {
    const value = (input as { value?: unknown }).value;
    return typeof value === "string" || typeof value === "number" ? String(value) : null;
  }
  return null;
}

export function costLevelLabel(level: string | null | undefined): string {
  switch (level) {
    case "bajo":
      return "Coste bajo";
    case "moderado":
      return "Coste moderado";
    case "alto":
      return "Coste alto";
    case "muy_alto":
      return "Coste muy alto";
    default:
      return "Coste no disponible";
  }
}

export function operationLabel(type: string): string {
  switch (type) {
    case "buy":
      return "Compra";
    case "sell":
      return "Venta";
    case "convert":
      return "Conversión";
    case "rebuy":
      return "Recompra";
    default:
      return type;
  }
}

export function routeLabel(routeType: string | null | undefined): string {
  return routeType === "multi_step" ? "Ruta multipaso" : "Ruta directa";
}
