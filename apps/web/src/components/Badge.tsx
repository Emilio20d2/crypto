type BadgeVariant = "success" | "danger" | "info" | "warning" | "neutral";

const TX_TYPE_VARIANT: Record<string, BadgeVariant> = {
  buy:          "success",
  transfer_in:  "success",
  reward:       "success",
  staking:      "success",
  airdrop:      "success",
  sell:         "danger",
  transfer_out: "danger",
  fee:          "danger",
  convert:      "info",
  adjustment:   "neutral",
};

const TX_TYPE_LABEL: Record<string, string> = {
  buy:          "Compra",
  sell:         "Venta",
  convert:      "Conversión",
  transfer_in:  "Entrada",
  transfer_out: "Salida",
  reward:       "Recompensa",
  staking:      "Staking",
  airdrop:      "Airdrop",
  fee:          "Comisión",
  adjustment:   "Ajuste",
};

export function Badge({
  children,
  variant = "neutral",
}: {
  children: React.ReactNode;
  variant?: BadgeVariant;
}) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

export function TxBadge({ type }: { type: string }) {
  const variant = TX_TYPE_VARIANT[type] ?? "neutral";
  const label   = TX_TYPE_LABEL[type]   ?? type;
  return <Badge variant={variant}>{label}</Badge>;
}
