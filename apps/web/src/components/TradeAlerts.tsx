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

const ASSET_NAMES: Record<string, string> = {
  BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", SUI: "Sui",
  ADA: "Cardano", DOT: "Polkadot", AVAX: "Avalanche", MATIC: "Polygon",
  LINK: "Chainlink", UNI: "Uniswap", ATOM: "Cosmos", NEAR: "NEAR",
  EURC: "Euro Coin", USDC: "USD Coin", USDT: "Tether",
};

const cc = (window as any).cryptoControl;

function fmtEur(n: number) {
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}
function fmtPct(n: number, sign = true) {
  return `${sign && n >= 0 ? "+" : ""}${n.toFixed(1)} %`;
}
function fmtUnits(n: number, assetId: string) {
  const d = ["BTC", "ETH"].includes(assetId) ? 6 : 4;
  return `${n.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d })} ${assetId}`;
}

function SellAlertCard({ a }: { a: SellAlert }) {
  return (
    <article className="trade-alert-card">
      <div className="trade-alert-card-head">
        <CryptoLogo symbol={a.assetId} size={36} />
        <div className="trade-alert-card-identity">
          <span className="trade-alert-card-name">{ASSET_NAMES[a.assetId] ?? a.assetId}</span>
          <span className="trade-alert-card-sym">{a.assetId}</span>
        </div>
        <span className="badge badge-success trade-alert-tier-badge">+{a.tier}%</span>
      </div>

      <div className="trade-alert-card-data">
        <div className="trade-alert-cell">
          <span className="trade-alert-cell-label">Precio actual</span>
          <span className="trade-alert-cell-value">{fmtEur(a.currentPriceEur)}</span>
        </div>
        <div className="trade-alert-cell">
          <span className="trade-alert-cell-label">Coste medio</span>
          <span className="trade-alert-cell-value">{fmtEur(a.avgCostEur)}</span>
        </div>
        <div className="trade-alert-cell trade-alert-cell--span">
          <span className="trade-alert-cell-label">Ganancia desde coste</span>
          <span className="trade-alert-cell-value trade-alert-positive">{fmtPct(a.gainPct)}</span>
        </div>
      </div>

      <div className="trade-alert-action-box">
        <div className="trade-alert-action-item">
          <span className="trade-alert-action-label">Vender</span>
          <strong className="trade-alert-action-amount">{fmtUnits(a.suggestedQtyUnits, a.assetId)}</strong>
        </div>
        <div className="trade-alert-action-sep" aria-hidden="true" />
        <div className="trade-alert-action-item">
          <span className="trade-alert-action-label">Recibirías aprox.</span>
          <span className="trade-alert-action-units">{fmtEur(a.suggestedAmountEur)}</span>
        </div>
      </div>
    </article>
  );
}

function RebuyAlertCard({ a }: { a: RebuyAlert }) {
  return (
    <article className="trade-alert-card">
      <div className="trade-alert-card-head">
        <CryptoLogo symbol={a.assetId} size={36} />
        <div className="trade-alert-card-identity">
          <span className="trade-alert-card-name">{ASSET_NAMES[a.assetId] ?? a.assetId}</span>
          <span className="trade-alert-card-sym">{a.assetId}</span>
        </div>
        <span className="badge badge-warning trade-alert-tier-badge">−{a.tier}%</span>
      </div>

      <div className="trade-alert-card-data">
        <div className="trade-alert-cell">
          <span className="trade-alert-cell-label">Precio actual</span>
          <span className="trade-alert-cell-value">{fmtEur(a.currentPriceEur)}</span>
        </div>
        <div className="trade-alert-cell">
          <span className="trade-alert-cell-label">Precio de última venta</span>
          <span className="trade-alert-cell-value">{fmtEur(a.lastSalePriceEur)}</span>
        </div>
        <div className="trade-alert-cell trade-alert-cell--span">
          <span className="trade-alert-cell-label">Caída acumulada desde la venta</span>
          <span className="trade-alert-cell-value trade-alert-negative">{fmtPct(-a.drawdownPct, false)}↓</span>
        </div>
      </div>

      <div className="trade-alert-action-box">
        <div className="trade-alert-action-item">
          <span className="trade-alert-action-label">Recomprar con</span>
          <strong className="trade-alert-action-amount">{fmtEur(a.eurcToUseEur)} EURC</strong>
        </div>
        <div className="trade-alert-action-sep" aria-hidden="true" />
        <div className="trade-alert-action-item">
          <span className="trade-alert-action-label">Recibirías aprox.</span>
          <span className="trade-alert-action-units">{fmtUnits(a.suggestedQtyUnits, a.assetId)}</span>
        </div>
      </div>
    </article>
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
              <TrendingUp size={13} className="trade-alert-icon-sell" />
              Ventas parciales recomendadas
            </div>
            <div className="trade-alerts-grid">
              {data!.sellAlerts.map(a => (
                <SellAlertCard key={`sell-${a.assetId}-${a.tier}`} a={a} />
              ))}
            </div>
          </div>
        )}

        {rebuyCount > 0 && (
          <div className={`trade-alerts-section${sellCount > 0 ? " trade-alerts-section--sep" : ""}`}>
            <div className="trade-alerts-section-heading">
              <TrendingDown size={13} className="trade-alert-icon-rebuy" />
              Recompras recomendadas
            </div>
            <div className="trade-alerts-grid">
              {data!.rebuyAlerts.map(a => (
                <RebuyAlertCard key={`rebuy-${a.assetId}-${a.tier}`} a={a} />
              ))}
            </div>

            <div className="trade-alerts-eurc-summary">
              <span className="trade-alerts-eurc-label">EURC disponible</span>
              <span className="trade-alerts-eurc-amount">{fmtEur(data!.eurcAvailableEur)}</span>
              <span className="trade-alerts-eurc-note">Neto tras reserva fiscal</span>
            </div>
          </div>
        )}

        {sellCount > 0 && rebuyCount === 0 && data!.eurcAvailableEur > 0 && (
          <div className="trade-alerts-eurc-summary trade-alerts-eurc-summary--mt">
            <span className="trade-alerts-eurc-label">EURC disponible</span>
            <span className="trade-alerts-eurc-amount">{fmtEur(data!.eurcAvailableEur)}</span>
            <span className="trade-alerts-eurc-note">Neto tras reserva fiscal</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
