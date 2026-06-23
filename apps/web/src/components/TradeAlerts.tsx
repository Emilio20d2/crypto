import { useEffect, useRef, useState } from "react";

interface SellAlert {
  assetId: string;
  currentPriceEur: number;
  avgCostEur: number;
  gainPct: number;
  suggestedSellPct: number;
  suggestedQtyUnits: number;
  suggestedAmountEur: number;
  tier: 50 | 100 | 200;
}
interface RebuyAlert {
  assetId: string;
  currentPriceEur: number;
  lastSalePriceEur: number;
  drawdownPct: number;
  eurcToUseEur: number;
  suggestedQtyUnits: number;
  tier: 15 | 25 | 40;
}
interface TradeAlertsResult {
  sellAlerts: SellAlert[];
  rebuyAlerts: RebuyAlert[];
  eurcAvailableEur: number;
  checkedAt: number;
}

const cc = (window as any).cryptoControl;

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("es-ES", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtEur(n: number) {
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtUnits(n: number, assetId: string) {
  const d = ["BTC", "ETH"].includes(assetId) ? 6 : 4;
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d })} ${assetId}`;
}

export function TradeAlerts() {
  const [data, setData] = useState<TradeAlertsResult | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // Initial fetch
    cc?.trade?.getAlerts().then((r: any) => {
      if (r?.ok) setData(r.data);
    }).catch((e: unknown) => { console.warn("[TradeAlerts] No se pudo obtener alertas:", e); });

    // Live push from main process
    if (cc?.trade?.onNewAlerts) {
      unsubRef.current = cc.trade.onNewAlerts((alerts: unknown) => {
        setData(alerts as TradeAlertsResult);
        setDismissed(false); // re-show if new alert arrives
      });
    }

    return () => unsubRef.current?.();
  }, []);

  const total = (data?.sellAlerts.length ?? 0) + (data?.rebuyAlerts.length ?? 0);
  if (total === 0 || dismissed) return null;

  return (
    <div className="trade-alerts-banner" role="alert" aria-live="polite">
      <div className="trade-alerts-header">
        <span className="trade-alerts-title">Alertas de operación</span>
        <span className="trade-alerts-time">
          {data?.checkedAt ? new Date(data.checkedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : ""}
        </span>
        <button
          className="trade-alerts-dismiss"
          onClick={() => setDismissed(true)}
          title="Cerrar"
          aria-label="Cerrar alertas"
        >
          ×
        </button>
      </div>

      {data!.sellAlerts.length > 0 && (
        <div className="trade-alerts-section">
          <div className="trade-alerts-section-title trade-alerts-sell-title">
            📈 Ventas parciales recomendadas
          </div>
          <table className="trade-alerts-table">
            <thead>
              <tr>
                <th>Cripto</th>
                <th className="text-right">Precio actual</th>
                <th className="text-right">Coste medio</th>
                <th className="text-right">Ganancia</th>
                <th className="text-right">Cantidad a vender</th>
                <th className="text-right">Importe estimado</th>
              </tr>
            </thead>
            <tbody>
              {data!.sellAlerts.map(a => (
                <tr key={`sell-${a.assetId}-${a.tier}`}>
                  <td className="trade-alerts-asset">
                    <strong>{a.assetId}</strong>
                    <span className="trade-alerts-tier trade-alerts-tier-sell">+{a.tier}%</span>
                  </td>
                  <td className="text-right">{fmtEur(a.currentPriceEur)}</td>
                  <td className="text-right">{fmtEur(a.avgCostEur)}</td>
                  <td className="text-right trade-alerts-gain">+{fmt(a.gainPct, 1)}%</td>
                  <td className="text-right">
                    {fmtUnits(a.suggestedQtyUnits, a.assetId)}
                    <span className="trade-alerts-pct"> ({(a.suggestedSellPct * 100).toFixed(0)}% posición)</span>
                  </td>
                  <td className="text-right trade-alerts-amount">{fmtEur(a.suggestedAmountEur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="trade-alerts-note">
            Destino: EURC (reserva {data!.eurcAvailableEur > 0 ? `· EURC disponible: ${fmtEur(data!.eurcAvailableEur)}` : ""})
          </p>
        </div>
      )}

      {data!.rebuyAlerts.length > 0 && (
        <div className="trade-alerts-section">
          <div className="trade-alerts-section-title trade-alerts-rebuy-title">
            📉 Recompras recomendadas
          </div>
          <table className="trade-alerts-table">
            <thead>
              <tr>
                <th>Cripto</th>
                <th className="text-right">Precio actual</th>
                <th className="text-right">Último precio venta</th>
                <th className="text-right">Caída</th>
                <th className="text-right">EURC a usar</th>
                <th className="text-right">Cantidad a comprar</th>
              </tr>
            </thead>
            <tbody>
              {data!.rebuyAlerts.map(a => (
                <tr key={`rebuy-${a.assetId}-${a.tier}`}>
                  <td className="trade-alerts-asset">
                    <strong>{a.assetId}</strong>
                    <span className="trade-alerts-tier trade-alerts-tier-rebuy">-{a.tier}%</span>
                  </td>
                  <td className="text-right">{fmtEur(a.currentPriceEur)}</td>
                  <td className="text-right">{fmtEur(a.lastSalePriceEur)}</td>
                  <td className="text-right trade-alerts-drop">-{fmt(a.drawdownPct, 1)}%</td>
                  <td className="text-right trade-alerts-amount">{fmtEur(a.eurcToUseEur)}</td>
                  <td className="text-right">{fmtUnits(a.suggestedQtyUnits, a.assetId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="trade-alerts-note">
            EURC disponible: {fmtEur(data!.eurcAvailableEur)} · Importe neto tras retención fiscal reservada
          </p>
        </div>
      )}
    </div>
  );
}
