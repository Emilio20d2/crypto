import { ChevronLeft } from "lucide-react";
import { Button } from "./Button";
import { LocalAssetLogo } from "./LocalAssetLogo";
import { formatMoney, formatPercent } from "../lib/format";

export function AssetDetailHeader({
  asset,
  logoUrl,
  price,
  change,
  onBack,
}: {
  asset: { name?: string; symbol?: string; id?: string };
  logoUrl?: string | null;
  price?: number | null;
  change?: number | null;
  onBack: () => void;
}) {
  const symbol = asset.symbol || asset.id || "?";
  return (
    <header className="asset-detail-header">
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeft size={16} />
        Volver
      </Button>
      <div className="asset-detail-title">
        <LocalAssetLogo logoUrl={logoUrl} symbol={symbol} size={48} />
        <span>
          <strong>{asset.name || symbol}</strong>
          <small>{symbol} / EUR</small>
        </span>
      </div>
      <div className="asset-detail-price">
        <strong>{formatMoney(price, "Precio no disponible")}</strong>
        <span className={change && change < 0 ? "text-negative" : "text-positive"}>{formatPercent(change, "24 h no disponible")}</span>
      </div>
    </header>
  );
}
