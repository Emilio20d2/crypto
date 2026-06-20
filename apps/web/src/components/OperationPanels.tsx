import { KeyRound } from "lucide-react";
import { TxBadge } from "./Badge";
import { Button } from "./Button";
import { LocalAssetLogo } from "./LocalAssetLogo";
import { formatCrypto, formatDateTime, formatMoney } from "../lib/format";

function findAsset(assets: any[], id?: string) {
  return assets.find((asset) => asset.id === id || asset.symbol === id);
}

function amountLabel(leg: any) {
  if (!leg) return "No disponible";
  return formatCrypto(Math.abs(leg.amount), "No disponible");
}

function txSource(tx: any) {
  return tx.externalId ? "Coinbase" : "Manual";
}

function feeLabel(tx: any) {
  const fee = tx.fees?.[0] ?? tx.legs.find((leg: any) => leg.legType === "fee");
  if (!fee) return formatMoney(0);
  if (fee.assetId === "EUR") return formatMoney(Math.abs(fee.amount));
  return `${formatCrypto(Math.abs(fee.amount), "N/D")} ${fee.assetId || ""}`.trim();
}

function legValue(leg: any) {
  return leg?.valuationEur ?? leg?.acquisitionValueEur ?? null;
}

function unitPriceLabel(leg: any) {
  const value = legValue(leg);
  const amount = Math.abs(leg?.amount ?? 0);
  if (typeof value !== "number" || !Number.isFinite(value) || amount <= 0) return "Pendiente";
  return formatMoney(value / amount);
}

export function OperationRow({
  tx,
  assets,
  selected,
  onSelect,
}: {
  tx: any;
  assets: any[];
  selected?: boolean;
  onSelect: () => void;
}) {
  const source = tx.legs.find((leg: any) => leg.legType === "source");
  const destination = tx.legs.find((leg: any) => leg.legType === "destination") ?? tx.legs[0];
  const sourceAsset = findAsset(assets, source?.assetId);
  const destinationAsset = findAsset(assets, destination?.assetId);
  const isConversion = tx.type === "convert" && source && destination;
  const primaryLeg = tx.type === "sell" ? source : destination;
  const primaryAsset = tx.type === "sell" ? sourceAsset : destinationAsset;
  const sourceLabel = txSource(tx);
  const sourceSymbol = sourceAsset?.symbol || source?.assetId || "Origen";
  const destinationSymbol = destinationAsset?.symbol || destination?.assetId || "Destino";
  const primarySymbol = primaryAsset?.symbol || primaryLeg?.assetId || "Activo";

  return (
    <article className={selected ? "operation-card active" : "operation-card"}>
      <button type="button" className="operation-card-main" onClick={onSelect}>
        <span className={isConversion ? "operation-card-logos conversion" : "operation-card-logos"}>
          {isConversion ? (
            <>
              <LocalAssetLogo logoUrl={sourceAsset?.logoUrl} symbol={sourceAsset?.symbol || source.assetId} size={34} />
              <span className="operation-card-arrow">→</span>
              <LocalAssetLogo logoUrl={destinationAsset?.logoUrl} symbol={destinationAsset?.symbol || destination.assetId} size={34} />
            </>
          ) : (
            <LocalAssetLogo logoUrl={primaryAsset?.logoUrl} symbol={primaryAsset?.symbol || primaryLeg?.assetId || "?"} size={38} />
          )}
        </span>
        <span className="operation-card-title">
          <strong>{isConversion ? `${sourceSymbol} → ${destinationSymbol}` : primarySymbol}</strong>
          <small>{formatDateTime(tx.date)}</small>
        </span>
        <TxBadge type={tx.type} />
        <dl className="operation-card-metrics">
          {isConversion ? (
            <>
              <div><dt>Origen</dt><dd>{amountLabel(source)} {sourceSymbol}</dd></div>
              <div><dt>Destino</dt><dd>{amountLabel(destination)} {destinationSymbol}</dd></div>
            </>
          ) : (
            <>
              <div><dt>Cantidad</dt><dd>{amountLabel(primaryLeg)} {primarySymbol}</dd></div>
              <div><dt>Precio</dt><dd>{unitPriceLabel(primaryLeg)}</dd></div>
            </>
          )}
          <div><dt>Comisión</dt><dd>{feeLabel(tx)}</dd></div>
          <div><dt>Exchange</dt><dd>{sourceLabel}</dd></div>
        </dl>
      </button>
    </article>
  );
}

export function OperationDetail({
  tx,
  assets,
  onOpenCoinbaseSettings,
}: {
  tx?: any;
  assets: any[];
  onOpenCoinbaseSettings?: () => void;
}) {
  if (!tx) {
    return (
      <aside className="operation-detail">
        <h3>Detalle</h3>
        <p className="empty-inline">Selecciona una operación del historial.</p>
        {onOpenCoinbaseSettings && (
          <Button type="button" variant="secondary" size="sm" onClick={onOpenCoinbaseSettings}>
            <KeyRound size={15} />
            Configurar Coinbase
          </Button>
        )}
      </aside>
    );
  }

  return (
    <aside className="operation-detail">
      <h3>Detalle</h3>
      <dl className="stats-list">
        <div><dt>Tipo</dt><dd><TxBadge type={tx.type} /></dd></div>
        <div><dt>Fecha y hora</dt><dd>{formatDateTime(tx.date)}</dd></div>
        <div><dt>Origen</dt><dd>{tx.type === "convert" ? "Conversión" : tx.externalId ? "Coinbase" : "Manual"}</dd></div>
        <div><dt>Fuente</dt><dd>{txSource(tx)}</dd></div>
        <div><dt>Comisión</dt><dd>{feeLabel(tx)}</dd></div>
        <div><dt>Estado fiscal</dt><dd>Información fiscal disponible parcialmente</dd></div>
      </dl>
      {onOpenCoinbaseSettings && (
        <Button type="button" variant="secondary" size="sm" onClick={onOpenCoinbaseSettings}>
          <KeyRound size={15} />
          Configurar Coinbase
        </Button>
      )}
      <div className="operation-leg-list">
        {tx.legs.map((leg: any, index: number) => {
          const asset = findAsset(assets, leg.assetId);
          return (
            <div className="operation-leg" key={`${leg.assetId}-${index}`}>
              <LocalAssetLogo logoUrl={asset?.logoUrl} symbol={asset?.symbol || leg.assetId} size={26} />
              <span>
                <strong>{asset?.symbol || leg.assetId}</strong>
                <small>{leg.legType}</small>
              </span>
              <em className="num">{formatCrypto(leg.amount)}</em>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export function OperationList({
  transactions,
  assets,
  selectedId,
  onSelect,
}: {
  transactions: any[];
  assets: any[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="operation-list operation-card-list">
      {transactions.map((tx) => (
        <OperationRow
          key={tx.id}
          tx={tx}
          assets={assets}
          selected={tx.id === selectedId}
          onSelect={() => onSelect(tx.id)}
        />
      ))}
    </section>
  );
}
