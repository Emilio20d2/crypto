import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { CheckCircle2, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./Card";
import { Button } from "./Button";
import { CryptoLogo } from "./CryptoLogo";

const READ_KEY = "trade-alerts-read-at";

function getReadAt(): number | null {
  try { return Number(localStorage.getItem(READ_KEY)) || null; } catch { return null; }
}
function saveReadAt(v: number) {
  try { localStorage.setItem(READ_KEY, String(v)); } catch {}
}

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

function fmtEur(n: number) {
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}
function fmtPct(n: number, sign = true) {
  return `${sign && n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}
function fmtUnits(n: number, assetId: string) {
  const d = ["BTC", "ETH"].includes(assetId) ? 6 : 4;
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d })} ${assetId}`;
}

function SellAlertRow({ a }: { a: SellAlert }) {
  return (
    <div className="trade-alert-row">
      <div className="trade-alert-asset">
        <CryptoLogo symbol={a.assetId} size={32} />
        <div className="trade-alert-asset-info">
          <span className="trade-alert-symbol">{a.assetId}</span>
          <span className="trade-alert-tier-label badge badge-success">+{a.tier}%</span>
        </div>
      </div>
      <dl className="trade-alert-details">
        <div>
          <dt>Precio actual</dt>
          <dd>{fmtEur(a.currentPriceEur)}</dd>
        </div>
        <div>
          <dt>Coste medio</dt>
          <dd>{fmtEur(a.avgCostEur)}</dd>
        </div>
        <div>
          <dt>Ganancia</dt>
          <dd className="trade-alert-positive">{fmtPct(a.gainPct)}</dd>
        </div>
        <div className="trade-alert-action-cell">
          <dt>Vender</dt>
          <dd>
            <span className="trade-alert-action">{fmtUnits(a.suggestedQtyUnits, a.assetId)}</span>
            <span className="trade-alert-action-sub">≈ {fmtEur(a.suggestedAmountEur)}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function RebuyAlertRow({ a }: { a: RebuyAlert }) {
  return (
    <div className="trade-alert-row">
      <div className="trade-alert-asset">
        <CryptoLogo symbol={a.assetId} size={32} />
        <div className="trade-alert-asset-info">
          <span className="trade-alert-symbol">{a.assetId}</span>
          <span className="trade-alert-tier-label badge badge-warning">-{a.tier}%</span>
        </div>
      </div>
      <dl className="trade-alert-details">
        <div>
          <dt>Precio actual</dt>
          <dd>{fmtEur(a.currentPriceEur)}</dd>
        </div>
        <div>
          <dt>Última venta</dt>
          <dd>{fmtEur(a.lastSalePriceEur)}</dd>
        </div>
        <div>
          <dt>Caída</dt>
          <dd className="trade-alert-negative">{fmtPct(-a.drawdownPct)}</dd>
        </div>
        <div className="trade-alert-action-cell">
          <dt>Recomprar con</dt>
          <dd>
            <span className="trade-alert-action">{fmtEur(a.eurcToUseEur)} EURC</span>
            <span className="trade-alert-action-sub">≈ {fmtUnits(a.suggestedQtyUnits, a.assetId)}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function TradeAlerts() {
  const [data, setData] = useState<TradeAlertsResult | null>(null);
  const [readAt, setReadAt] = useState<number | null>(getReadAt);
  const unsubRef = useRef<(() => void) | null>(null);
  const location = useLocation();
  const onCartera = location.pathname === "/cartera";

  useEffect(() => {
    cc?.trade?.getAlerts().then((r: any) => {
      if (r?.ok) setData(r.data);
    }).catch((e: unknown) => { console.warn("[TradeAlerts] No se pudo obtener alertas:", e); });

    if (cc?.trade?.onNewAlerts) {
      unsubRef.current = cc.trade.onNewAlerts((alerts: unknown) => {
        setData(alerts as TradeAlertsResult);
        // New batch clears the read state
        setReadAt(null);
      });
    }

    return () => unsubRef.current?.();
  }, []);

  const sellCount = data?.sellAlerts.length ?? 0;
  const rebuyCount = data?.rebuyAlerts.length ?? 0;
  const isRead = data?.checkedAt != null && readAt === data.checkedAt;

  function markAsRead() {
    if (data?.checkedAt) {
      saveReadAt(data.checkedAt);
      setReadAt(data.checkedAt);
    }
  }

  // Suscripción siempre activa; tarjeta solo visible en la página de Cartera
  if (!onCartera || sellCount + rebuyCount === 0 || isRead) return null;

  const checkedTime = data?.checkedAt
    ? new Date(data.checkedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <Card className="trade-alerts-card">
      <CardHeader>
        <CardTitle>
          Señales de operación
          {checkedTime && <span className="trade-alerts-time">{checkedTime}</span>}
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={markAsRead}
          aria-label="Marcar alertas como leídas"
          title="Marcar como leída"
        >
          <CheckCircle2 size={15} />
        </Button>
      </CardHeader>
      <CardContent>
        {sellCount > 0 && (
          <div className="trade-alerts-section">
            <div className="trade-alerts-section-heading">
              <TrendingUp size={14} className="trade-alert-icon-sell" />
              Ventas parciales recomendadas
            </div>
            <div className="trade-alerts-rows">
              {data!.sellAlerts.map(a => (
                <SellAlertRow key={`sell-${a.assetId}-${a.tier}`} a={a} />
              ))}
            </div>
            {data!.eurcAvailableEur > 0 && (
              <p className="trade-alerts-footer-note">
                EURC disponible: {fmtEur(data!.eurcAvailableEur)}
              </p>
            )}
          </div>
        )}

        {rebuyCount > 0 && (
          <div className={`trade-alerts-section${sellCount > 0 ? " trade-alerts-section--border" : ""}`}>
            <div className="trade-alerts-section-heading">
              <TrendingDown size={14} className="trade-alert-icon-rebuy" />
              Recompras recomendadas
            </div>
            <div className="trade-alerts-rows">
              {data!.rebuyAlerts.map(a => (
                <RebuyAlertRow key={`rebuy-${a.assetId}-${a.tier}`} a={a} />
              ))}
            </div>
            <p className="trade-alerts-footer-note">
              EURC disponible: {fmtEur(data!.eurcAvailableEur)} · Neto tras retención fiscal
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
